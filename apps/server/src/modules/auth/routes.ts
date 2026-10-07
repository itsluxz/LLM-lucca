import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth, uid } from '../../middlewares/auth.js';
import { asyncRoute } from '../../middlewares/error.js';
import { authLimit } from '../../middlewares/rateLimit.js';
import { validate } from '../../middlewares/validate.js';
import { register, login, refresh, logout, publicUser } from './service.js';
export const authRoutes = Router();
const credentials = z.object({
  email: z.email(),
  password: z.string().min(8).max(100),
});
const multiOnly: RequestHandler = (_req, res, next) => {
  if (env.AUTH_MODE === 'local')
    return res.status(404).json({ error: 'Rota não encontrada' });
  next();
};
const registrationOpen: RequestHandler = (_req, res, next) => {
  if (!env.ALLOW_REGISTER)
    return res.status(403).json({ error: 'Cadastro desativado neste servidor' });
  next();
};
authRoutes.post(
  '/register',
  multiOnly,
  registrationOpen,
  authLimit,
  validate(credentials.extend({ name: z.string().max(100).optional() })),
  asyncRoute(async (req, res) => {
    res.status(201).json(await register(req.body, res));
  }),
);
authRoutes.post(
  '/login',
  multiOnly,
  authLimit,
  validate(credentials),
  asyncRoute(async (req, res) => {
    res.json(await login(req.body, res));
  }),
);
authRoutes.post(
  '/refresh',
  multiOnly,
  authLimit,
  asyncRoute(async (req, res) => {
    res.json(await refresh(req.cookies?.refresh_token, res));
  }),
);
authRoutes.post(
  '/logout',
  multiOnly,
  asyncRoute(async (req, res) => {
    await logout(req.cookies?.refresh_token, res);
    res.status(204).end();
  }),
);
authRoutes.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: uid(req) },
    });
    res.json({ authMode: env.AUTH_MODE, user: publicUser(user) });
  }),
);
