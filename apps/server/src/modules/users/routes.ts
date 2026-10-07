import { randomBytes } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import {
  localOwnerId,
  localProfileDomain,
  uid,
} from '../../middlewares/auth.js';
import { asyncRoute, httpError } from '../../middlewares/error.js';
import { validate } from '../../middlewares/validate.js';
import { personaImagesOf, publicUser } from '../auth/service.js';
import { Prisma } from '@prisma/client';
export const userRoutes = Router();
/** Paletas de cor oferecidas na Aparência (aplicadas pelo frontend). */
export const colorThemes = ['roxo', 'rosa', 'azul', 'verde', 'laranja', 'vermelho'] as const;
/** Foto de perfil: data URL de imagem já redimensionada no navegador (~até 200 KB). */
export const avatarSchema = z
  .string()
  .max(280_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Imagem inválida');
userRoutes.patch(
  '/me',
  validate(
    z.object({
      name: z.string().max(100).nullable().optional(),
      defaultModel: z.string().max(200).nullable().optional(),
      systemPrompt: z.string().max(20000).nullable().optional(),
      avatar: avatarSchema.nullable().optional(),
      personaName: z.string().trim().max(60).nullable().optional(),
      colorTheme: z.enum(colorThemes).nullable().optional(),
    }),
  ),
  asyncRoute(async (req, res) => {
    const u = await prisma.user.update({
      where: { id: uid(req) },
      data: req.body,
    });
    res.json(publicUser(u));
  }),
);
export const personaMoods = ['hello', 'thinking', 'wink', 'idle'] as const;
/** Imagem da persona: data URL redimensionada no navegador (PNG/WebP com transparência). */
const personaImageSchema = z
  .string()
  .max(450_000)
  .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/, 'Imagem inválida');
/** Troca uma imagem por vez (null volta para o mascote padrão), mantendo as outras. */
userRoutes.patch(
  '/me/persona-images',
  validate(
    z.object({
      mood: z.enum(personaMoods),
      image: personaImageSchema.nullable(),
    }),
  ),
  asyncRoute(async (req, res) => {
    const { mood, image } = req.body as {
      mood: (typeof personaMoods)[number];
      image: string | null;
    };
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: uid(req) },
      select: { personaImages: true },
    });
    const images = { ...personaImagesOf(current.personaImages) };
    if (image) images[mood] = image;
    else delete images[mood];
    const u = await prisma.user.update({
      where: { id: uid(req) },
      data: {
        personaImages: Object.keys(images).length ? images : Prisma.DbNull,
      },
    });
    res.json(publicUser(u));
  }),
);
const profileFields = {
  id: true,
  name: true,
  avatar: true,
  personaName: true,
  colorTheme: true,
} as const;
/** No modo multi cada conta é um perfil só; trocar de conta é sair/entrar. */
const localOnly: RequestHandler = (_req, _res, next) => {
  if (env.AUTH_MODE !== 'local')
    return next(httpError(404, 'Perfis estão disponíveis só no modo local'));
  next();
};
userRoutes.get(
  '/profiles',
  asyncRoute(async (req, res) => {
    if (env.AUTH_MODE !== 'local') {
      const me = await prisma.user.findUniqueOrThrow({
        where: { id: uid(req) },
        select: profileFields,
      });
      return res.json({ owner: me.id, profiles: [me] });
    }
    const owner = await localOwnerId();
    const profiles = await prisma.user.findMany({
      where: { email: { endsWith: localProfileDomain }, passwordHash: null },
      orderBy: { createdAt: 'asc' },
      select: profileFields,
    });
    res.json({ owner, profiles });
  }),
);
userRoutes.post(
  '/profiles',
  localOnly,
  validate(z.object({ name: z.string().trim().min(1).max(100) })),
  asyncRoute(async (req, res) => {
    const profile = await prisma.user.create({
      data: {
        email: `perfil-${randomBytes(8).toString('hex')}${localProfileDomain}`,
        name: req.body.name,
      },
      select: profileFields,
    });
    res.status(201).json(profile);
  }),
);
userRoutes.delete(
  '/profiles/:id',
  localOnly,
  asyncRoute(async (req, res) => {
    if (req.params.id === (await localOwnerId()))
      throw httpError(400, 'O perfil principal não pode ser excluído');
    const deleted = await prisma.user.deleteMany({
      where: {
        id: req.params.id,
        email: { endsWith: localProfileDomain },
        passwordHash: null,
      },
    });
    if (!deleted.count) throw httpError(404, 'Perfil não encontrado');
    res.status(204).end();
  }),
);
