import type {
  ImageParams,
  ImageResult,
  ModelInfo,
  StreamEvent,
  StreamParams,
  TokenUsage,
} from '../types.js';
import { OpenAiCompatible } from './openaiCompatible.js';
import { checked, parseSse } from './sseParser.js';
const defaultUrl = 'https://api.openai.com/v1';

export function openAiResponsesUsage(raw: Record<string, unknown>): TokenUsage {
  const input = (raw.input_tokens_details ?? {}) as Record<string, unknown>;
  const output = (raw.output_tokens_details ?? {}) as Record<string, unknown>;
  const reasoning =
    typeof output.reasoning_tokens === 'number' ? output.reasoning_tokens : null;
  return {
    inputTokens: typeof raw.input_tokens === 'number' ? raw.input_tokens : null,
    cachedTokens:
      typeof input.cached_tokens === 'number' ? input.cached_tokens : null,
    reasoningTokens: reasoning,
    outputTokens:
      typeof raw.output_tokens === 'number'
        ? Math.max(0, raw.output_tokens - (reasoning ?? 0))
        : null,
  };
}

/** Modelos da API de imagens (/images/generations). */
const imageModel = /^(gpt-image|dall-e)/i;
/**
 * Modelos que não funcionam nem no chat nem na geração de imagens: áudio,
 * embeddings, e os que só existem na Responses API (codex, *-pro) ou na API
 * antiga de completions (instruct).
 */
const unsupportedModel =
  /(tts|whisper|transcribe|embedding|moderation|realtime|audio|sora|davinci|babbage|codex|-pro(-|$)|instruct|search-preview|gpt-live)/i;

class OpenAi extends OpenAiCompatible {
  supportsWebSearch = true;
  // modelos de raciocínio (o-series, gpt-5) recusam o antigo max_tokens
  protected maxTokensField = 'max_completion_tokens';
  isImageModel(model: string) {
    return imageModel.test(model);
  }
  async listModels(apiKey: string, baseUrl?: string): Promise<ModelInfo[]> {
    const models = await super.listModels(apiKey, baseUrl);
    return models
      .filter((m) => !unsupportedModel.test(m.id))
      .map((m): ModelInfo | null => {
        const id = m.id.slice(m.id.indexOf(':') + 1);
        if (this.isImageModel(id)) return { ...m, kind: 'image' };
        // outros modelos só de imagem/áudio que não são da API de imagens
        if (/image/i.test(id)) return null;
        return { ...m, kind: 'chat' };
      })
      .filter((m): m is ModelInfo => m !== null);
  }
  async generateImage(p: ImageParams): Promise<ImageResult> {
    const legacy = /^dall-e/i.test(p.model);
    const res = await checked(
      await fetch(
        `${(p.baseUrl || defaultUrl).replace(/\/$/, '')}/images/generations`,
        {
          method: 'POST',
          signal: p.signal,
          headers: {
            Authorization: `Bearer ${p.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: p.model,
            prompt: p.prompt,
            n: 1,
            // dall-e usa response_format; gpt-image sempre devolve base64
            ...(legacy
              ? { response_format: 'b64_json' }
              : { output_format: 'png' }),
          }),
        },
      ),
    );
    const body = (await res.json()) as {
      data?: Array<{ b64_json?: string; revised_prompt?: string }>;
      revised_prompt?: string;
      usage?: Record<string, unknown>;
    };
    const first = body.data?.[0];
    if (!first?.b64_json) throw new Error('A OpenAI não retornou nenhuma imagem');
    const usage = body.usage;
    return {
      data: Buffer.from(first.b64_json, 'base64'),
      mimeType: 'image/png',
      revisedPrompt: first.revised_prompt ?? body.revised_prompt,
      usage: usage ? openAiResponsesUsage(usage) : null,
    };
  }
  async *streamChat(params: StreamParams): AsyncIterable<StreamEvent> {
    if (!params.webSearch) {
      yield* super.streamChat(params);
      return;
    }
    yield* this.streamResponses(params);
  }
  /** Responses API com a ferramenta nativa web_search. */
  private async *streamResponses(p: StreamParams): AsyncIterable<StreamEvent> {
    const instructions = p.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const input = p.messages
      .filter((m) => m.role !== 'system')
      .map((m) =>
        m.images?.length
          ? {
              role: m.role,
              content: [
                { type: 'input_text', text: m.content },
                ...m.images.map((img) => ({
                  type: 'input_image',
                  image_url: `data:${img.mimeType};base64,${img.data}`,
                })),
              ],
            }
          : { role: m.role, content: m.content },
      );
    const res = await checked(
      await fetch(`${(p.baseUrl || defaultUrl).replace(/\/$/, '')}/responses`, {
        method: 'POST',
        signal: p.signal,
        headers: {
          Authorization: `Bearer ${p.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: p.model,
          ...(instructions ? { instructions } : {}),
          input,
          tools: [{ type: 'web_search' }],
          ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
          ...(p.maxTokens !== undefined
            ? { max_output_tokens: p.maxTokens }
            : {}),
          stream: true,
          store: false,
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
      const type = String(data.type ?? frame.event);
      if (type === 'response.output_text.delta' && typeof data.delta === 'string')
        yield { type: 'delta', text: data.delta };
      else if (type === 'response.web_search_call.searching')
        yield { type: 'status', text: 'Pesquisando na web…' };
      else if (type === 'response.output_text.annotation.added') {
        const a = data.annotation as
          { type?: string; url?: string; title?: string } | undefined;
        if (a?.type === 'url_citation' && a.url)
          yield { type: 'source', source: { url: a.url, title: a.title } };
      } else if (type === 'response.completed' || type === 'response.incomplete') {
        const usage = (data.response as Record<string, unknown> | undefined)
          ?.usage;
        if (usage && typeof usage === 'object')
          yield {
            type: 'usage',
            usage: openAiResponsesUsage(usage as Record<string, unknown>),
          };
      } else if (type === 'response.failed' || type === 'error') {
        const err = ((data.response as Record<string, unknown> | undefined)
          ?.error ?? data) as { message?: unknown };
        throw new Error(
          typeof err.message === 'string'
            ? `Erro da OpenAI durante a geração: ${err.message.slice(0, 300)}`
            : 'Erro da OpenAI durante a geração',
        );
      }
    }
  }
}

export const openai = new OpenAi('openai', 'OpenAI', defaultUrl);
