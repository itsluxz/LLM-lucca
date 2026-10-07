import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pdf from 'pdf-parse';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { storage } from '../../lib/storage/index.js';
import { estimateTokens } from '../../llm/context.js';
import { uid } from '../../middlewares/auth.js';
import { asyncRoute, httpError } from '../../middlewares/error.js';
import { validate } from '../../middlewares/validate.js';
export const projectRoutes = Router();
const data = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(50000).nullable().optional(),
  emoji: z.string().max(10).nullable().optional(),
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const allowed = new Set([
  '.txt',
  '.md',
  '.pdf',
  '.json',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.html',
  '.css',
  '.sql',
  '.yml',
  '.yaml',
  '.sh',
  '.xml',
]);
async function owned(id: string, userId: string) {
  const p = await prisma.project.findFirst({
    where: { id, userId },
    include: { files: true, _count: { select: { conversations: true } } },
  });
  if (!p) throw httpError(404, 'Projeto não encontrado');
  return p;
}
projectRoutes.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json(
      await prisma.project.findMany({
        where: { userId: uid(req) },
        include: { _count: { select: { conversations: true, files: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  }),
);
projectRoutes.post(
  '/',
  validate(data),
  asyncRoute(async (req, res) => {
    res
      .status(201)
      .json(
        await prisma.project.create({
          data: { ...req.body, userId: uid(req) },
        }),
      );
  }),
);
projectRoutes.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const p = await owned(req.params.id, uid(req));
    res.json({
      ...p,
      files: p.files.map(({ textContent: _text, ...file }) => file),
    });
  }),
);
projectRoutes.patch(
  '/:id',
  validate(data.partial()),
  asyncRoute(async (req, res) => {
    const p = await owned(req.params.id, uid(req));
    res.json(
      await prisma.project.update({ where: { id: p.id }, data: req.body }),
    );
  }),
);
projectRoutes.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const p = await owned(req.params.id, uid(req));
    await prisma.project.delete({ where: { id: p.id } });
    await Promise.allSettled(p.files.map((f) => storage.delete(f.storageKey)));
    res.status(204).end();
  }),
);
projectRoutes.post(
  '/:id/files',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    const p = await owned(req.params.id, uid(req));
    if (!req.file) throw httpError(400, 'Envie um arquivo');
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!allowed.has(ext))
      throw httpError(400, 'Formato de arquivo não aceito');
    let text: string;
    try {
      text =
        ext === '.pdf'
          ? (await pdf(req.file.buffer)).text
          : req.file.buffer.toString('utf8');
    } catch {
      throw httpError(400, 'Não foi possível ler o arquivo');
    }
    if (!text.trim()) throw httpError(400, 'Arquivo sem texto extraível');
    const key = randomUUID();
    await storage.put(key, req.file.buffer);
    try {
      const f = await prisma.projectFile.create({
        data: {
          projectId: p.id,
          filename: path.basename(req.file.originalname),
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          storageKey: key,
          textContent: text,
          tokenEstimate: estimateTokens(text),
        },
      });
      res.status(201).json({ ...f, textContent: undefined });
    } catch (e) {
      await storage.delete(key);
      throw e;
    }
  }),
);
projectRoutes.delete(
  '/:id/files/:fileId',
  asyncRoute(async (req, res) => {
    await owned(req.params.id, uid(req));
    const f = await prisma.projectFile.findFirst({
      where: { id: req.params.fileId, projectId: req.params.id },
    });
    if (!f) throw httpError(404, 'Arquivo não encontrado');
    await prisma.projectFile.delete({ where: { id: f.id } });
    await storage.delete(f.storageKey);
    res.status(204).end();
  }),
);
