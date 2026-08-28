import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { base64GenerationSchema, formSchema, type ErrorResponse, type GenerationRequest, type GenerationResponse } from './contracts.js';
import type { AuthService } from './auth.js';
import type { AuthStore } from './database.js';
import { ServiceError, invalid } from './errors.js';
import { ArkNetworkError, ArkProviderError, ArkTimeoutError, type MemeGenerator } from './generator.js';

export const SERVICE_BUILD_ID = 'diagnostics-20260825.1';

export type Dependencies = {
  auth: AuthService;
  store: AuthStore;
  generator: MemeGenerator;
  log?: (event: Record<string, unknown>) => void;
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const accepted = new Set(['image/jpeg', 'image/png']);

export function createApp(deps: Dependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/auth', express.json({ limit: '16kb' }));
  app.get('/health', (_req, res) => res.status(200).json({ ok: true, serviceBuild: SERVICE_BUILD_ID }));
  app.post('/auth/register', wrap(async req => deps.auth.register(req.body)));
  app.post('/auth/login', wrap(async req => deps.auth.login(req.body)));
  app.post('/auth/refresh', wrap(async req => deps.auth.refresh(req.body)));

  function wrap(handler: (req: Request) => Promise<unknown>) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.status(200).json(await handler(req));
      } catch (error) {
        const requestId = randomUUID();
        const wrapped = error instanceof Error ? error : new Error('Unknown error');
        (wrapped as Error & { requestId?: string }).requestId = requestId;
        deps.log?.({ requestId, route: req.path, phase: 'request_finished', status: error instanceof ServiceError ? error.status : 503, category: error instanceof ServiceError ? error.code : 'AUTH_STORE_FAILURE' });
        next(wrapped);
      }
    };
  }

  app.post('/v1/meme-replies', upload.single('source'), async (req, res, next) => {
    const requestId = randomUUID();
    const started = Date.now();
    let principal: { userId: string; deviceId: string } | undefined;
    deps.log?.({ requestId, route: req.path, phase: 'request_started' });
    try {
      principal = await deps.auth.verifyBearer(req.header('authorization'));
      if (!req.file || !accepted.has(req.file.mimetype) || !hasMatchingSignature(req.file.buffer, req.file.mimetype)) {
        throw invalid('即梦参考图仅支持 PNG 或 JPEG 图片。');
      }
      const parsed = formSchema.safeParse(req.body);
      if (!parsed.success) throw invalid('情绪或自定义回击语无效。');
      deps.log?.({ requestId, route: req.path, phase: 'generation_started' });
      const result = await deps.generator.generate({
        source: { bytes: req.file.buffer, mimeType: req.file.mimetype as GenerationRequest['source']['mimeType'], filename: req.file.originalname || 'source.png' },
        ...parsed.data,
      });
      const elapsedMs = Date.now() - started;
      await deps.store.logGeneration({ requestId, userId: principal.userId, deviceId: principal.deviceId, status: 'success', elapsedMs, model: deps.generator.model });
      deps.log?.({ requestId, route: req.path, phase: 'request_finished', status: 200, elapsedMs });
      const body: GenerationResponse = { requestId, ...result };
      res.status(200).json(body);
    } catch (error) {
      if (principal) {
        void deps.store.logGeneration({ requestId, userId: principal.userId, deviceId: principal.deviceId, status: 'failed', elapsedMs: Date.now() - started, model: deps.generator.model }).catch(() => undefined);
      }
      next(withRequestId(error, requestId, started, deps, req.path));
    }
  });

  // Android's native multipart implementation is unreliable on some HTTP-only
  // test networks. This route is a guarded fallback, never a public image store.
  app.post('/v1/meme-replies/base64', express.json({ limit: '7mb' }), async (req, res, next) => {
    const requestId = randomUUID();
    const started = Date.now();
    let principal: { userId: string; deviceId: string } | undefined;
    deps.log?.({ requestId, route: req.path, phase: 'request_started', transport: 'base64' });
    try {
      principal = await deps.auth.verifyBearer(req.header('authorization'));
      const parsed = base64GenerationSchema.safeParse(req.body);
      if (!parsed.success) throw invalid('图片、情绪或自定义回击语无效。');
      const bytes = decodeBase64Image(parsed.data.sourceBase64);
      if (bytes.length > 5 * 1024 * 1024 || !hasMatchingSignature(bytes, parsed.data.sourceMimeType)) {
        throw invalid('即梦参考图仅支持不超过 5 MB 的 PNG 或 JPEG 图片。');
      }
      deps.log?.({ requestId, route: req.path, phase: 'generation_started', transport: 'base64' });
      const result = await deps.generator.generate({
        source: { bytes, mimeType: parsed.data.sourceMimeType, filename: parsed.data.sourceMimeType === 'image/png' ? 'source.png' : 'source.jpg' },
        mood: parsed.data.mood,
        replyText: parsed.data.replyText,
        contextText: parsed.data.contextText,
      });
      const elapsedMs = Date.now() - started;
      await deps.store.logGeneration({ requestId, userId: principal.userId, deviceId: principal.deviceId, status: 'success', elapsedMs, model: deps.generator.model });
      deps.log?.({ requestId, route: req.path, phase: 'request_finished', status: 200, elapsedMs, transport: 'base64' });
      const body: GenerationResponse = { requestId, ...result };
      res.status(200).json(body);
    } catch (error) {
      if (principal) void deps.store.logGeneration({ requestId, userId: principal.userId, deviceId: principal.deviceId, status: 'failed', elapsedMs: Date.now() - started, model: deps.generator.model }).catch(() => undefined);
      next(withRequestId(error, requestId, started, deps, req.path));
    }
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const wrapped = error as ServiceError & { requestId?: string };
    const requestId = wrapped.requestId || randomUUID();
    const isAuthRequest = req.path.startsWith('/auth/');
    const status = isAuthRequest && !(error instanceof ServiceError) ? 503 : responseStatus(error);
    const code = wrapped instanceof ServiceError ? wrapped.code : isAuthRequest ? 'AUTH_SERVICE_UNAVAILABLE' : isMulterError(error) ? 'INVALID_REQUEST' : error instanceof ArkProviderError && error.status === 429 ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_FAILURE';
    const message = wrapped instanceof ServiceError ? wrapped.message : isAuthRequest ? '账户服务暂时不可用，请检查数据库连接后再试。' : isMulterError(error) ? '图片超过大小限制或上传格式错误。' : providerMessage(error);
    if (!wrapped.requestId) deps.log?.({ requestId, route: req.path, phase: 'request_finished', status, category: errorCategory(error) });
    const body: ErrorResponse = { requestId, code, message };
    res.status(status).json(body);
  });
  return app;
}

function responseStatus(error: unknown) {
  if (error instanceof ServiceError) return error.status;
  if (isMulterError(error)) return 400;
  if (error instanceof ArkProviderError && error.status === 429) return 429;
  if (error instanceof ArkProviderError && (error.status === 401 || error.status === 403)) return 503;
  return 502;
}

function providerMessage(error: unknown) {
  if (error instanceof ArkTimeoutError) return '图像生成服务响应超时，请稍后重试。';
  if (error instanceof ArkNetworkError) return '图像生成服务网络连接暂时不可用，请稍后重试。';
  if (error instanceof ArkProviderError && error.status === 429) return '即梦图像服务当前限流，请稍后重试。';
  if (error instanceof ArkProviderError && (error.status === 401 || error.status === 403)) return '图像模型鉴权或接入点配置不可用，请联系服务管理员检查配置。';
  if (error instanceof ArkProviderError && error.status === 400) return '图像模型拒绝了本次请求，请更换图片或回击语后再试。';
  return '图像生成服务暂时不可用。';
}

function errorCategory(error: unknown) {
  if (error instanceof ServiceError) return error.code;
  if (isMulterError(error)) return 'INVALID_REQUEST';
  if (error instanceof ArkTimeoutError) return 'ARK_TIMEOUT';
  if (error instanceof ArkNetworkError) return 'ARK_NETWORK_FAILURE';
  if (error instanceof ArkProviderError) return `ARK_HTTP_${error.status}`;
  return 'UPSTREAM_FAILURE';
}

function withRequestId(error: unknown, requestId: string, started: number, deps: Dependencies, route: string) {
  const wrapped = error instanceof Error ? error : new Error('Unknown error');
  (wrapped as Error & { requestId?: string }).requestId = requestId;
  deps.log?.({ requestId, route, phase: 'request_finished', status: responseStatus(error), elapsedMs: Date.now() - started, category: errorCategory(error) });
  return wrapped;
}

function isMulterError(error: unknown): error is multer.MulterError { return error instanceof multer.MulterError; }

function hasMatchingSignature(bytes: Buffer, mimeType: string) {
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

function decodeBase64Image(value: string) {
  // Buffer accepts malformed Base64 silently; reject it before decoding.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw invalid('图片编码无效。');
  return Buffer.from(value, 'base64');
}
