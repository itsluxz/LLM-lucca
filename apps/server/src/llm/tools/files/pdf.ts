import PDFDocument from 'pdfkit';
import type { Tool } from '../types.js';
import {
  colors,
  deliver,
  documentParameters,
  documentSchema,
  parseInline,
  plain,
  type Block,
  type DocumentInput,
} from './content.js';

const fonts = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  boldItalic: 'Helvetica-BoldOblique',
};
const hex = (c: string) => `#${c}`;

/**
 * As fontes padrão do PDF só têm o alfabeto latino (acentos inclusos).
 * Emojis e outros símbolos sairiam como lixo, então são removidos.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u25cf]/g, '-')
    .replace(/\t/g, '    ')
    .replace(/[^\n\x20-\x7e\u00a0-\u00ff\u20ac]/gu, '');
}

const fontFor = (bold?: boolean, italic?: boolean) =>
  bold && italic ? fonts.boldItalic : bold ? fonts.bold : italic ? fonts.italic : fonts.regular;

export async function buildPdf(input: DocumentInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 56,
    bufferPages: true,
    info: { Title: pdfSafe(input.title ?? input.filename), Creator: 'LLM — Lucca Language Model' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  /** Texto com **negrito** e *itálico*, quebrando linha automaticamente. */
  const rich = (text: string, size: number, opts: { color?: string; indent?: number; bold?: boolean } = {}) => {
    const runs = parseInline(pdfSafe(text));
    doc.fontSize(size).fillColor(hex(opts.color ?? colors.text));
    runs.forEach((r, i) => {
      doc.font(fontFor(r.bold || opts.bold, r.italic)).text(r.text, {
        continued: i < runs.length - 1,
        indent: i === 0 ? opts.indent : undefined,
        width: width - (opts.indent ?? 0),
        lineGap: 2,
      });
    });
  };

  const drawTable = (block: Block) => {
    const header = block.headers ?? [];
    const body = block.rows ?? [];
    const cols = Math.max(header.length, ...body.map((r) => r.length));
    if (!cols) return;
    const colWidth = width / cols;
    const pad = 5;
    const size = cols > 6 ? 8 : 10;
    const rowHeight = (cells: string[], bold: boolean) =>
      Math.max(
        ...Array.from({ length: cols }, (_, c) =>
          doc
            .font(bold ? fonts.bold : fonts.regular)
            .fontSize(size)
            .heightOfString(pdfSafe(plain(cells[c] ?? '')) || ' ', { width: colWidth - 2 * pad }),
        ),
      ) + 2 * pad;
    const drawRow = (cells: string[], isHeader: boolean) => {
      const h = rowHeight(cells, isHeader);
      if (doc.y + h > bottom()) {
        doc.addPage();
        if (!isHeader && header.length) drawRow(header, true);
      }
      const y = doc.y;
      if (isHeader) doc.rect(left, y, width, h).fill(hex(colors.headerFill));
      for (let c = 0; c < cols; c++) {
        doc.rect(left + c * colWidth, y, colWidth, h).lineWidth(0.5).stroke(hex(colors.line));
        doc
          .font(isHeader ? fonts.bold : fonts.regular)
          .fontSize(size)
          .fillColor(hex(colors.text))
          .text(pdfSafe(plain(cells[c] ?? '')), left + c * colWidth + pad, y + pad, {
            width: colWidth - 2 * pad,
          });
      }
      doc.x = left;
      doc.y = y + h;
    };
    if (header.length) drawRow(header, true);
    for (const r of body) drawRow(r, false);
    doc.moveDown(0.8);
  };

  if (input.title) {
    rich(input.title, 24, { color: colors.primary, bold: true });
    doc
      .moveTo(left, doc.y + 4)
      .lineTo(left + width, doc.y + 4)
      .lineWidth(2)
      .stroke(hex(colors.accent));
    doc.moveDown(1.2);
  }
  for (const block of input.blocks) {
    doc.x = left;
    switch (block.type) {
      case 'heading': {
        const level = block.level ?? 1;
        if (doc.y > bottom() - 60) doc.addPage();
        doc.moveDown(level === 1 ? 0.6 : 0.4);
        rich(block.text ?? '', [18, 14, 12][level - 1], {
          color: level === 1 ? colors.primary : level === 2 ? colors.text : colors.muted,
          bold: true,
        });
        doc.moveDown(0.3);
        break;
      }
      case 'paragraph':
        rich(block.text ?? '', 11);
        doc.moveDown(0.6);
        break;
      case 'quote': {
        const y = doc.y;
        rich(block.text ?? '', 11, { color: colors.muted, indent: 14 });
        doc.moveTo(left + 3, y).lineTo(left + 3, doc.y).lineWidth(3).stroke(hex(colors.primary));
        doc.moveDown(0.6);
        break;
      }
      case 'bullets':
      case 'numbered': {
        let n = 0;
        for (const item of block.items ?? []) {
          const marker = block.type === 'bullets' ? '-' : `${++n}.`;
          rich(`${marker} ${item}`, 11, { indent: 12 });
          doc.moveDown(0.2);
        }
        doc.moveDown(0.4);
        break;
      }
      case 'table':
        drawTable(block);
        break;
      case 'page_break':
        doc.addPage();
        break;
    }
  }
  // numeração das páginas no rodapé
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // o rodapé fica abaixo da margem; sem zerar, o pdfkit abriria outra página
    doc.page.margins.bottom = 0;
    doc
      .font(fonts.regular)
      .fontSize(9)
      .fillColor(hex(colors.muted))
      .text(`${i + 1} / ${range.count}`, left, doc.page.height - 40, {
        width,
        align: 'right',
        lineBreak: false,
      });
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

export const pdfTool: Tool<DocumentInput> = {
  name: 'criar_pdf',
  title: 'Criar PDF',
  label: 'Criando o PDF',
  description:
    'Cria um documento PDF para o usuário baixar. Use quando ele pedir um PDF (relatório, resumo, currículo, lista, contrato). ' +
    'Monte o conteúdo completo em blocos (títulos, parágrafos, listas, tabelas). Não use emojis: o PDF não os exibe.',
  parameters: documentParameters,
  schema: documentSchema,
  async execute(input, ctx) {
    const data = await buildPdf(input);
    return deliver(ctx, 'pdf', input.filename, data, `${input.blocks.length} blocos`);
  },
};
