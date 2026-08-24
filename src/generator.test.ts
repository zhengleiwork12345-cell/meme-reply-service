import { describe, expect, it } from 'vitest';
import { JimengMemeGenerator } from './generator.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const input = { source: { bytes: png, mimeType: 'image/png' as const, filename: 'source.png' }, mood: '反击' as const, replyText: '收到', contextText: '对方说今天又加班' };

describe('JimengMemeGenerator', () => {
  it('sends one reference image and returns the Base64 result without storing it', async () => {
    let calls = 0; let options: RequestInit | undefined;
    const fetcher: typeof fetch = async (_url, init) => { calls += 1; options = init; return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 }); };
    const generator = new JimengMemeGenerator('ark-secret', 'ep-test', fetcher);
    await expect(generator.generate(input)).resolves.toEqual({ mimeType: 'image/png', imageBase64: png.toString('base64') });
    expect(calls).toBe(1);
    expect(JSON.parse(options?.body as string)).toMatchObject({ model: 'ep-test', image: [`data:image/png;base64,${png.toString('base64')}`], response_format: 'b64_json', size: '2K', stream: false, watermark: true });
    expect(JSON.parse(options?.body as string)).not.toHaveProperty('sequential_image_generation');
    expect(JSON.parse(options?.body as string).prompt).toContain('对方说今天又加班');
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer ark-secret' });
  });

  it('does not expose an upstream response when the provider rejects a request', async () => {
    const fetcher: typeof fetch = async () => new Response('{"error":"provider detail"}', { status: 429 });
    const generator = new JimengMemeGenerator('ark-secret', 'ep-test', fetcher);
    await expect(generator.generate(input)).rejects.toThrow('HTTP 429');
  });
});
