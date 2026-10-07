import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { env } from '../../config/env.js';
import { streams } from '../../lib/streams/index.js';
import { openSse, sendSse } from '../../lib/sse.js';
import type {
  ImageParams,
  LLMProvider,
  StreamEvent,
  TokenUsage,
} from '../../llm/types.js';
import { storage } from '../../lib/storage/index.js';
import { imageKey, imageUrlPrefix } from '../images/routes.js';
import { uid } from '../../middlewares/auth.js';
import { asyncRoute, httpError } from '../../middlewares/error.js';
import { chatLimit } from '../../middlewares/rateLimit.js';
import { validate } from '../../middlewares/validate.js';
import { ownedConversation } from '../conversations/routes.js';
import { chatContext, normalizeUsage } from './service.js';
export const chatRoutes = Router();
const send = z.object({
  content: z.string().trim().min(1).max(200000),
  model: z.string().optional(),
  webSearch: z.boolean().optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
});
const regenerateBody = send.pick({ webSearch: true, maxTokens: true });
function sourcesMarkdown(sources: Map<string, string | undefined>): string {
  if (!sources.size) return '';
  const lines = [...sources].map(([url, title], i) => {
    const label = (title || url).replace(/[[\]]/g, '');
    return `${i + 1}. [${label}](${url})`;
  });
  return `\n\n---\n**Fontes:**\n${lines.join('\n')}`;
}
chatRoutes.post(
  '/:conversationId/estimate',
  validate(z.object({ content: z.string().max(200000) })),
  asyncRoute(async (req, res) => {
    const c = await chatContext(
      req.params.conversationId,
      uid(req),
      req.body.content,
      undefined,
      false,
      false,
    );
    res.json({
      inputTokensEstimate: c.inputEstimate,
      contextWindow: c.contextWindow,
    });
  }),
);
const certErrors = [
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
];
function generationError(e: unknown): string {
  if (!(e instanceof Error)) return 'Erro ao gerar resposta';
  const code = (e.cause as { code?: unknown } | undefined)?.code;
  if (typeof code !== 'string') return e.message;
  if (certErrors.includes(code))
    return `Não foi possível conectar ao provedor: certificado TLS não confiável (${code}). Um antivírus ou proxy pode estar interceptando o HTTPS.`;
  return `Não foi possível conectar ao provedor (${code})`;
}
async function* imageEvents(
  adapter: LLMProvider,
  userId: string,
  params: ImageParams,
): AsyncIterable<StreamEvent> {
  if (!adapter.generateImage) throw new Error('Este provedor não gera imagens');
  if (!params.prompt.trim()) throw new Error('Descreva a imagem que você quer');
  yield { type: 'status', text: 'Gerando imagem…' };
  const image = await adapter.generateImage(params);
  const key = imageKey(userId);
  await storage.put(key, image.data);
  const alt = params.prompt.replace(/[[\]\n]/g, ' ').slice(0, 120);
  let text = `![${alt}](${imageUrlPrefix}${key})`;
  if (image.revisedPrompt && image.revisedPrompt !== params.prompt)
    text += `\n\n*Prompt usado:* ${image.revisedPrompt}`;
  yield { type: 'delta', text };
  if (image.usage) yield { type: 'usage', usage: image.usage };
}
async function generate(
  req: import('express').Request,
  res: import('express').Response,
  regenerate: boolean,
) {
  const userId = uid(req),
    id = req.params.conversationId;
  const c = await ownedConversation(id, userId);
  const context = await chatContext(
    id,
    userId,
    regenerate ? undefined : req.body.content,
    req.body.model,
    regenerate,
  );
  const controller = new AbortController();
  await streams.register(id, controller);
  try {
    if (regenerate) {
      const last = await prisma.message.findFirst({
        where: { conversationId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (last?.role === 'assistant')
        await prisma.message.delete({ where: { id: last.id } });
      else if (last?.role !== 'user')
        throw httpError(400, 'Não há resposta para regenerar');
    } else
      await prisma.message.create({
        data: { conversationId: id, role: 'user', content: req.body.content },
      });
  } catch (e) {
    await streams.remove(id);
    throw e;
  }
  let disconnected = false;
  res.on('close', () => {
    disconnected = true;
    controller.abort();
  });
  openSse(res);
  let content = '',
    official: TokenUsage | null = null,
    error: string | null = null;
  const sources = new Map<string, string | undefined>();
  const adapter = context.resolved.adapter;
  const apiKey = decrypt(context.key.encryptedKey, env.ENCRYPTION_KEY);
  const baseUrl = context.key.baseUrl ?? undefined;
  const started = Date.now();
  const events: AsyncIterable<StreamEvent> = adapter.isImageModel?.(
    context.resolved.model,
  )
    ? imageEvents(adapter, userId, {
        apiKey,
        baseUrl,
        model: context.resolved.model,
        prompt:
          [...context.messages].reverse().find((m) => m.role === 'user')
            ?.content ?? '',
        signal: controller.signal,
      })
    : adapter.streamChat({
        apiKey,
        baseUrl,
        model: context.resolved.model,
        messages: context.messages,
        webSearch: Boolean(req.body.webSearch && adapter.supportsWebSearch),
        maxTokens: req.body.maxTokens,
        signal: controller.signal,
      });
  try {
    for await (const event of events) {
      if (event.type === 'delta') {
        content += event.text;
        sendSse(res, 'delta', { text: event.text });
      } else if (event.type === 'status') sendSse(res, 'status', { text: event.text });
      else if (event.type === 'source') {
        if (!sources.has(event.source.url))
          sources.set(event.source.url, event.source.title);
      } else official = event.usage;
    }
  } catch (e) {
    if (!controller.signal.aborted) error = generationError(e);
  } finally {
    await streams.remove(id);
  }
  const outputText = content;
  const footer = content ? sourcesMarkdown(sources) : '';
  if (footer) {
    content += footer;
    if (!disconnected) sendSse(res, 'delta', { text: footer });
  }
  const { usage, source } = normalizeUsage(
    official,
    context.inputEstimate,
    outputText,
  );
  const message = await prisma.message.create({
    data: {
      conversationId: id,
      role: 'assistant',
      content,
      model: context.modelId,
      inputTokens: usage.inputTokens,
      cachedTokens: usage.cachedTokens,
      reasoningTokens: usage.reasoningTokens,
      outputTokens: usage.outputTokens,
      usageSource: source,
      durationMs: Date.now() - started,
      error,
    },
  });
  if (context.modelId !== c.model)
    await prisma.conversation.update({
      where: { id },
      data: { model: context.modelId },
    });
  if (!regenerate && c.title === 'Nova conversa') {
    const first =
      context.history.find((m) => m.role === 'user')?.content ??
      req.body.content;
    // anexos (<arquivo nome="...">) não entram no título; só anexo vira o nome dele
    const fileName = /<arquivo nome="([^"]*)">/.exec(first)?.[1];
    const typed = first.replace(/<arquivo nome="[^"]*">[\s\S]*?<\/arquivo>/g, ' ');
    const title =
      typed.trim().split(/\s+/).slice(0, 6).join(' ').slice(0, 80) ||
      fileName?.slice(0, 80) ||
      'Nova conversa';
    await prisma.conversation.update({ where: { id }, data: { title } });
    sendSse(res, 'title', { title });
  }
  if (!disconnected) {
    sendSse(res, 'usage', { ...usage, source, durationMs: message.durationMs });
    if (error) sendSse(res, 'error', { message: error });
    sendSse(res, 'done', { messageId: message.id });
    res.end();
  }
}
chatRoutes.post(
  '/:conversationId/stream',
  chatLimit,
  validate(send),
  asyncRoute(async (req, res) => {
    await generate(req, res, false);
  }),
);
chatRoutes.post(
  '/:conversationId/regenerate',
  chatLimit,
  validate(regenerateBody),
  asyncRoute(async (req, res) => {
    await generate(req, res, true);
  }),
);
chatRoutes.post(
  '/:conversationId/stop',
  asyncRoute(async (req, res) => {
    await ownedConversation(req.params.conversationId, uid(req));
    res.json({ stopped: await streams.stop(req.params.conversationId) });
  }),
);
