import type {
  ChatMessage,
  LLMProvider,
  ModelInfo,
  StreamParams,
  StreamEvent,
  TokenUsage,
} from '../types.js';
import { checked, parseSse } from './sseParser.js';
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
    const res = await checked(
      await fetch(`${this.endpoint(params.baseUrl)}/chat/completions`, {
        method: 'POST',
        signal: params.signal,
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages.map(toOpenAiMessage),
          temperature: params.temperature,
          ...(params.maxTokens !== undefined
            ? { [this.maxTokensField]: params.maxTokens }
            : {}),
          stream: true,
          stream_options: { include_usage: true },
        }),
      }),
    );
    if (!res.body) throw new Error('Provedor não abriu o stream');
    for await (const frame of parseSse(res.body)) {
      if (frame.data === '[DONE]') break;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(frame.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (data.error) throw new Error('Erro do provedor durante a geração');
      const choices = data.choices as
        Array<{ delta?: { content?: string } }> | undefined;
      const text = choices?.[0]?.delta?.content;
      if (text) yield { type: 'delta', text };
      if (data.usage && typeof data.usage === 'object')
        yield {
          type: 'usage',
          usage: openAiUsage(data.usage as Record<string, unknown>),
        };
    }
  }
}
