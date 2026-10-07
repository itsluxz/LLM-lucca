import type { ModelInfo } from './types.js';

const monthMs = 30.44 * 24 * 60 * 60 * 1000;
/** Sufixo de snapshot: -2025-08-07, -20251001, -0613 etc. */
const snapshotSuffix = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/;

const modelId = (m: ModelInfo) => m.id.slice(m.id.indexOf(':') + 1);

/**
 * Esconde modelos lançados há mais de `maxAgeMonths` meses, usando a data
 * informada pelo provedor. Modelos sem data e o provedor "custom" (Ollama etc.,
 * onde a data é a do download) ficam. 0 desativa o filtro.
 */
export function withinAge(
  models: ModelInfo[],
  maxAgeMonths: number,
  now = Date.now(),
): ModelInfo[] {
  if (maxAgeMonths <= 0) return models;
  const limit = now - maxAgeMonths * monthMs;
  return models.filter(
    (m) => m.provider === 'custom' || m.createdAt === undefined || m.createdAt >= limit,
  );
}

/** Esconde snapshots datados quando o alias sem data também está na lista. */
export function withoutDatedSnapshots(models: ModelInfo[]): ModelInfo[] {
  const ids = new Set(models.map((m) => m.id));
  return models.filter((m) => {
    const id = modelId(m);
    const base = id.replace(snapshotSuffix, '');
    return base === id || !ids.has(`${m.provider}:${base}`);
  });
}

/**
 * Sem data no catálogo (Gemini): mantém só a geração principal mais recente de
 * cada família ("gemini-3.x" esconde "gemini-2.5"). Aliases "-latest" ficam.
 */
export function latestGeneration(models: ModelInfo[]): ModelInfo[] {
  const version = (id: string) => /^([a-z]+)-(\d+)(?:[.-]|$)/.exec(id);
  const newest = new Map<string, number>();
  for (const m of models) {
    const v = version(modelId(m));
    if (v) newest.set(v[1], Math.max(newest.get(v[1]) ?? 0, Number(v[2])));
  }
  return models.filter((m) => {
    const v = version(modelId(m));
    return !v || Number(v[2]) === newest.get(v[1]);
  });
}
