import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { uid } from '../../middlewares/auth.js';
import { asyncRoute, httpError } from '../../middlewares/error.js';
import { validate } from '../../middlewares/validate.js';
export const conversationRoutes = Router();
const create = z.object({
  model: z.string().min(3).max(200),
  projectId: z.string().nullable().optional(),
});
const update = z.object({
  title: z.string().min(1).max(200).optional(),
  pinned: z.boolean().optional(),
  model: z.string().min(3).max(200).optional(),
  projectId: z.string().nullable().optional(),
});
export async function ownedConversation(id: string, userId: string) {
  const c = await prisma.conversation.findFirst({
    where: { id, userId },
    include: { project: { include: { files: true } } },
  });
  if (!c) throw httpError(404, 'Conversa não encontrada');
  return c;
}
async function checkProject(
  projectId: string | null | undefined,
  userId: string,
) {
  if (!projectId) return;
  const p = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!p) throw httpError(404, 'Projeto não encontrado');
}
export function usageTotals(
  messages: Array<{
    role: string;
    inputTokens: number | null;
    reasoningTokens: number | null;
    outputTokens: number | null;
  }>,
) {
  const replies = messages.filter((m) => m.role === 'assistant');
  return {
    inputTokens: replies.reduce((n, m) => n + (m.inputTokens ?? 0), 0),
    reasoningTokens: replies.reduce((n, m) => n + (m.reasoningTokens ?? 0), 0),
    outputTokens: replies.reduce((n, m) => n + (m.outputTokens ?? 0), 0),
    responses: replies.length,
  };
}
conversationRoutes.get(
  '/',
  asyncRoute(async (req, res) => {
    const query = z
      .object({
        projectId: z.string().optional(),
        search: z.string().max(200).optional(),
        cursor: z.string().optional(),
      })
      .parse(req.query);
    const where = {
      userId: uid(req),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.search
        ? { title: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const list = await prisma.conversation.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      take: 31,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    res.json({
      items: list.slice(0, 30),
      nextCursor: list.length > 30 ? list[29].id : null,
    });
  }),
);
conversationRoutes.post(
  '/',
  validate(create),
  asyncRoute(async (req, res) => {
    await checkProject(req.body.projectId, uid(req));
    const c = await prisma.conversation.create({
      data: {
        userId: uid(req),
        model: req.body.model,
        projectId: req.body.projectId,
      },
    });
    res.status(201).json(c);
  }),
);
conversationRoutes.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const c = await ownedConversation(req.params.id, uid(req));
    const messages = await prisma.message.findMany({
      where: { conversationId: c.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    res.json({ ...c, project: undefined, messages, usageTotals: usageTotals(messages) });
  }),
);
conversationRoutes.patch(
  '/:id',
  validate(update),
  asyncRoute(async (req, res) => {
    const c = await ownedConversation(req.params.id, uid(req));
    await checkProject(req.body.projectId, uid(req));
    res.json(
      await prisma.conversation.update({ where: { id: c.id }, data: req.body }),
    );
  }),
);
conversationRoutes.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const c = await ownedConversation(req.params.id, uid(req));
    await prisma.conversation.delete({ where: { id: c.id } });
    res.status(204).end();
  }),
);
