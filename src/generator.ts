import type { GenerationRequest } from './contracts.js';

export interface MemeGenerator {
  readonly model: string;
  generate(input: GenerationRequest): Promise<{ mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; imageBase64: string }>;
}

type Fetcher = typeof fetch;
type ArkImageResponse = { data?: Array<{ b64_json?: string }> };

/** A sanitized provider failure: its HTTP status is safe to log, never its body. */
export class ArkProviderError extends Error {
  constructor(readonly status: number) {
    super(`Jimeng API returned HTTP ${status}.`);
    this.name = 'ArkProviderError';
  }
}

/** Official Volcano Engine Ark / Jimeng compatible image-generation endpoint. */
export class JimengMemeGenerator implements MemeGenerator {
  readonly model: string;
  constructor(
    private readonly apiKey: string,
    model: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly baseUrl = 'https://ark.cn-beijing.volces.com/api/v3',
  ) { this.model = model; }

  async generate(input: GenerationRequest) {
    const image = `data:${input.source.mimeType};base64,${input.source.bytes.toString('base64')}`;
    const response = await this.fetcher(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: promptFor(input),
        image: [image],
        // Seedream 5.0 Pro uses the documented short size syntax. The result remains
        // suitable for a square meme because the prompt explicitly requests one.
        size: '2K',
        response_format: 'b64_json',
        stream: false,
        watermark: true,
      }),
    });
    if (!response.ok) throw new ArkProviderError(response.status);
    const result = await response.json() as ArkImageResponse;
    const imageBase64 = result.data?.[0]?.b64_json;
    if (!imageBase64) throw new Error('Jimeng API did not return an image.');
    const mimeType = detectMimeType(imageBase64);
    if (!mimeType) throw new Error('Jimeng API returned an unsupported image format.');
    return { mimeType, imageBase64 };
  }
}

function detectMimeType(base64: string): 'image/jpeg' | 'image/png' | 'image/webp' | undefined {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

function promptFor(input: GenerationRequest): string {
  return `基于参考表情图，创作一张正方形、适合聊天回复的幽默中文回击表情。情绪：${input.mood}。${input.contextText ? `仅作为理解语境的临时参考：${input.contextText}。不要逐字复刻其中内容。` : ''}${input.replyText ? `自然融入这句简短回击语：“${input.replyText}”。` : '除非能明显增强笑点，否则不要添加可读文字。'} 保持轻松、不针对特定个人；不要生成真人肖像、公众人物、色情、仇恨、威胁、骚扰、违法内容或受版权保护角色，也不要保留参考图中的人脸。`;
}
