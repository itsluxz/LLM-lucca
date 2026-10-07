import type {
  LLMProvider,
  ModelInfo,
  StreamEvent,
  StreamParams,
  TokenUsage,
} from '../types.js';
import { checked, parseSse } from './sseParser.js';
import { latestGeneration } from '../modelFilters.js';
import {
  activeTools,
  addUsage,
  maxToolRounds,
  RoundText,
  toolLabel,
} from '../tools/loop.js';
const nonChatModel =
  /(tts|image|native-audio|embedding|transcribe|lyria|robotics|computer-use|deep-research|antigravity|nano-banana)/i;
const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name?: string; args?: unknown; id?: string };
};

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
    const contents: Array<{ role: string; parts: unknown[] }> = p.messages
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
    const tools = activeTools(p);
    const text = new RoundText();
    let usage: TokenUsage | null = null;
    let visible = false;
    let blocked = false;
    for (let round = 0; round < maxToolRounds; round++) {
      const last = round === maxToolRounds - 1;
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
              ...(system
                ? { systemInstruction: { parts: [{ text: system }] } }
                : {}),
              contents,
              ...(tools.length
                ? {
                    tools: [
                      {
                        functionDeclarations: tools.map((t) => ({
                          name: t.name,
                          description: t.description,
                          parameters: t.parameters,
                        })),
                      },
                    ],
                    // última volta: o modelo precisa responder com texto
                    ...(last
                      ? { toolConfig: { functionCallingConfig: { mode: 'NONE' } } }
                      : {}),
                  }
                : {}),
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
      text.nextRound();
      // partes do modelo nesta volta, devolvidas como vieram (inclui thoughtSignature)
      const parts: GeminiPart[] = [];
      let roundUsage: TokenUsage | null = null;
      for await (const frame of parseSse(res.body)) {
        const data = JSON.parse(frame.data) as {
          candidates?: Array<{
            content?: { parts?: GeminiPart[] };
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
        for (const part of candidate?.content?.parts ?? []) {
          parts.push(part);
          if (part.text && !part.thought) {
            visible = true;
            yield { type: 'delta', text: text.push(part.text) };
          }
        }
        // o Gemini repete o uso acumulado da volta em cada pedaço
        if (data.usageMetadata) roundUsage = googleUsage(data.usageMetadata);
      }
      usage = addUsage(usage, roundUsage);
      const calls = parts.filter((part) => part.functionCall?.name);
      if (!calls.length || !tools.length || blocked) break;
      contents.push({ role: 'model', parts });
      const responses: unknown[] = [];
      for (const { functionCall: call } of calls) {
        const name = String(call!.name);
        yield { type: 'status', text: toolLabel(tools, name) };
        const result = await p.runTool!(name, JSON.stringify(call!.args ?? {}));
        responses.push({
          functionResponse: {
            name,
            ...(call!.id ? { id: call!.id } : {}),
            response: { result },
          },
        });
      }
      contents.push({ role: 'user', parts: responses });
    }
    if (usage) yield { type: 'usage', usage };
    if (blocked) throw new Error('O Gemini bloqueou esta resposta');
    if (!visible) throw new Error('O Gemini não retornou texto para esta conversa');
  },
};
