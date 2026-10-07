import { afterEach, describe, expect, it, vi } from 'vitest';
import { openai } from '../llm/providers/openai.js';
import { anthropic } from '../llm/providers/anthropic.js';
import type { StreamEvent, StreamParams } from '../llm/types.js';

const sse = (frames: Array<[string, unknown]>) =>
  new Response(
    frames
      .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      .join(''),
    { status: 200 },
  );
const params: StreamParams = {
  apiKey: 'k',
  model: 'm',
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'oi' },
  ],
  webSearch: true,
  signal: new AbortController().signal,
};
async function collect(it: AsyncIterable<StreamEvent>) {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
afterEach(() => vi.unstubAllGlobals());

describe('web search', () => {
  it('uses the OpenAI Responses API with citations and usage', async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        ['response.web_search_call.searching', { type: 'response.web_search_call.searching' }],
        ['response.output_text.delta', { type: 'response.output_text.delta', delta: 'Olá' }],
        [
          'response.output_text.annotation.added',
          {
            type: 'response.output_text.annotation.added',
            annotation: { type: 'url_citation', url: 'https://a.com', title: 'A' },
          },
        ],
        [
          'response.completed',
          {
            type: 'response.completed',
            response: {
              usage: {
                input_tokens: 10,
                input_tokens_details: { cached_tokens: 2 },
                output_tokens: 30,
                output_tokens_details: { reasoning_tokens: 12 },
              },
            },
          },
        ],
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const events = await collect(openai.streamChat(params));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init.body));
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.instructions).toBe('sys');
    expect(events).toEqual([
      { type: 'status', text: 'Pesquisando na web…' },
      { type: 'delta', text: 'Olá' },
      { type: 'source', source: { url: 'https://a.com', title: 'A' } },
      {
        type: 'usage',
        usage: { inputTokens: 10, cachedTokens: 2, reasoningTokens: 12, outputTokens: 18 },
      },
    ]);
  });

  it('continues Anthropic pause_turn and reports citations', async () => {
    const first = sse([
      ['message_start', { message: { usage: { input_tokens: 5 } } }],
      ['content_block_start', { index: 0, content_block: { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} } }],
      ['content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"x"}' } }],
      ['content_block_stop', { index: 0 }],
      ['message_delta', { delta: { stop_reason: 'pause_turn' }, usage: { output_tokens: 3 } }],
    ]);
    const second = sse([
      ['message_start', { message: { usage: { input_tokens: 7 } } }],
      ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Resposta' } }],
      [
        'content_block_delta',
        {
          index: 0,
          delta: {
            type: 'citations_delta',
            citation: { type: 'web_search_result_location', url: 'https://b.com', title: 'B' },
          },
        },
      ],
      ['message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }],
    ]);
    const fetchMock = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.stubGlobal('fetch', fetchMock);
    const events = await collect(anthropic.streamChat(params));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    expect(body.tools[0]).toMatchObject({ type: 'web_search_20260209', name: 'web_search' });
    expect(body.messages.at(-1)).toEqual({
      role: 'assistant',
      content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } }],
    });
    expect(events).toEqual([
      { type: 'status', text: 'Pesquisando na web…' },
      { type: 'delta', text: 'Resposta' },
      { type: 'source', source: { url: 'https://b.com', title: 'B' } },
      {
        type: 'usage',
        usage: { inputTokens: 12, cachedTokens: null, reasoningTokens: null, outputTokens: 7 },
      },
    ]);
  });

  it('hides OpenAI models that cannot chat', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [
            { id: 'gpt-6-sol' },
            { id: 'gpt-image-2.5-flare' },
            { id: 'tts-1' },
            { id: 'text-embedding-3-small' },
          ],
        }),
      ),
    );
    const models = await openai.listModels('k');
    expect(models.map((m) => [m.id, m.kind])).toEqual([
      ['openai:gpt-6-sol', 'chat'],
      ['openai:gpt-image-2.5-flare', 'image'],
    ]);
  });

  it('generates OpenAI images as PNG with usage', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [{ b64_json: Buffer.from('png').toString('base64') }],
        revised_prompt: 'um gato astronauta',
        usage: { input_tokens: 9, output_tokens: 1000 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const image = await openai.generateImage({
      apiKey: 'k',
      model: 'gpt-image-2.5-flare',
      prompt: 'gato',
      signal: new AbortController().signal,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gpt-image-2.5-flare',
      prompt: 'gato',
      output_format: 'png',
    });
    expect(image.data.toString()).toBe('png');
    expect(image.revisedPrompt).toBe('um gato astronauta');
    expect(image.usage).toMatchObject({ inputTokens: 9, outputTokens: 1000 });
  });

  it('falls back to the basic Anthropic tool on older models', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(
        sse([['message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }]]),
      );
    vi.stubGlobal('fetch', fetchMock);
    await collect(anthropic.streamChat(params));
    const body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    expect(body.tools[0].type).toBe('web_search_20250305');
  });
});
