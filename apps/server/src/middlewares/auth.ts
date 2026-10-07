import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccess } from '../lib/jwt.js';
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (env.AUTH_MODE === 'local') {
      const owner = await localOwnerId();
      const profile = req.headers['x-profile-id'];
      if (typeof profile === 'string' && profile && profile !== owner) {
        const user = await prisma.user.findFirst({
          where: { id: profile, email: { endsWith: localProfileDomain } },
          select: { id: true },
        });
        // perfil excluído/inválido: volta para o perfil principal
        req.userId = user?.id ?? owner;
      } else req.userId = owner;
      return next();
    }
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ error: 'Entre na sua conta' });
    req.userId = verifyAccess(token);
    next();
  } catch {
    res.status(401).json({ error: 'Sessão inválida ou expirada' });
  }
}
/** E-mail do perfil principal do modo local; os demais perfis usam o mesmo domínio. */
export const localOwnerEmail = 'local@llm.lucca';
export const localProfileDomain = '@llm.lucca';
let ownerId: string | null = null;
export async function localOwnerId(): Promise<string> {
  if (ownerId) return ownerId;
  const user = await prisma.user.upsert({
    where: { email: localOwnerEmail },
    update: {},
    create: { email: localOwnerEmail, name: 'Lucca' },
  });
  ownerId = user.id;
  return ownerId;
}
/**
 * Dono das chaves de API. No modo local os perfis compartilham as chaves do
 * perfil principal; no modo multi cada conta tem as suas.
 */
export async function keyOwnerId(userId: string): Promise<string> {
  return env.AUTH_MODE === 'local' ? localOwnerId() : userId;
}
export function uid(req: Request): string {
  if (!req.userId) throw new Error('Usuário não autenticado');
  return req.userId;
}
