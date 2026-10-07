import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { env } from '../../config/env.js';
import { cache } from '../../lib/cache/index.js';
import { resolveModel } from '../../llm/registry.js';
import { buildContext, estimateTokens } from '../../llm/context.js';
import type { ChatMessage, TokenUsage } from '../../llm/types.js';
import { ownedConversation } from '../conversations/routes.js';
import { httpError } from '../../middlewares/error.js';
import { keyOwnerId } from '../../middlewares/auth.js';
import { imageRefs, loadImages, stripImageRefs } from '../images/routes.js';
export const defaultPersonaName = 'AI Hoshino';
const tokensPerImage = 1000;
export async function chatContext(
  conversationId: string,
  userId: string,
  newContent?: string,
  modelId?: string,
  regenerate = false,
  /** false no /estimate: só conta as imagens, sem ler os arquivos. */
  withImages = true,
) {
  const c = await ownedConversation(conversationId, userId);
  const id = modelId ?? c.model;
  const resolved = resolveModel(id);
  const owner = await keyOwnerId(userId);
  const key = await prisma.providerKey.findFirst({
    where: { userId: owner, provider: resolved.provider, enabled: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!key)
    throw httpError(400, 'Configure a chave deste provedor antes de conversar');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const windowKey = `modelWindow:${owner}:${id}`;
  let window = await cache.get<number>(windowKey);
  if (!window) {
    const catalog = await resolved.adapter
      .listModels(
        decrypt(key.encryptedKey, env.ENCRYPTION_KEY),
        key.baseUrl ?? undefined,
      )
      .catch(() => []);
    window = catalog.find((m) => m.id === id)?.contextWindow ?? 128000;
    await cache.set(windowKey, window, 600000);
  }
  const history = await prisma.message.findMany({
    where: { conversationId: c.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (regenerate && history.at(-1)?.role === 'assistant') history.pop();
  let imageCount = 0;
  const toMessage = async (
    role: 'user' | 'assistant',
    content: string,
  ): Promise<ChatMessage> => {
    // só as mensagens do usuário levam imagens para o modelo (visão)
    if (role !== 'user' || !imageRefs(content).length) return { role, content };
    imageCount += imageRefs(content).length;
    return {
      role,
      content: stripImageRefs(content) || '(imagem enviada)',
      images: withImages ? await loadImages(userId, content) : undefined,
    };
  };
  const chatHistory: ChatMessage[] = await Promise.all(
    history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => toMessage(m.role as 'user' | 'assistant', m.content)),
  );
  if (newContent) chatHistory.push(await toMessage('user', newContent));
  const messages = buildContext({
    base: env.BASE_SYSTEM_PROMPT.replaceAll(
      '{persona}',
      user.personaName?.trim() || defaultPersonaName,
    ),
    user: user.systemPrompt,
    project: c.project?.instructions,
    files: c.project?.files,
    history: chatHistory,
    contextWindow: window,
  });
  return {
    conversation: c,
    modelId: id,
    resolved,
    key,
    messages,
    contextWindow: window,
    // imagem: estimativa grosseira de ~1.000 tokens cada (varia por provedor e tamanho)
    inputEstimate:
      messages.reduce((n, m) => n + estimateTokens(m.content), 0) +
      imageCount * tokensPerImage,
    history,
  };
}
export function normalizeUsage(
  official: TokenUsage | null,
  inputEstimate: number,
  text: string,
): { usage: TokenUsage; source: 'provider' | 'estimate' } {
  const usage: TokenUsage = {
    inputTokens: official?.inputTokens ?? inputEstimate,
    cachedTokens: official?.cachedTokens ?? null,
    reasoningTokens: official?.reasoningTokens ?? null,
    outputTokens: official?.outputTokens ?? estimateTokens(text),
  };
  return {
    usage,
    source:
      official?.inputTokens != null && official.outputTokens != null
        ? 'provider'
        : 'estimate',
  };
}
