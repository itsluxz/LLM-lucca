import pptxModule from 'pptxgenjs';
import type * as Pptx from 'pptxgenjs';
import { z } from 'zod';
import type { Tool } from '../types.js';
import { colors, deliver, parseInline, plain } from './content.js';

const cell = z.string().max(1000);
const slideSchema = z.object({
  title: z.string().max(300),
  bullets: z.array(z.string().max(1000)).max(20).optional(),
  text: z.string().max(5000).optional(),
  table: z
    .object({
      headers: z.array(cell).max(12).optional(),
      rows: z.array(z.array(cell).max(12)).max(30),
    })
    .optional(),
  notes: z.string().max(5000).optional(),
});
const presentationSchema = z.object({
  filename: z.string().max(120),
  title: z.string().max(300).optional(),
  subtitle: z.string().max(500).optional(),
  slides: z.array(slideSchema).min(1).max(60),
});
type PresentationInput = z.infer<typeof presentationSchema>;

/**
 * O pacote não declara "type": "module", então o TypeScript lê os tipos como
 * CommonJS (classe em .default), mas o Node carrega o build ESM, cujo default
 * já é a classe. Aceita os dois formatos.
 */
const PptxGenJS = ((pptxModule as { default?: unknown }).default ??
  pptxModule) as typeof pptxModule.default;
type TextProps = Pptx.default.TextPropsOptions;
type TableRow = Pptx.default.TableRow;

// layout 16:9 (13,33 x 7,5 polegadas)
const W = 13.33;
const margin = 0.6;
const font = 'Calibri';

const textRuns = (text: string, options: TextProps = {}) =>
  parseInline(text).map((r) => ({
    text: r.text,
    options: { ...options, bold: r.bold || options.bold, italic: r.italic },
  }));

export async function buildPowerPoint(input: PresentationInput): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'LLM — Lucca Language Model';
  pptx.title = input.title ?? input.filename;
  if (input.title) {
    const cover = pptx.addSlide();
    cover.background = { color: colors.primary };
    cover.addShape(pptx.ShapeType.rect, {
      x: 0, y: 6.9, w: W, h: 0.6, fill: { color: colors.accent }, line: { color: colors.accent },
    });
    cover.addText(plain(input.title), {
      x: margin, y: 2.2, w: W - 2 * margin, h: 1.6,
      fontFace: font, fontSize: 44, bold: true, color: 'FFFFFF', valign: 'bottom',
    });
    if (input.subtitle)
      cover.addText(plain(input.subtitle), {
        x: margin, y: 3.9, w: W - 2 * margin, h: 1,
        fontFace: font, fontSize: 22, color: 'F3EEFC', valign: 'top',
      });
  }
  input.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: colors.primary }, line: { color: colors.primary },
    });
    slide.addText(plain(s.title), {
      x: margin, y: 0.35, w: W - 2 * margin, h: 0.95,
      fontFace: font, fontSize: 30, bold: true, color: colors.primary, valign: 'middle',
    });
    slide.addText(String(i + 1), {
      x: W - 1.1, y: 6.95, w: 0.6, h: 0.35, fontFace: font, fontSize: 11, color: colors.muted, align: 'right',
    });
    // a área de conteúdo é dividida entre texto, tópicos e tabela, na ordem
    let y = 1.5;
    const bottom = 6.8;
    const parts = [s.text, s.bullets?.length, s.table].filter(Boolean).length || 1;
    const share = (bottom - y) / parts;
    if (s.text) {
      slide.addText(textRuns(s.text, { color: colors.text }), {
        x: margin, y, w: W - 2 * margin, h: share,
        fontFace: font, fontSize: 18, valign: 'top', fit: 'shrink',
      });
      y += share;
    }
    if (s.bullets?.length) {
      slide.addText(
        s.bullets.flatMap((b) => {
          // o marcador e o espaçamento ficam no primeiro trecho; a quebra, no último
          const runs = textRuns(b, { color: colors.text });
          runs[0].options = { ...runs[0].options, bullet: { code: '25CF' }, paraSpaceAfter: 8 };
          runs[runs.length - 1].options = { ...runs[runs.length - 1].options, breakLine: true };
          return runs;
        }),
        { x: margin, y, w: W - 2 * margin, h: share, fontFace: font, fontSize: 20, valign: 'top', fit: 'shrink' },
      );
      y += share;
    }
    if (s.table) {
      const headers = s.table.headers ?? [];
      const width = Math.max(headers.length, ...s.table.rows.map((r) => r.length));
      const fill = (r: string[]) => Array.from({ length: width }, (_, c) => r[c] ?? '');
      const rows: TableRow[] = [
        ...(headers.length
          ? [fill(headers).map((h) => ({
              text: plain(h),
              options: { bold: true, color: 'FFFFFF', fill: { color: colors.primary } },
            }))]
          : []),
        ...s.table.rows.map((r) => fill(r).map((c) => ({ text: plain(c) }))),
      ];
      if (width)
        slide.addTable(rows, {
          x: margin, y, w: W - 2 * margin,
          fontFace: font, fontSize: 14, color: colors.text,
          border: { type: 'solid', pt: 0.75, color: colors.line },
          autoPage: true, autoPageRepeatHeader: true,
        });
    }
    if (s.notes) slide.addNotes(s.notes);
  });
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}

export const powerPointTool: Tool<PresentationInput> = {
  name: 'criar_powerpoint',
  title: 'Criar apresentação PowerPoint',
  label: 'Criando a apresentação PowerPoint',
  description:
    'Cria uma apresentação PowerPoint (.pptx) para o usuário baixar. Use quando ele pedir slides ou uma apresentação. ' +
    'Cada slide tem um título e, opcionalmente, um texto curto, tópicos (até 6 é o ideal), uma tabela e anotações do apresentador. ' +
    'Com "title" é criada uma capa.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Nome do arquivo, sem extensão.' },
      title: { type: 'string', description: 'Título da capa.' },
      subtitle: { type: 'string', description: 'Subtítulo da capa.' },
      slides: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Título do slide.' },
            text: { type: 'string', description: 'Texto curto. Aceita **negrito** e *itálico*.' },
            bullets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tópicos. Aceitam **negrito** e *itálico*.',
            },
            table: {
              type: 'object',
              properties: {
                headers: { type: 'array', items: { type: 'string' } },
                rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
              },
              required: ['rows'],
            },
            notes: { type: 'string', description: 'Anotações do apresentador.' },
          },
          required: ['title'],
        },
      },
    },
    required: ['filename', 'slides'],
  },
  schema: presentationSchema,
  async execute(input, ctx) {
    const data = await buildPowerPoint(input);
    return deliver(
      ctx,
      'pptx',
      input.filename,
      data,
      `${input.slides.length + (input.title ? 1 : 0)} slides`,
    );
  },
};
