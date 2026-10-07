import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { storage } from '../../lib/storage/index.js';
import { uid } from '../../middlewares/auth.js';
import { asyncRoute, httpError } from '../../middlewares/error.js';

export const downloadRoutes = Router();
/** Caminho (relativo ao site) usado nos links das mensagens. */
export const downloadUrlPrefix = '/api/downloads/';

export const fileTypes = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
} as const;
export type FileType = keyof typeof fileTypes;

/** O dono e o tipo ficam na própria chave: dl_<userId>_<aleatório>_<tipo>. */
const keyPattern = /^dl_[A-Za-z0-9]+_[a-f0-9]{24}_(docx|xlsx|pptx|pdf)$/;
const ownedKey = (key: string, userId: string) =>
  keyPattern.test(key) && key.startsWith(`dl_${userId}_`);

/** Nome seguro para o arquivo: sem caminhos nem caracteres reservados, com a extensão certa. */
export function safeFilename(name: string | undefined, type: FileType): string {
  const base = (name ?? '')
    .replace(/\.(docx|xlsx|pptx|pdf)$/i, '')
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'arquivo'}.${type}`;
}

/** Guarda o arquivo gerado e devolve o link de download. */
export async function saveDownload(
  userId: string,
  type: FileType,
  name: string,
  data: Buffer,
): Promise<{ url: string; sizeBytes: number }> {
  const key = `dl_${userId}_${randomBytes(12).toString('hex')}_${type}`;
  await storage.put(key, data);
  return {
    url: `${downloadUrlPrefix}${key}/${encodeURIComponent(name)}`,
    sizeBytes: data.byteLength,
  };
}

downloadRoutes.get(
  '/:key/:filename',
  asyncRoute(async (req, res) => {
    const { key, filename } = req.params;
    if (!ownedKey(key, uid(req))) throw httpError(404, 'Arquivo não encontrado');
    const data = await storage.get(key).catch(() => {
      throw httpError(404, 'Arquivo não encontrado');
    });
    const type = key.slice(key.lastIndexOf('_') + 1) as FileType;
    const name = safeFilename(filename, type);
    res.setHeader('Content-Type', fileTypes[type]);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  }),
);
