import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { cache } from '../../lib/cache/index.js';
import { env } from '../../config/env.js';
import { providers } from '../../llm/registry.js';
import { keyOwnerId, uid } from '../../middlewares/auth.js';
import { asyncRoute, httpError } from '../../middlewares/error.js';
import { validate } from '../../middlewares/validate.js';
export const providerRoutes = Router();
const supported = Object.values(providers).map((p) => ({
  id: p.id,
  name: p.displayName,
}));
const config = z.object({
  provider: z.enum([
    'openai',
    'anthropic',
    'google',
    'openrouter',
    'groq',
    'mistral',
    'deepseek',
    'custom',
  ]),
  apiKey: z.string().min(1),
  label: z.string().max(100).default(''),
  baseUrl: z.url().optional(),
});
function sanitize(k: {
  id: string;
  provider: string;
  label: string;
  encryptedKey: string;
  baseUrl: string | null;
  enabled: boolean;
  createdAt: Date;
}) {
  let last4: string;
  try {
    last4 = decrypt(k.encryptedKey, env.ENCRYPTION_KEY).slice(-4);
  } catch {
    last4 = '';
  }
  return {
    id: k.id,
    provider: k.provider,
    label: k.label,
    baseUrl: k.baseUrl,
    enabled: k.enabled,
    last4,
    createdAt: k.createdAt,
  };
}
function checkUrl(provider: string, url?: string) {
  if (provider === 'custom' && !url)
    throw httpError(400, 'Informe a URL do endpoint personalizado');
  if (url && env.AUTH_MODE === 'multi' && !url.startsWith('https://'))
    throw httpError(
      400,
      'No modo multiusuário, use HTTPS para endpoints personalizados',
    );
}
providerRoutes.get(
  '/',
  asyncRoute(async (req, res) => {
    const keys = await prisma.providerKey.findMany({
      where: { userId: await keyOwnerId(uid(req)) },
    });
    res.json({ supported, configured: keys.map(sanitize) });
  }),
);
providerRoutes.post(
  '/',
  validate(config),
  asyncRoute(async (req, res) => {
    const { provider, apiKey, label, baseUrl } = req.body as z.infer<
      typeof config
    >;
    checkUrl(provider, baseUrl);
    await providers[provider].listModels(apiKey, baseUrl);
    const row = await prisma.providerKey.create({
      data: {
        userId: await keyOwnerId(uid(req)),
        provider,
        label,
        baseUrl,
        encryptedKey: encrypt(apiKey, env.ENCRYPTION_KEY),
      },
    });
    await cache.del(`models:${await keyOwnerId(uid(req))}`);
    res.status(201).json(sanitize(row));
  }),
);
providerRoutes.patch(
  '/:id',
  validate(
    z.object({
      enabled: z.boolean().optional(),
      label: z.string().max(100).optional(),
      apiKey: z.string().min(1).optional(),
      baseUrl: z.url().optional(),
    }),
  ),
  asyncRoute(async (req, res) => {
    const old = await prisma.providerKey.findFirst({
      where: { id: req.params.id, userId: await keyOwnerId(uid(req)) },
    });
    if (!old) throw httpError(404, 'Provedor não encontrado');
    const key =
      req.body.apiKey ?? decrypt(old.encryptedKey, env.ENCRYPTION_KEY);
    const url = req.body.baseUrl ?? old.baseUrl ?? undefined;
    checkUrl(old.provider, url);
    if (req.body.apiKey || req.body.baseUrl)
      await providers[old.provider].listModels(key, url);
    const row = await prisma.providerKey.update({
      where: { id: old.id },
      data: {
        enabled: req.body.enabled,
        label: req.body.label,
        baseUrl: url,
        encryptedKey: encrypt(key, env.ENCRYPTION_KEY),
      },
    });
    await cache.del(`models:${await keyOwnerId(uid(req))}`);
    res.json(sanitize(row));
  }),
);
providerRoutes.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const row = await prisma.providerKey.findFirst({
      where: { id: req.params.id, userId: await keyOwnerId(uid(req)) },
    });
    if (!row) throw httpError(404, 'Provedor não encontrado');
    await prisma.providerKey.delete({ where: { id: row.id } });
    await cache.del(`models:${await keyOwnerId(uid(req))}`);
    res.status(204).end();
  }),
);
