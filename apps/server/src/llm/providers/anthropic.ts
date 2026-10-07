import type {
  LLMProvider,
  ModelInfo,
  StreamEvent,
  StreamParams,
  TokenUsage,
} from '../types.js';
import { checked, parseSse } from './sseParser.js';
import {
  activeTools,
  maxToolRounds,
  RoundText,
  toolLabel,
} from '../tools/loop.js';
const headers = (key: string) => ({
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'Content-Type': 'application/json',
});
export function anthropicUsage(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  thinkingText: string,
): TokenUsage {
  const cached =
    typeof input.cache_read_input_tokens === 'number'
      ? input.cache_read_input_tokens
      : null;
  const inTokens =
    typeof input.input_tokens === 'number'
      ? input.input_tokens + (cached ?? 0)
      : null;
  const reasoning = thinkingText ? Math.ceil(thinkingText.length / 4) : null;
  const out =
    typeof output.output_tokens === 'number'
      ? Math.max(0, output.output_tokens - (reasoning ?? 0))
      : null;
  return {
    inputTokens: inTokens,
    cachedTokens: cached,
    reasoningTokens: reasoning,
    outputTokens: out,
  };
}
export const anthropic: LLMProvider = {
  id: 'anthropic',
  displayName: 'Anthropic',
  async listModels(key: string): Promise<ModelInfo[]> {
    const res = await checked(
      await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: headers(key),
      }),
    );
    const body = (await res.json()) as {
      data?: Array<{ id: string; display_name: string; created_at?: string }>;
    };
    return (body.data ?? []).map((m) => {
      const created = m.created_at ? Date.parse(m.created_at) : NaN;
      return {
        id: `anthropic:${m.id}`,
        provider: 'anthropic',
        name: m.display_name,
        createdAt: Number.isNaN(created) ? undefined : created,
      };
    });
  },
  supportsWebSearch: true,
  async *streamChat(p: StreamParams): AsyncIterable<StreamEvent> {
    const system = p.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const messages: Array<{ role: string; content: unknown }> = p.messages
      .filter((m) => m.role !== 'system')
      .map((m) =>
        m.images?.length
          ? {
              role: m.role,
              // imagens antes do texto, como a Anthropic recomenda
              content: [
                ...m.images.map((img) => ({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: img.mimeType,
                    data: img.data,
                  },
                })),
                { type: 'text', text: m.content },
              ],
            }
          : { role: m.role, content: m.content },
      );
    let toolType = webSearchTools[0];
    let input: Record<string, unknown> = {};
    let output: Record<string, unknown> = {};
    let thinking = '';
    const tools = activeTools(p);
    const text = new RoundText();
    let toolRounds = 0;
    // pause_turn: a busca no servidor pausou; reenviar a resposta parcial para continuar.
    // tool_use: o modelo pediu uma extensão; executar e devolver o resultado.
    for (let turn = 0; turn <= maxContinuations + maxToolRounds; turn++) {
      // última volta de extensões: o modelo precisa responder com texto
      const lastToolRound = tools.length > 0 && toolRounds >= maxToolRounds - 1;
      const request = (tool: string) =>
        fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: p.signal,
          headers: headers(p.apiKey),
          body: JSON.stringify({
            model: p.model,
            system,
            messages,
            max_tokens: p.maxTokens ?? 4096,
            stream: true,
            temperature: p.temperature,
            ...(p.webSearch || tools.length
              ? {
                  tools: [
                    ...(p.webSearch
                      ? [{ type: tool, name: 'web_search', max_uses: 5 }]
                      : []),
                    ...tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      input_schema: t.parameters,
                    })),
                  ],
                  ...(lastToolRound ? { tool_choice: { type: 'none' } } : {}),
                }
              : {}),
          }),
        });
      let raw = await request(toolType);
      // modelos antigos não aceitam a variante nova da ferramenta
      if (raw.status === 400 && p.webSearch && toolType === webSearchTools[0]) {
        await raw.body?.cancel();
        toolType = webSearchTools[1];
        raw = await request(toolType);
      }
      const res = await checked(raw);
      if (!res.body) throw new Error('Provedor não abriu o stream');
      text.nextRound();
      const blocks: Block[] = [];
      let stopReason: string | undefined;
      for await (const frame of parseSse(res.body)) {
        const data = JSON.parse(frame.data) as Record<string, unknown>;
        if (frame.event === 'error')
          throw new Error('Erro da Anthropic durante a geração');
        if (frame.event === 'message_start') {
          const usage = ((data.message as Record<string, unknown>)?.usage ??
            {}) as Record<string, unknown>;
          input = turn === 0 ? usage : sumUsage(input, usage);
        }
        if (frame.event === 'content_block_start') {
          const block = { ...(data.content_block as Block) };
          blocks[Number(data.index)] = block;
          if (block.type === 'server_tool_use' && block.name === 'web_search')
            yield { type: 'status', text: 'Pesquisando na web…' };
        }
        if (frame.event === 'content_block_delta') {
          const block = blocks[Number(data.index)];
          const delta = data.delta as {
            type?: string;
            text?: string;
            thinking?: string;
            signature?: string;
            partial_json?: string;
            citation?: unknown;
          };
          if (delta?.type === 'text_delta' && delta.text) {
            if (block) block.text = String(block.text ?? '') + delta.text;
            yield { type: 'delta', text: text.push(delta.text) };
          }
          if (delta?.type === 'thinking_delta') {
            thinking += delta.thinking ?? '';
            if (block)
              block.thinking = String(block.thinking ?? '') + (delta.thinking ?? '');
          }
          if (delta?.type === 'signature_delta' && block)
            block.signature = String(block.signature ?? '') + (delta.signature ?? '');
          if (delta?.type === 'input_json_delta' && block)
            block.partialJson = (block.partialJson ?? '') + (delta.partial_json ?? '');
          if (delta?.type === 'citations_delta') {
            if (block)
              block.citations = [
                ...((block.citations as unknown[] | undefined) ?? []),
                delta.citation,
              ];
            const c = delta.citation as
              { type?: string; url?: unknown; title?: unknown } | undefined;
            if (c?.type === 'web_search_result_location' && typeof c.url === 'string')
              yield {
                type: 'source',
                source: {
                  url: c.url,
                  title: typeof c.title === 'string' ? c.title : undefined,
                },
              };
          }
        }
        if (frame.event === 'content_block_stop') {
          const block = blocks[Number(data.index)];
          if (block?.partialJson !== undefined) {
            try {
              block.input = JSON.parse(block.partialJson || '{}');
            } catch {
              block.input = {};
            }
            delete block.partialJson;
          }
        }
        if (frame.event === 'message_delta') {
          const usage = (data.usage ?? {}) as Record<string, unknown>;
          output = turn === 0 ? usage : sumUsage(output, usage);
          stopReason = (data.delta as { stop_reason?: string } | undefined)
            ?.stop_reason;
        }
      }
      if (stopReason === 'tool_use' && tools.length) {
        const calls = blocks.filter((b) => b?.type === 'tool_use');
        messages.push({ role: 'assistant', content: blocks.filter(Boolean) });
        const results: unknown[] = [];
        for (const call of calls) {
          yield { type: 'status', text: toolLabel(tools, String(call.name)) };
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: await p.runTool!(
              String(call.name),
              JSON.stringify(call.input ?? {}),
            ),
          });
        }
        messages.push({ role: 'user', content: results });
        toolRounds++;
        continue;
      }
      if (stopReason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: blocks.filter(Boolean) });
    }
    yield { type: 'usage', usage: anthropicUsage(input, output, thinking) };
  },
};
type Block = Record<string, unknown> & { type: string; partialJson?: string };
const webSearchTools = ['web_search_20260209', 'web_search_20250305'];
const maxContinuations = 3;
function sumUsage(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b))
    if (typeof v === 'number')
      out[k] = (typeof a[k] === 'number' ? (a[k] as number) : 0) + v;
  return out;
}
