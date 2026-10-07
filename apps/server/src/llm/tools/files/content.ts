import { z } from 'zod';
import {
  saveDownload,
  safeFilename,
  type FileType,
} from '../../../modules/downloads/routes.js';
import { ToolError, type ToolContext } from '../types.js';

/** Paleta do site, usada nos arquivos gerados. */
export const colors = {
  primary: '7B3FE4',
  accent: 'E8336E',
  text: '1E1830',
  muted: '6B5F86',
  headerFill: 'EFE7FD',
  line: 'D9CFF0',
};

const cell = z.string().max(2000);
const rows = z.array(z.array(cell).max(30)).max(500);

/** Bloco de conteúdo de documentos (Word e PDF). */
export const blockSchema = z.object({
  type: z.enum(['heading', 'paragraph', 'bullets', 'numbered', 'table', 'quote', 'page_break']),
  text: z.string().max(20000).optional(),
  level: z.number().int().min(1).max(3).optional(),
  items: z.array(z.string().max(5000)).max(200).optional(),
  headers: z.array(cell).max(30).optional(),
  rows: rows.optional(),
});
export type Block = z.infer<typeof blockSchema>;

export const documentSchema = z.object({
  filename: z.string().max(120),
  title: z.string().max(300).optional(),
  blocks: z.array(blockSchema).min(1).max(400),
});
export type DocumentInput = z.infer<typeof documentSchema>;

const stringArray = { type: 'array', items: { type: 'string' } };
const tableRows = {
  type: 'array',
  description: 'Linhas da tabela; cada linha é uma lista de células (texto).',
  items: stringArray,
};

/** JSON Schema do documento, no subconjunto aceito por OpenAI, Anthropic e Gemini. */
export const documentParameters = {
  type: 'object',
  properties: {
    filename: {
      type: 'string',
      description: 'Nome do arquivo, sem extensão. Ex.: Relatório de vendas 2026',
    },
    title: { type: 'string', description: 'Título principal, no topo da primeira página.' },
    blocks: {
      type: 'array',
      description: 'Conteúdo do documento, em ordem.',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['heading', 'paragraph', 'bullets', 'numbered', 'table', 'quote', 'page_break'],
            description:
              'heading (usa text e level), paragraph (text), bullets e numbered (items), table (headers e rows), quote (text), page_break.',
          },
          text: {
            type: 'string',
            description: 'Texto. Aceita **negrito** e *itálico*.',
          },
          level: { type: 'integer', description: 'Nível do título: 1, 2 ou 3.' },
          items: { ...stringArray, description: 'Itens da lista. Aceitam **negrito** e *itálico*.' },
          headers: { ...stringArray, description: 'Cabeçalho da tabela.' },
          rows: tableRows,
        },
        required: ['type'],
      },
    },
  },
  required: ['filename', 'blocks'],
};

export type Run = { text: string; bold?: boolean; italic?: boolean };

/** Quebra "texto **negrito** e *itálico*" em trechos com formatação. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true });
    else runs.push({ text: m[2], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text: '' }];
}

export const plain = (text: string) =>
  parseInline(text)
    .map((r) => r.text)
    .join('');

/** Salva o arquivo, avisa a rota (que anexa o link) e devolve o texto para o modelo. */
export async function deliver(
  ctx: ToolContext,
  type: FileType,
  filename: string,
  data: Buffer,
  summary: string,
): Promise<string> {
  if (data.byteLength > 20 * 1024 * 1024)
    throw new ToolError('O arquivo ficou grande demais (limite de 20 MB)');
  const name = safeFilename(filename, type);
  const saved = await saveDownload(ctx.userId, type, name, data);
  ctx.onFile?.({ name, ...saved });
  return (
    `Arquivo "${name}" criado (${Math.max(1, Math.round(saved.sizeBytes / 1024))} KB; ${summary}). ` +
    'O link de download aparece automaticamente no fim da sua resposta: não escreva o link nem invente outro. ' +
    'Diga ao usuário que o arquivo está pronto e resuma em poucas linhas o que ele contém.'
  );
}
