import { describe, it, expect } from 'vitest';
import { checked, parseSse } from '../llm/providers/sseParser.js';
import { openAiUsage } from '../llm/providers/openaiCompatible.js';
import { anthropicUsage } from '../llm/providers/anthropic.js';
import { googleUsage } from '../llm/providers/google.js';
describe('provider protocols', () => {
  it('parses split CRLF SSE frames', async () => {
    const chunks = [
      'event: delta\r\ndata: {"text":"oi"}\r',
      '\n\r\nevent: done\ndata: {}\n\n',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
        c.close();
      },
    });
    const frames = [];
    for await (const f of parseSse(stream)) frames.push(f);
    expect(frames).toEqual([
      { event: 'delta', data: '{"text":"oi"}' },
      { event: 'done', data: '{}' },
    ]);
  });
  it('separates OpenAI reasoning from visible output', () =>
    expect(
      openAiUsage({
        prompt_tokens: 100,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens: 60,
        completion_tokens_details: { reasoning_tokens: 25 },
      }),
    ).toEqual({
      inputTokens: 100,
      cachedTokens: 20,
      reasoningTokens: 25,
      outputTokens: 35,
    }));
  it('accounts for Anthropic cached input and thinking', () =>
    expect(
      anthropicUsage(
        { input_tokens: 80, cache_read_input_tokens: 20 },
        { output_tokens: 50 },
        'thought',
      ),
    ).toEqual({
      inputTokens: 100,
      cachedTokens: 20,
      reasoningTokens: 2,
      outputTokens: 48,
    }));
  it('keeps Gemini categories separate', () =>
    expect(
      googleUsage({
        promptTokenCount: 120,
        cachedContentTokenCount: 10,
        thoughtsTokenCount: 30,
        candidatesTokenCount: 40,
      }),
    ).toEqual({
      inputTokens: 120,
      cachedTokens: 10,
      reasoningTokens: 30,
      outputTokens: 40,
    }));
  it('returns friendly provider errors without exposing response bodies', async () => {
    await expect(
      checked(new Response('internal details', { status: 401 })),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Chave de API inválida',
    });
    await expect(
      checked(new Response('internal details', { status: 500 })),
    ).rejects.toMatchObject({
      status: 502,
      message: 'O provedor está indisponível',
    });
  });
});
