import type {
  ChatMessage,
  LLMProvider,
  ModelInfo,
  StreamParams,
  StreamEvent,
  TokenUsage,
  ToolSpec,
} from '../types.js';
import { checked, parseSse } from './sseParser.js';
import { logger } from '../../lib/logger.js';
import {
  activeTools,
  addUsage,
  maxToolRounds,
  RoundText,
  toolLabel,
} from '../tools/loop.js';
export function openAiUsage(raw: Record<string, unknown>): TokenUsage {
  const prompt = Number(raw.prompt_tokens ?? 0);
  const completion = Number(raw.completion_tokens ?? 0);
  const details = (raw.completion_tokens_details ?? {}) as Record<
    string,
    unknown
  >;
  const promptDetails = (raw.prompt_tokens_details ?? {}) as Record<
    string,
    unknown
  >;
  const thinking =
    typeof details.reasoning_tokens === 'number'
      ? details.reasoning_tokens
      : null;
  return {
    inputTokens: typeof raw.prompt_tokens === 'number' ? prompt : null,
    cachedTokens:
      typeof promptDetails.cached_tokens === 'number'
        ? promptDetails.cached_tokens
        : null,
    reasoningTokens: thinking,
    outputTokens:
      typeof raw.completion_tokens === 'number'
        ? Math.max(0, completion - (thinking ?? 0))
        : null,
  };
}
/** Mensagem com imagens vira lista de partes (texto + image_url em data URL). */
export function toOpenAiMessage(m: ChatMessage) {
  if (!m.images?.length) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [
      { type: 'text', text: m.content },
      ...m.images.map((img) => ({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType};base64,${img.data}` },
      })),
    ],
  };
}
export class OpenAiCompatible implements LLMProvider {
  constructor(
    public id: string,
    public displayName: string,
    private url: string,
  ) {}
  /** Nome do parâmetro de limite de saída aceito pelo endpoint. */
  protected maxTokensField = 'max_tokens';
  private endpoint(baseUrl?: string) {
    return (baseUrl || this.url).replace(/\/$/, '');
  }
  async listModels(apiKey: string, baseUrl?: string): Promise<ModelInfo[]> {
    const res = await checked(
      await fetch(`${this.endpoint(baseUrl)}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    );
    const body = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        context_window?: number;
        context_length?: number;
        created?: number;
      }>;
    };
    return (body.data ?? [])
      .filter((m) => m.id)
      .map((m) => ({
        id: `${this.id}:${m.id}`,
        provider: this.id,
        name: m.name || m.id,
        contextWindow: m.context_window ?? m.context_length,
        createdAt:
          typeof m.created === 'number' && m.created > 0
            ? m.created * 1000
            : undefined,
      }));
  }
  async *streamChat(params: StreamParams): AsyncIterable<StreamEvent> {
    let tools = activeTools(params);
    const messages: unknown[] = params.messages.map(toOpenAiMessage);
    const text = new RoundText();
    let usage: TokenUsage | null = null;
    for (let round = 0; round < maxToolRounds; round++) {
      const last = round === maxToolRounds - 1;
      const request = (withTools: boolean) =>
        fetch(`${this.endpoint(params.baseUrl)}/chat/completions`, {
          method: 'POST',
          signal: params.signal,
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: params.model,
            messages,
            temperature: params.temperature,
            ...(params.maxTokens !== undefined
              ? { [this.maxTokensField]: params.maxTokens }
              : {}),
            ...(withTools
              ? {
                  tools: tools.map(openAiTool),
                  // última volta: o modelo precisa responder com texto
                  ...(last ? { tool_choice: 'none' } : {}),
                }
              : {}),
            stream: true,
            stream_options: { include_usage: true },
          }),
        });
      let raw = await request(tools.length > 0);
      // modelo sem suporte a ferramentas (comum no Ollama/OpenRouter): segue sem elas
      if (round === 0 && tools.length && [400, 404, 422].includes(raw.status)) {
        logger.warn(
          {
            provider: this.id,
            model: params.model,
            status: raw.status,
            error: await raw.text().catch(() => ''),
          },
          'Modelo recusou as extensões; respondendo sem elas',
        );
        tools = [];
        raw = await request(false);
      }
      const res = await checked(raw);
      if (!res.body) throw new Error('Provedor não abriu o stream');
      text.nextRound();
      let content = '';
      const calls: Array<{ id: string; name: string; arguments: string }> = [];
      for await (const frame of parseSse(res.body)) {
        if (frame.data === '[DONE]') break;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(frame.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (data.error) throw new Error('Erro do provedor durante a geração');
        const delta = (
          data.choices as Array<{ delta?: OpenAiDelta }> | undefined
        )?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          yield { type: 'delta', text: text.push(delta.content) };
        }
        // as chamadas chegam em pedaços, agrupadas pelo índice
        for (const part of delta?.tool_calls ?? []) {
          const i = part.index ?? calls.length;
          calls[i] ??= { id: '', name: '', arguments: '' };
          if (part.id) calls[i].id = part.id;
          if (part.function?.name) calls[i].name += part.function.name;
          if (part.function?.arguments)
            calls[i].arguments += part.function.arguments;
        }
        if (data.usage && typeof data.usage === 'object')
          usage = addUsage(
            usage,
            openAiUsage(data.usage as Record<string, unknown>),
          );
      }
      const pending = calls.filter((c) => c?.name);
      if (!pending.length || !tools.length) break;
      pending.forEach((c, i) => (c.id ||= `call_${round}_${i}`));
      messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: pending.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.arguments || '{}' },
        })),
      });
      for (const call of pending) {
        yield { type: 'status', text: toolLabel(tools, call.name) };
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: await params.runTool!(call.name, call.arguments),
        });
      }
    }
    if (usage) yield { type: 'usage', usage };
  }
}
type OpenAiDelta = {
  content?: string;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
};
const openAiTool = (t: ToolSpec) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters },
});
