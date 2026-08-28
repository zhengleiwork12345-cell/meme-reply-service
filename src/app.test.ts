import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import type { AuthService } from './auth.js';
import type { AuthStore } from './database.js';
import { ServiceError } from './errors.js';
import { ArkProviderError, type MemeGenerator } from './generator.js';

const png = Buffer.from([137,80,78,71,13,10,26,10,0]);
const auth = { verifyBearer: vi.fn(async () => ({ userId: '11111111-1111-4111-8111-111111111111', deviceId: '22222222-2222-4222-8222-222222222222' })) } as unknown as AuthService;
const store = { logGeneration: vi.fn(async () => undefined) } as unknown as AuthStore;
const generator: MemeGenerator = { model: 'doubao-seedream-4-0-250828', generate: vi.fn(async () => ({ mimeType: 'image/png' as const, imageBase64: 'aGVsbG8=' })) };
const app = () => createApp({ auth, store, generator });

describe('POST /v1/meme-replies', () => {
  beforeEach(() => { vi.clearAllMocks(); (auth.verifyBearer as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: '11111111-1111-4111-8111-111111111111', deviceId: '22222222-2222-4222-8222-222222222222' }); (generator.generate as ReturnType<typeof vi.fn>).mockResolvedValue({ mimeType: 'image/png', imageBase64: 'aGVsbG8=' }); });
  it('requires an access token', async () => { (auth.verifyBearer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ServiceError(401, 'UNAUTHORIZED', '缺少身份验证。')); const response = await request(app()).post('/v1/meme-replies'); expect(response.status).toBe(401); expect(response.body.code).toBe('UNAUTHORIZED'); });
  it('exposes a safe build marker and logs generation lifecycle without image data', async () => {
    const log = vi.fn();
    const health = await request(createApp({ auth, store, generator, log })).get('/health');
    expect(health.body).toMatchObject({ ok: true, serviceBuild: 'diagnostics-20260825.1' });
    await request(createApp({ auth, store, generator, log })).post('/v1/meme-replies').set('authorization', 'Bearer token').field('mood', '反击').attach('source', png, { filename: 'ok.png', contentType: 'image/png' });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ route: '/v1/meme-replies', phase: 'request_started' }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ route: '/v1/meme-replies', phase: 'generation_started' }));
    expect(JSON.stringify(log.mock.calls)).not.toContain(png.toString('base64'));
  });
  it('reports an unavailable account store without masquerading as image generation', async () => { const log = vi.fn(); const brokenAuth = { ...auth, register: vi.fn(async () => { throw new Error('database connection refused'); }) } as unknown as AuthService; const response = await request(createApp({ auth: brokenAuth, store, generator, log })).post('/auth/register').send({}); expect(response.status).toBe(503); expect(response.body.code).toBe('AUTH_SERVICE_UNAVAILABLE'); expect(response.body.message).toBe('账户服务暂时不可用，请检查数据库连接后再试。'); expect(log).toHaveBeenCalledWith(expect.objectContaining({ route: '/auth/register', category: 'AUTH_STORE_FAILURE' })); });
  it('rejects invalid uploads before generation', async () => { const response = await request(app()).post('/v1/meme-replies').set('authorization','Bearer token').field('mood','反击').attach('source', Buffer.from('not image'), { filename:'bad.png', contentType:'image/png' }); expect(response.status).toBe(400); expect(generator.generate).not.toHaveBeenCalled(); });
  it('returns a Base64 PNG and logs only metadata', async () => { const response = await request(app()).post('/v1/meme-replies').set('authorization','Bearer token').field('mood','反击').field('replyText','收到').attach('source', png, { filename:'ok.png', contentType:'image/png' }); expect(response.status).toBe(200); expect(response.body).toMatchObject({mimeType:'image/png',imageBase64:'aGVsbG8='}); expect(store.logGeneration).toHaveBeenCalledWith(expect.objectContaining({status:'success',model:'doubao-seedream-4-0-250828'})); });
  it('accepts the authenticated Base64 fallback without logging image bytes', async () => { const log = vi.fn(); const response = await request(createApp({ auth, store, generator, log })).post('/v1/meme-replies/base64').set('authorization', 'Bearer token').send({ mood: '反击', sourceMimeType: 'image/png', sourceBase64: png.toString('base64') }); expect(response.status).toBe(200); expect(generator.generate).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({ bytes: png, mimeType: 'image/png' }) })); expect(JSON.stringify(log.mock.calls)).not.toContain(png.toString('base64')); });
  it('rejects malformed Base64 before generation', async () => { const response = await request(app()).post('/v1/meme-replies/base64').set('authorization', 'Bearer token').send({ mood: '反击', sourceMimeType: 'image/png', sourceBase64: 'invalid!' }); expect(response.status).toBe(400); expect(generator.generate).not.toHaveBeenCalled(); });
  it('maps upstream failures without exposing response content', async () => { (generator.generate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('secret upstream body')); const response = await request(app()).post('/v1/meme-replies').set('authorization','Bearer token').field('mood','反击').attach('source', png, { filename:'ok.png', contentType:'image/png' }); expect(response.status).toBe(502); expect(response.body.message).not.toContain('secret'); });
  it('maps Ark rate limits without exposing provider details', async () => { (generator.generate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ArkProviderError(429)); const response = await request(app()).post('/v1/meme-replies').set('authorization','Bearer token').field('mood','反击').attach('source', png, { filename:'ok.png', contentType:'image/png' }); expect(response.status).toBe(429); expect(response.body.code).toBe('UPSTREAM_RATE_LIMITED'); expect(response.body.message).not.toContain('HTTP'); });
});
