import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { storage } from '../../lib/storage/index.js';
import type { ImageInput } from '../../llm/types.js';
import { uid } from '../../middlewares/auth.js';
import { asyncRoute, httpError } from '../../middlewares/error.js';
export const imageRoutes = Router();
/** Caminho público (relativo ao site) usado no Markdown das mensagens. */
export const imageUrlPrefix = '/api/images/';
const keyPattern = /^img_[A-Za-z0-9]+_[a-f0-9]{24}$/;
/** O dono fica na própria chave: img_<userId>_<aleatório>. */
export function imageKey(userId: string): string {
  return `img_${userId}_${randomBytes(12).toString('hex')}`;
}
const ownedKey = (key: string, userId: string) =>
  keyPattern.test(key) && key.startsWith(`img_${userId}_`);
/** Descobre o tipo pelos primeiros bytes (não confia na extensão enviada). */
export function sniffImage(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return null;
}
const imageRef = /!\[[^\]]*\]\(\/api\/images\/(img_[A-Za-z0-9]+_[a-f0-9]{24})\)/g;
/** Chaves de imagem citadas no Markdown de uma mensagem. */
export function imageRefs(content: string): string[] {
  return [...content.matchAll(imageRef)].map((m) => m[1]);
}
/** Remove as referências de imagem do texto que vai para o modelo. */
export function stripImageRefs(content: string): string {
  return content.replace(imageRef, '').replace(/\n{3,}/g, '\n\n').trim();
}
/** Carrega as imagens do usuário citadas na mensagem (ignora as de outros donos). */
export async function loadImages(
  userId: string,
  content: string,
): Promise<ImageInput[]> {
  const out: ImageInput[] = [];
  for (const key of imageRefs(content)) {
    if (!ownedKey(key, userId)) continue;
    const data = await storage.get(key).catch(() => null);
    const mimeType = data && sniffImage(data);
    if (data && mimeType) out.push({ mimeType, data: data.toString('base64') });
  }
  return out;
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
/** Envio de imagem para anexar numa mensagem (visão). */
imageRoutes.post(
  '/',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw httpError(400, 'Envie uma imagem');
    if (!sniffImage(req.file.buffer))
      throw httpError(400, 'Formato não suportado: use PNG, JPEG, WebP ou GIF');
    const key = imageKey(uid(req));
    await storage.put(key, req.file.buffer);
    res.status(201).json({ url: `${imageUrlPrefix}${key}` });
  }),
);
imageRoutes.get(
  '/:key',
  asyncRoute(async (req, res) => {
    const { key } = req.params;
    if (!ownedKey(key, uid(req))) throw httpError(404, 'Imagem não encontrada');
    const data = await storage.get(key).catch(() => {
      throw httpError(404, 'Imagem não encontrada');
    });
    res.setHeader('Content-Type', sniffImage(data) ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(data);
  }),
);
