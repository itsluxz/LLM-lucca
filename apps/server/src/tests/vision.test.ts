import { afterEach, describe, expect, it, vi } from 'vitest';
import { toOpenAiMessage } from '../llm/providers/openaiCompatible.js';
import { anthropic } from '../llm/providers/anthropic.js';
import { google } from '../llm/providers/google.js';
import { imageRefs, sniffImage, stripImageRefs } from '../modules/images/routes.js';
import type { StreamParams } from '../llm/types.js';

const img = { mimeType: 'image/png', data: 'AAAA' };
const key = 'img_user1_0123456789abcdef01234567';
const params: StreamParams = {
  apiKey: 'k',
  model: 'm',
  messages: [{ role: 'user', content: 'o que é isso?', images: [img] }],
  signal: new AbortController().signal,
};
afterEach(() => vi.unstubAllGlobals());
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
const emptyStream = () =>
  new Response('event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{}}\n\n');

describe('vision', () => {
  it('finds and strips image references in a message', () => {
    const content = `veja\n\n![foto.png](/api/images/${key})`;
    expect(imageRefs(content)).toEqual([key]);
    expect(stripImageRefs(content)).toBe('veja');
    expect(imageRefs('![x](https://evil.com/a.png)')).toEqual([]);
  });

  it('detects image types by their bytes', () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('RIFF1234WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });

  it('sends OpenAI images as data URL parts', () =>
    expect(toOpenAiMessage(params.messages[0])).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'o que é isso?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    }));

  it('sends Anthropic images as base64 blocks before the text', async () => {
    const fetchMock = vi.fn(async () => emptyStream());
    vi.stubGlobal('fetch', fetchMock);
    for await (const _ of anthropic.streamChat(params)) void _;
    expect(bodyOf(fetchMock).messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'o que é isso?' },
    ]);
  });

  it('sends Gemini images as inline_data parts', async () => {
    const fetchMock = vi.fn(async () => new Response(''));
    vi.stubGlobal('fetch', fetchMock);
    await expect(async () => {
      for await (const _ of google.streamChat(params)) void _;
    }).rejects.toThrow(); // stream vazio: sem texto, mas o corpo já foi enviado
    expect(bodyOf(fetchMock).contents[0].parts).toEqual([
      { inline_data: { mime_type: 'image/png', data: 'AAAA' } },
      { text: 'o que é isso?' },
    ]);
  });
});
