import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { cache } from '../../lib/cache/index.js';
import { env } from '../../config/env.js';
import { providers } from '../../llm/registry.js';
import type { ModelInfo } from '../../llm/types.js';
import { withinAge, withoutDatedSnapshots } from '../../llm/modelFilters.js';

export async function listUserModels(userId: string): Promise<ModelInfo[]> {
  const key = `models:${userId}`;
  const cached = await cache.get<ModelInfo[]>(key);
  if (cached) return cached;
  const rows = await prisma.providerKey.findMany({
    where: { userId, enabled: true },
  });
  const lists = await Promise.all(
    rows.map(async (row) => {
      try {
        return await providers[row.provider].listModels(
          decrypt(row.encryptedKey, env.ENCRYPTION_KEY),
          row.baseUrl ?? undefined,
        );
      } catch {
        return [];
      }
    }),
  );
  // snapshots antes da idade: senão um alias antigo sai e deixa a cópia datada
  const current = withinAge(
    withoutDatedSnapshots(lists.flat()),
    env.MODEL_MAX_AGE_MONTHS,
  );
  const models = current.map((m) => ({
    ...m,
    kind: m.kind ?? 'chat',
    supportsWebSearch:
      m.kind !== 'image' && Boolean(providers[m.provider]?.supportsWebSearch),
  }));
  await cache.set(key, models, 600000);
  return models;
}
