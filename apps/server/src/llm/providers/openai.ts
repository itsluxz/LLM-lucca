import type {
  ImageInput,
  ImageParams,
  ImageResult,
  ModelInfo,
  StreamEvent,
  StreamParams,
  TokenUsage,
} from '../types.js';
import { OpenAiCompatible } from './openaiCompatible.js';
import { checked, parseSse } from './sseParser.js';
import { logger } from '../../lib/logger.js';
import {
  activeTools,
  addUsage,
  maxToolRounds,
  RoundText,
  toolLabel,
} from '../tools/loop.js';
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

/** Formatos aceitos como referência na edição de imagens. */
const editableTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Corpo multipart do /images/edits: o pedido e as imagens de referência. */
export function editForm(model: string, prompt: string, images: ImageInput[]): FormData {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('n', '1');
  form.append('output_format', 'png');
  images.forEach((img, i) =>
    form.append(
      'image[]',
      new Blob([Buffer.from(img.data, 'base64')], { type: img.mimeType }),
      `imagem-${i + 1}.${extensions[img.mimeType]}`,
    ),
  );
  return form;
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
    const base = (p.baseUrl || defaultUrl).replace(/\/$/, '');
    // com imagem de referência, edita (/images/edits) em vez de criar do zero
    const references = (p.images ?? []).filter((img) => editableTypes.has(img.mimeType));
    if (p.images?.length && !references.length)
      throw new Error('Para editar, envie a imagem em PNG, JPEG ou WebP');
    if (references.length && legacy)
      throw new Error(
        'Os modelos DALL·E não editam fotos enviadas. Escolha um modelo gpt-image para editar a imagem.',
      );
    const res = await checked(
      references.length
        ? await fetch(`${base}/images/edits`, {
            method: 'POST',
            signal: p.signal,
            headers: { Authorization: `Bearer ${p.apiKey}` },
            body: editForm(p.model, p.prompt, references),
          })
        : await fetch(`${base}/images/generations`, {
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
          }),
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
    // os modelos novos só aceitam ferramentas na Responses API
    if (!params.webSearch && !activeTools(params).length) {
      yield* super.streamChat(params);
      return;
    }
    yield* this.streamResponses(params);
  }
  /** Responses API: pesquisa na web nativa e extensões (function calling). */
  private async *streamResponses(p: StreamParams): AsyncIterable<StreamEvent> {
    const instructions = p.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const input: unknown[] = p.messages
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
    let tools = activeTools(p);
    const text = new RoundText();
    let usage: TokenUsage | null = null;
    for (let round = 0; round < maxToolRounds; round++) {
      const last = round === maxToolRounds - 1;
      const request = (withTools: boolean) => {
        const functions = withTools ? tools : [];
        const list = [
          ...(p.webSearch ? [{ type: 'web_search' }] : []),
          ...functions.map((t) => ({
            type: 'function',
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        ];
        return fetch(`${(p.baseUrl || defaultUrl).replace(/\/$/, '')}/responses`, {
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
            ...(list.length ? { tools: list } : {}),
            ...(functions.length
              ? {
                  // sem store, o raciocínio precisa voltar criptografado na próxima volta
                  include: ['reasoning.encrypted_content'],
                  // última volta: o modelo precisa responder com texto
                  ...(last ? { tool_choice: 'none' } : {}),
                }
              : {}),
            ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
            ...(p.maxTokens !== undefined
              ? { max_output_tokens: p.maxTokens }
              : {}),
            stream: true,
            store: false,
          }),
        });
      };
      let raw = await request(true);
      // modelo que não aceita as extensões: registra o motivo e segue sem elas
      if (round === 0 && tools.length && [400, 404, 422].includes(raw.status)) {
        logger.warn(
          {
            provider: 'openai',
            model: p.model,
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
      let output: Array<Record<string, unknown>> = [];
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
          yield { type: 'delta', text: text.push(data.delta) };
        else if (type === 'response.web_search_call.searching')
          yield { type: 'status', text: 'Pesquisando na web…' };
        else if (type === 'response.output_text.annotation.added') {
          const a = data.annotation as
            { type?: string; url?: string; title?: string } | undefined;
          if (a?.type === 'url_citation' && a.url)
            yield { type: 'source', source: { url: a.url, title: a.title } };
        } else if (type === 'response.completed' || type === 'response.incomplete') {
          const response = data.response as Record<string, unknown> | undefined;
          if (response?.usage && typeof response.usage === 'object')
            usage = addUsage(
              usage,
              openAiResponsesUsage(response.usage as Record<string, unknown>),
            );
          if (Array.isArray(response?.output))
            output = response.output as Array<Record<string, unknown>>;
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
      const calls = output.filter((item) => item.type === 'function_call');
      if (!calls.length || !tools.length) break;
      // devolve tudo o que o modelo produziu (raciocínio, texto, chamadas) e os resultados
      input.push(...output);
      for (const call of calls) {
        const name = String(call.name);
        yield { type: 'status', text: toolLabel(tools, name) };
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: await p.runTool!(name, String(call.arguments ?? '{}')),
        });
      }
    }
    if (usage) yield { type: 'usage', usage };
  }
}

export const openai = new OpenAi('openai', 'OpenAI', defaultUrl);
