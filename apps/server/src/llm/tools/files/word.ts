import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { Tool } from '../types.js';
import {
  colors,
  deliver,
  documentParameters,
  documentSchema,
  parseInline,
  type Block,
  type DocumentInput,
} from './content.js';

const runs = (text: string, extra: { bold?: boolean; color?: string } = {}) =>
  parseInline(text).map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: r.bold || extra.bold,
        italics: r.italic,
        color: extra.color,
      }),
  );

const headingLevels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
const border = { style: BorderStyle.SINGLE, size: 4, color: colors.line };

function table(block: Block): Table | null {
  const header = block.headers ?? [];
  const body = block.rows ?? [];
  const width = Math.max(header.length, ...body.map((r) => r.length));
  if (!width) return null;
  const row = (cells: string[], isHeader: boolean) =>
    new TableRow({
      tableHeader: isHeader,
      children: Array.from({ length: width }, (_, i) =>
        new TableCell({
          children: [new Paragraph({ children: runs(cells[i] ?? '', { bold: isHeader }) })],
          shading: isHeader
            ? { type: ShadingType.CLEAR, color: 'auto', fill: colors.headerFill }
            : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
        }),
      ),
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: [...(header.length ? [row(header, true)] : []), ...body.map((r) => row(r, false))],
  });
}

export async function buildWord(input: DocumentInput): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];
  if (input.title)
    children.push(
      new Paragraph({ heading: HeadingLevel.TITLE, children: runs(input.title) }),
    );
  let numberedLists = 0;
  for (const block of input.blocks) {
    switch (block.type) {
      case 'heading':
        children.push(
          new Paragraph({
            heading: headingLevels[(block.level ?? 1) - 1],
            children: runs(block.text ?? ''),
          }),
        );
        break;
      case 'paragraph':
        children.push(new Paragraph({ children: runs(block.text ?? ''), spacing: { after: 120 } }));
        break;
      case 'quote':
        children.push(
          new Paragraph({
            children: runs(block.text ?? '', { color: colors.muted }),
            indent: { left: 480 },
            spacing: { before: 120, after: 160 },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: colors.primary, space: 12 } },
          }),
        );
        break;
      case 'bullets':
      case 'numbered': {
        // cada lista numerada recomeça do 1; o último item dá espaço ao bloco seguinte
        const instance = block.type === 'numbered' ? ++numberedLists : 0;
        const items = block.items ?? [];
        items.forEach((item, i) =>
          children.push(
            new Paragraph({
              children: runs(item),
              spacing: { after: i === items.length - 1 ? 160 : 40 },
              ...(block.type === 'bullets'
                ? { bullet: { level: 0 } }
                : { numbering: { reference: 'numeros', level: 0, instance } }),
            }),
          ),
        );
        break;
      }
      case 'table': {
        const t = table(block);
        if (t) children.push(t, new Paragraph({}));
        break;
      }
      case 'page_break':
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
    }
  }
  const doc = new Document({
    creator: 'LLM — Lucca Language Model',
    title: input.title ?? input.filename,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22, color: colors.text } } },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          run: { size: 44, bold: true, color: colors.primary },
          paragraph: { spacing: { after: 240 } },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          run: { size: 32, bold: true, color: colors.primary },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          run: { size: 26, bold: true, color: colors.text },
          paragraph: { spacing: { before: 200, after: 100 } },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          run: { size: 23, bold: true, color: colors.muted },
          paragraph: { spacing: { before: 160, after: 80 } },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'numeros',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

export const wordTool: Tool<DocumentInput> = {
  name: 'criar_word',
  title: 'Criar documento Word',
  label: 'Criando o documento Word',
  description:
    'Cria um documento Word (.docx) para o usuário baixar. Use quando ele pedir um documento, relatório, contrato, carta ou texto em Word. ' +
    'Monte o conteúdo completo em blocos (títulos, parágrafos, listas, tabelas).',
  parameters: documentParameters,
  schema: documentSchema,
  async execute(input, ctx) {
    const data = await buildWord(input);
    return deliver(ctx, 'docx', input.filename, data, `${input.blocks.length} blocos`);
  },
};
