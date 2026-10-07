import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { uid } from '../../middlewares/auth.js';
import { asyncRoute, httpError } from '../../middlewares/error.js';
import { validate } from '../../middlewares/validate.js';
export const messageRoutes = Router();
messageRoutes.patch(
  '/:id',
  validate(z.object({ content: z.string().trim().min(1).max(200000) })),
  asyncRoute(async (req, res) => {
    const m = await prisma.message.findFirst({
      where: { id: req.params.id, conversation: { userId: uid(req) } },
    });
    if (!m || m.role !== 'user')
      throw httpError(404, 'Mensagem não encontrada');
    await prisma.$transaction([
      prisma.message.deleteMany({
        where: {
          conversationId: m.conversationId,
          OR: [
            { createdAt: { gt: m.createdAt } },
            { createdAt: m.createdAt, id: { gt: m.id } },
          ],
        },
      }),
      prisma.message.update({
        where: { id: m.id },
        data: { content: req.body.content },
      }),
    ]);
    res.json(await prisma.message.findUniqueOrThrow({ where: { id: m.id } }));
  }),
);
