import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { sha256 } from '../../lib/crypto.js';
import { signAccess } from '../../lib/jwt.js';
import { env } from '../../config/env.js';
import { httpError } from '../../middlewares/error.js';
const thirtyDays = 30 * 24 * 60 * 60 * 1000;
/** Lê o JSON de imagens da persona, ignorando qualquer chave/valor inesperado. */
export function personaImagesOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const mood of ['hello', 'thinking', 'wink', 'idle'])
    if (typeof (value as Record<string, unknown>)[mood] === 'string')
      out[mood] = (value as Record<string, string>)[mood];
  return out;
}
export const publicUser = (u: {
  id: string;
  email: string;
  name: string | null;
  defaultModel: string | null;
  systemPrompt: string | null;
  avatar?: string | null;
  personaName?: string | null;
  colorTheme?: string | null;
  personaImages?: unknown;
}) => ({
  personaImages: personaImagesOf(u.personaImages),
  id: u.id,
  email: u.email,
  name: u.name,
  defaultModel: u.defaultModel,
  systemPrompt: u.systemPrompt,
  avatar: u.avatar ?? null,
  personaName: u.personaName ?? null,
  colorTheme: u.colorTheme ?? null,
});
function cookie(res: Response, value: string) {
  res.cookie('refresh_token', value, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    maxAge: thirtyDays,
    path: '/api/auth',
  });
}
export async function startSession(userId: string, res: Response) {
  const raw = randomBytes(48).toString('base64url');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + thirtyDays),
    },
  });
  cookie(res, raw);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return { accessToken: signAccess(userId), user: publicUser(user) };
}
export async function register(
  data: { email: string; password: string; name?: string },
  res: Response,
) {
  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      name: data.name,
      passwordHash: await bcrypt.hash(data.password, 12),
    },
  });
  return startSession(user.id, res);
}
export async function login(
  data: { email: string; password: string },
  res: Response,
) {
  const user = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });
  if (
    !user?.passwordHash ||
    !(await bcrypt.compare(data.password, user.passwordHash))
  )
    throw httpError(401, 'E-mail ou senha incorretos');
  return startSession(user.id, res);
}
export async function refresh(raw: string | undefined, res: Response) {
  if (!raw) throw httpError(401, 'Sessão expirada');
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(raw) },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now())
    throw httpError(401, 'Sessão expirada');
  await prisma.refreshToken.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });
  return startSession(row.userId, res);
}
export async function logout(raw: string | undefined, res: Response) {
  if (raw)
    await prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(raw) },
      data: { revokedAt: new Date() },
    });
  res.clearCookie('refresh_token', { path: '/api/auth' });
}
