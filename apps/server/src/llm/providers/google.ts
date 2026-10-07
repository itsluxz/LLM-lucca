import type {
  LLMProvider,
  ModelInfo,
  StreamEvent,
  StreamParams,
  TokenUsage,
} from '../types.js';
import { checked, parseSse } from './sseParser.js';
import { latestGeneration } from '../modelFilters.js';
const nonChatModel =
  /(tts|image|native-audio|embedding|transcribe|lyria|robotics|computer-use|deep-research|antigravity|nano-banana)/i;
const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiModel = {
  name: string;
  displayName?: string;
  inputTokenLimit?: number;
  supportedGenerationMethods?: string[];
};

async function checkedModels(response: Response): Promise<Response> {
  if ([400, 401, 403].includes(response.status))
    throw Object.assign(
      new Error('Chave do Gemini inválida ou sem acesso à API'),
      { status: 400, expose: true },
    );
  return checked(response);
}

export function googleUsage(raw: Record<string, unknown>): TokenUsage {
  return {
    inputTokens:
      typeof raw.promptTokenCount === 'number' ? raw.promptTokenCount : null,
    cachedTokens:
      typeof raw.cachedContentTokenCount === 'number'
        ? raw.cachedContentTokenCount
        : null,
    reasoningTokens:
      typeof raw.thoughtsTokenCount === 'number'
        ? raw.thoughtsTokenCount
        : null,
    outputTokens:
      typeof raw.candidatesTokenCount === 'number'
        ? raw.candidatesTokenCount
        : null,
  };
}
export const google: LLMProvider = {
  id: 'google',
  displayName: 'Google Gemini',
  async listModels(key: string): Promise<ModelInfo[]> {
    const models: GeminiModel[] = [];
    const seenTokens = new Set<string>();
    let pageToken: string | undefined;
    do {
      const url = new URL(`${baseUrl}/models`);
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await checkedModels(
        await fetch(url, { headers: { 'x-goog-api-key': key } }),
      );
      const data = (await res.json()) as {
        models?: GeminiModel[];
        nextPageToken?: string;
      };
      models.push(...(data.models ?? []));
      pageToken = data.nextPageToken;
      if (pageToken) {
        if (seenTokens.has(pageToken))
          throw new Error('O Gemini repetiu uma página do catálogo de modelos');
        seenTokens.add(pageToken);
      }
    } while (pageToken);
    // o catálogo do Gemini não tem data: a idade é decidida pela geração
    return latestGeneration(
      models
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        // não servem para o chat de texto (áudio, imagem, música, agentes etc.)
        .filter((m) => !nonChatModel.test(m.name))
        .map((m) => ({
          id: `google:${m.name.replace(/^models\//, '')}`,
          provider: 'google',
          name: m.displayName ?? m.name,
          contextWindow: m.inputTokenLimit,
        })),
    );
  },
  async *streamChat(p: StreamParams): AsyncIterable<StreamEvent> {
    const system = p.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const contents = p.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          ...(m.images ?? []).map((img) => ({
            inline_data: { mime_type: img.mimeType, data: img.data },
          })),
          { text: m.content },
        ],
      }));
    const res = await checked(
      await fetch(
        `${baseUrl}/models/${encodeURIComponent(p.model)}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          signal: p.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': p.apiKey,
          },
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents,
            ...(p.temperature !== undefined || p.maxTokens !== undefined
              ? {
                  generationConfig: {
                    ...(p.temperature !== undefined
                      ? { temperature: p.temperature }
                      : {}),
                    ...(p.maxTokens !== undefined
                      ? { maxOutputTokens: p.maxTokens }
                      : {}),
                  },
                }
              : {}),
          }),
        },
      ),
    );
    if (!res.body) throw new Error('Provedor não abriu o stream');
    let usage: TokenUsage | null = null;
    let visible = false;
    let blocked = false;
    for await (const frame of parseSse(res.body)) {
      const data = JSON.parse(frame.data) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; thought?: boolean }> };
          finishReason?: string;
        }>;
        promptFeedback?: { blockReason?: string };
        usageMetadata?: Record<string, unknown>;
      };
      const candidate = data.candidates?.[0];
      blocked ||= Boolean(data.promptFeedback?.blockReason);
      blocked ||= Boolean(
        candidate?.finishReason &&
          !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason),
      );
      for (const part of candidate?.content?.parts ?? [])
        if (part.text && !part.thought) {
          visible = true;
          yield { type: 'delta', text: part.text };
        }
      if (data.usageMetadata) usage = googleUsage(data.usageMetadata);
    }
    if (usage) yield { type: 'usage', usage };
    if (blocked) throw new Error('O Gemini bloqueou esta resposta');
    if (!visible) throw new Error('O Gemini não retornou texto para esta conversa');
  },
};
