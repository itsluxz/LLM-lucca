import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluate } from '../llm/tools/calculator.js';
import {
  assertPublicUrl,
  htmlToText,
  isBlockedAddress,
} from '../llm/tools/fetchUrl.js';
import { runTool, toolSpecs } from '../llm/tools/index.js';
import { RoundText } from '../llm/tools/loop.js';
import { OpenAiCompatible } from '../llm/providers/openaiCompatible.js';
import { anthropic } from '../llm/providers/anthropic.js';
import { google } from '../llm/providers/google.js';
import { openai } from '../llm/providers/openai.js';
import type { StreamEvent, StreamParams } from '../llm/types.js';

const ctx = { signal: new AbortController().signal, userId: 'u1' };
const sse = (frames: Array<[string, unknown]>) =>
  new Response(
    frames
      .map(
        ([event, data]) =>
          `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
      )
      .join(''),
    { status: 200 },
  );
async function collect(it: AsyncIterable<StreamEvent>) {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const bodyOf = (call: unknown[]) =>
  JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
afterEach(() => vi.unstubAllGlobals());

describe('calculadora', () => {
  it('respeita precedência e funções', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14);
    expect(evaluate('(2 + 3) * 4')).toBe(20);
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512);
    expect(evaluate('-2 ^ 2')).toBe(-4);
    expect(evaluate('2 ^ -1')).toBe(0.5);
    expect(evaluate('sqrt(144) + abs(-3)')).toBe(15);
    expect(evaluate('exp(0) + log(1000)')).toBe(4);
    expect(evaluate('10 % 4')).toBe(2);
    expect(evaluate('1.5e3 × 2')).toBe(3000);
  });
  it('recusa código e erros de sintaxe', () => {
    expect(() => evaluate('process.exit()')).toThrow();
    expect(() => evaluate('2 +')).toThrow('incompleta');
    expect(() => evaluate('1 / 0')).toThrow('finito');
    expect(() => evaluate('(1 + 2')).toThrow(')');
  });
});

describe('ler_link', () => {
  it('bloqueia endereços internos', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.0.10',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ])
      expect(isBlockedAddress(ip), ip).toBe(true);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });
  it('recusa URLs perigosas antes de qualquer acesso', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow('http');
    await expect(assertPublicUrl('http://localhost:3000')).rejects.toThrow('local');
    await expect(assertPublicUrl('http://127.0.0.1/admin')).rejects.toThrow();
    await expect(assertPublicUrl('http://[::1]/')).rejects.toThrow();
    await expect(assertPublicUrl('http://u:p@8.8.8.8/')).rejects.toThrow('senha');
    await expect(assertPublicUrl('https://8.8.8.8/')).resolves.toBeInstanceOf(URL);
  });
  it('extrai o texto legível do HTML', () => {
    const { title, text } = htmlToText(
      '<html><head><title>Oi &amp; tchau</title><style>a{}</style></head>' +
        '<body><script>alert(1)</script><h1>Título</h1><p>Olá&nbsp;mundo</p><ul><li>um</li></ul></body></html>',
    );
    expect(title).toBe('Oi & tchau');
    expect(text).toContain('Título\nOlá mundo');
    expect(text).toContain('- um');
    expect(text).not.toContain('alert');
  });
});

describe('runTool', () => {
  it('executa e devolve erros como texto para o modelo', async () => {
    expect(await runTool('calculadora', '{"expression":"6*7"}', ctx)).toBe(
      '6*7 = 42',
    );
    expect(await runTool('calculadora', '{"expression":"2+"}', ctx)).toMatch(
      /^Erro: Expressão incompleta/,
    );
    expect(await runTool('calculadora', 'não é json', ctx)).toMatch(/JSON/);
    expect(await runTool('calculadora', '{}', ctx)).toMatch(/inválidos/);
    expect(await runTool('nada', '{}', ctx)).toMatch(/não existe/);
  });
  it('só expõe as extensões pedidas', () => {
    expect(toolSpecs(['calculadora', 'inexistente']).map((t) => t.name)).toEqual([
      'calculadora',
    ]);
    expect(toolSpecs()).toEqual([]);
  });
});

it('separa o texto de voltas diferentes', () => {
  const t = new RoundText();
  t.nextRound();
  expect(t.push('Vou calcular.')).toBe('Vou calcular.');
  t.nextRound();
  expect(t.push('Dá 42.')).toBe('\n\nDá 42.');
  t.nextRound();
  expect(t.push('')).toBe('');
});

const base = (over: Partial<StreamParams> = {}): StreamParams => ({
  apiKey: 'k',
  model: 'm',
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'quanto é 6*7?' },
  ],
  tools: toolSpecs(['calculadora']),
  runTool: async (name, args) => `${name}(${args}) = 42`,
  signal: new AbortController().signal,
  ...over,
});

describe('loop de ferramentas', () => {
  it('OpenAI-compatível: executa, devolve o resultado e soma o uso', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sse([
          ['message', { choices: [{ delta: { content: 'Vou calcular.' } }] }],
          [
            'message',
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        function: { name: 'calculadora', arguments: '{"expr' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
          [
            'message',
            {
              choices: [
                {
                  delta: {
                    tool_calls: [{ index: 0, function: { arguments: 'ession":"6*7"}' } }],
                  },
                },
              ],
            },
          ],
          ['message', { choices: [], usage: { prompt_tokens: 50, completion_tokens: 10 } }],
          ['message', '[DONE]'],
        ]),
      )
      .mockResolvedValueOnce(
        sse([
          ['message', { choices: [{ delta: { content: 'É 42.' } }] }],
          ['message', { choices: [], usage: { prompt_tokens: 80, completion_tokens: 5 } }],
          ['message', '[DONE]'],
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    const runTool = vi.fn(async () => '6*7 = 42');
    const events = await collect(
      new OpenAiCompatible('x', 'X', 'https://x.test/v1').streamChat(
        base({ runTool }),
      ),
    );
    expect(runTool).toHaveBeenCalledWith('calculadora', '{"expression":"6*7"}');
    const first = bodyOf(fetchMock.mock.calls[0]);
    expect((first.tools as unknown[]).length).toBe(1);
    const second = bodyOf(fetchMock.mock.calls[1]);
    expect((second.messages as unknown[]).slice(-2)).toEqual([
      {
        role: 'assistant',
        content: 'Vou calcular.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'calculadora', arguments: '{"expression":"6*7"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '6*7 = 42' },
    ]);
    expect(events).toEqual([
      { type: 'delta', text: 'Vou calcular.' },
      { type: 'status', text: 'Calculando…' },
      { type: 'delta', text: '\n\nÉ 42.' },
      {
        type: 'usage',
        usage: { inputTokens: 130, cachedTokens: null, reasoningTokens: null, outputTokens: 15 },
      },
    ]);
  });

  it('OpenAI-compatível: modelo sem suporte a ferramentas segue sem elas', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"does not support tools"}', { status: 400 }))
      .mockResolvedValueOnce(
        sse([
          ['message', { choices: [{ delta: { content: 'Oi' } }] }],
          ['message', '[DONE]'],
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    const events = await collect(
      new OpenAiCompatible('x', 'X', 'https://x.test/v1').streamChat(base()),
    );
    expect(bodyOf(fetchMock.mock.calls[1]).tools).toBeUndefined();
    expect(events).toEqual([{ type: 'delta', text: 'Oi' }]);
  });

  it('OpenAI-compatível: a última volta bloqueia novas chamadas', async () => {
    const callOnce = () =>
      sse([
        [
          'message',
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'c', function: { name: 'calculadora', arguments: '{}' } },
                  ],
                },
              },
            ],
          },
        ],
        ['message', '[DONE]'],
      ]);
    const fetchMock = vi.fn(async () => callOnce());
    vi.stubGlobal('fetch', fetchMock);
    await collect(new OpenAiCompatible('x', 'X', 'https://x.test/v1').streamChat(base()));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(bodyOf(fetchMock.mock.calls[4]).tool_choice).toBe('none');
    expect(bodyOf(fetchMock.mock.calls[3]).tool_choice).toBeUndefined();
  });

  it('Anthropic: tool_use vira tool_result na volta seguinte', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sse([
          ['message_start', { message: { usage: { input_tokens: 40 } } }],
          ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Calculando.' } }],
          [
            'content_block_start',
            {
              index: 1,
              content_block: { type: 'tool_use', id: 'tu_1', name: 'calculadora', input: {} },
            },
          ],
          [
            'content_block_delta',
            { index: 1, delta: { type: 'input_json_delta', partial_json: '{"expression":"6*7"}' } },
          ],
          ['content_block_stop', { index: 1 }],
          ['message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }],
        ]),
      )
      .mockResolvedValueOnce(
        sse([
          ['message_start', { message: { usage: { input_tokens: 70 } } }],
          ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'É 42.' } }],
          ['message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } }],
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    const runTool = vi.fn(async () => '6*7 = 42');
    const events = await collect(anthropic.streamChat(base({ runTool })));
    expect(runTool).toHaveBeenCalledWith('calculadora', '{"expression":"6*7"}');
    const first = bodyOf(fetchMock.mock.calls[0]);
    expect(first.tools).toEqual([
      expect.objectContaining({ name: 'calculadora', input_schema: expect.any(Object) }),
    ]);
    const messages = bodyOf(fetchMock.mock.calls[1]).messages as Array<{
      role: string;
      content: unknown;
    }>;
    expect(messages.at(-2)).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Calculando.' },
        { type: 'tool_use', id: 'tu_1', name: 'calculadora', input: { expression: '6*7' } },
      ],
    });
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '6*7 = 42' }],
    });
    expect(events.map((e) => (e.type === 'delta' ? e.text : e.type))).toEqual([
      'Calculando.',
      'status',
      '\n\nÉ 42.',
      'usage',
    ]);
    expect(events.at(-1)).toEqual({
      type: 'usage',
      usage: { inputTokens: 110, cachedTokens: null, reasoningTokens: null, outputTokens: 26 },
    });
  });

  it('Gemini: functionCall vira functionResponse e mantém a assinatura', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sse([
          [
            'message',
            {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: { name: 'calculadora', args: { expression: '6*7' } },
                        thoughtSignature: 'sig',
                      },
                    ],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 8 },
            },
          ],
        ]),
      )
      .mockResolvedValueOnce(
        sse([
          [
            'message',
            {
              candidates: [{ content: { parts: [{ text: 'É 42.' }] }, finishReason: 'STOP' }],
              usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 4 },
            },
          ],
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    const runTool = vi.fn(async () => '6*7 = 42');
    const events = await collect(google.streamChat(base({ runTool })));
    expect(runTool).toHaveBeenCalledWith('calculadora', '{"expression":"6*7"}');
    const contents = bodyOf(fetchMock.mock.calls[1]).contents as unknown[];
    expect(contents.slice(-2)).toEqual([
      {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'calculadora', args: { expression: '6*7' } },
            thoughtSignature: 'sig',
          },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'calculadora', response: { result: '6*7 = 42' } } },
        ],
      },
    ]);
    expect(events).toEqual([
      { type: 'status', text: 'Calculando…' },
      { type: 'delta', text: 'É 42.' },
      {
        type: 'usage',
        usage: { inputTokens: 80, cachedTokens: null, reasoningTokens: null, outputTokens: 12 },
      },
    ]);
  });

  it('OpenAI: com extensões usa a Responses API e devolve raciocínio e resultado', async () => {
    const reasoning = { type: 'reasoning', id: 'rs_1', encrypted_content: 'enc' };
    const call = {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'calculadora',
      arguments: '{"expression":"6*7"}',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sse([
          [
            'response.completed',
            {
              type: 'response.completed',
              response: {
                output: [reasoning, call],
                usage: { input_tokens: 40, output_tokens: 10 },
              },
            },
          ],
        ]),
      )
      .mockResolvedValueOnce(
        sse([
          ['response.output_text.delta', { type: 'response.output_text.delta', delta: 'É 42.' }],
          [
            'response.completed',
            {
              type: 'response.completed',
              response: { output: [], usage: { input_tokens: 60, output_tokens: 4 } },
            },
          ],
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    const runTool = vi.fn(async () => '6*7 = 42');
    const events = await collect(openai.streamChat(base({ runTool })));
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/responses$/);
    const first = bodyOf(fetchMock.mock.calls[0]);
    expect(first.tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'calculadora' }),
    ]);
    expect(first.include).toEqual(['reasoning.encrypted_content']);
    expect((bodyOf(fetchMock.mock.calls[1]).input as unknown[]).slice(-3)).toEqual([
      reasoning,
      call,
      { type: 'function_call_output', call_id: 'call_1', output: '6*7 = 42' },
    ]);
    expect(events).toEqual([
      { type: 'status', text: 'Calculando…' },
      { type: 'delta', text: 'É 42.' },
      {
        type: 'usage',
        usage: { inputTokens: 100, cachedTokens: null, reasoningTokens: null, outputTokens: 14 },
      },
    ]);
  });

  it('OpenAI: sem extensões nem pesquisa continua no chat/completions', async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        ['message', { choices: [{ delta: { content: 'Oi' } }] }],
        ['message', '[DONE]'],
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    await collect(openai.streamChat(base({ tools: [] })));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/chat\/completions$/);
  });

  it('sem extensões, a requisição não leva tools', async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        ['message', { choices: [{ delta: { content: 'Oi' } }] }],
        ['message', '[DONE]'],
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    await collect(
      new OpenAiCompatible('x', 'X', 'https://x.test/v1').streamChat(
        base({ tools: [] }),
      ),
    );
    expect(bodyOf(fetchMock.mock.calls[0]).tools).toBeUndefined();
  });
});
