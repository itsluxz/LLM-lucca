import ExcelJS from 'exceljs';
import { z } from 'zod';
import { ToolError, type Tool } from '../types.js';
import { colors, deliver } from './content.js';

const cell = z.string().max(5000);
const sheetSchema = z.object({
  name: z.string().max(100).optional(),
  headers: z.array(cell).max(100).optional(),
  rows: z.array(z.array(cell).max(100)).max(10000),
});
const spreadsheetSchema = z.object({
  filename: z.string().max(120),
  sheets: z.array(sheetSchema).min(1).max(20),
});
type SpreadsheetInput = z.infer<typeof spreadsheetSchema>;

/**
 * As células chegam como texto (o subconjunto de JSON Schema comum aos
 * provedores não tem "número ou texto"): "=SOMA(A1:A3)" vira fórmula,
 * "1234.5" vira número e o resto continua texto.
 */
export function cellValue(raw: string): ExcelJS.CellValue {
  const value = raw.trim();
  if (value.startsWith('=') && value.length > 1) return { formula: value.slice(1) };
  if (/^-?\d+(\.\d+)?$/.test(value) && !/^-?0\d/.test(value)) return Number(value);
  return raw;
}

/** Nome de aba válido no Excel: até 31 caracteres, sem []:*?/\ e sem repetir. */
function sheetName(name: string | undefined, index: number, used: Set<string>): string {
  const base =
    (name ?? '')
      .replace(/[[\]:*?/\\]/g, ' ')
      .replace(/^'+|'+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31) ||
    `Planilha${index + 1}`;
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n++)
    out = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  used.add(out.toLowerCase());
  return out;
}

export async function buildExcel(input: SpreadsheetInput): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = 'LLM — Lucca Language Model';
  const used = new Set<string>();
  input.sheets.forEach((sheet, index) => {
    const ws = book.addWorksheet(sheetName(sheet.name, index, used));
    const headers = sheet.headers ?? [];
    if (headers.length) {
      const row = ws.addRow(headers);
      row.font = { bold: true, color: { argb: `FF${colors.text}` } };
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${colors.headerFill}` } };
        c.border = { bottom: { style: 'thin', color: { argb: `FF${colors.primary}` } } };
      });
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    }
    for (const r of sheet.rows) ws.addRow(r.map(cellValue));
    const width = Math.max(headers.length, ...sheet.rows.map((r) => r.length), 0);
    if (headers.length && sheet.rows.length)
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    // largura de cada coluna pelo maior conteúdo (fórmulas contam pouco)
    for (let i = 0; i < width; i++) {
      const longest = Math.max(
        headers[i]?.length ?? 0,
        ...sheet.rows.map((r) => (r[i]?.startsWith('=') ? 10 : (r[i]?.length ?? 0))),
      );
      ws.getColumn(i + 1).width = Math.min(60, Math.max(8, longest + 2));
    }
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}

export const excelTool: Tool<SpreadsheetInput> = {
  name: 'criar_excel',
  title: 'Criar planilha Excel',
  label: 'Criando a planilha Excel',
  description:
    'Cria uma planilha Excel (.xlsx) para o usuário baixar. Use para tabelas, orçamentos, listas e dados. ' +
    'Todas as células são texto: números com ponto decimal e sem separador de milhar (ex.: 1234.5) viram números, ' +
    'e textos que começam com = viram fórmulas do Excel em inglês (ex.: =SUM(B2:B10)). Pode ter várias abas.',
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'Nome do arquivo, sem extensão. Ex.: Orçamento outubro',
      },
      sheets: {
        type: 'array',
        description: 'Abas da planilha.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nome da aba (até 31 caracteres).' },
            headers: {
              type: 'array',
              items: { type: 'string' },
              description: 'Cabeçalho (primeira linha, em negrito e com filtro).',
            },
            rows: {
              type: 'array',
              description: 'Linhas de dados; cada linha é uma lista de células.',
              items: { type: 'array', items: { type: 'string' } },
            },
          },
          required: ['rows'],
        },
      },
    },
    required: ['filename', 'sheets'],
  },
  schema: spreadsheetSchema,
  async execute(input, ctx) {
    const total = input.sheets.reduce((n, s) => n + s.rows.length, 0);
    if (total > 20000) throw new ToolError('Linhas demais (limite de 20.000 no total)');
    const data = await buildExcel(input);
    return deliver(
      ctx,
      'xlsx',
      input.filename,
      data,
      `${input.sheets.length} aba(s), ${total} linha(s) de dados`,
    );
  },
};
