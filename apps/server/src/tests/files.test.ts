import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

const put = vi.fn(async () => undefined);
vi.mock('../lib/storage/index.js', () => ({
  storage: { put, get: vi.fn(), delete: vi.fn() },
}));

const { buildExcel, cellValue } = await import('../llm/tools/files/excel.js');
const { buildWord } = await import('../llm/tools/files/word.js');
const { buildPowerPoint } = await import('../llm/tools/files/powerpoint.js');
const { buildPdf, pdfSafe } = await import('../llm/tools/files/pdf.js');
const { parseInline } = await import('../llm/tools/files/content.js');
const { safeFilename } = await import('../modules/downloads/routes.js');
const { runTool } = await import('../llm/tools/index.js');

const isZip = (b: Buffer) => b.subarray(0, 2).toString('latin1') === 'PK';
const doc = {
  filename: 'Teste',
  title: 'Título com acentuação',
  blocks: [
    { type: 'heading' as const, text: 'Seção', level: 1 },
    { type: 'paragraph' as const, text: 'Texto **forte** e *leve* 🚀' },
    { type: 'bullets' as const, items: ['um', 'dois'] },
    { type: 'numbered' as const, items: ['a', 'b'] },
    { type: 'table' as const, headers: ['A', 'B'], rows: [['1', '2'], ['3']] },
    { type: 'quote' as const, text: 'citação' },
    { type: 'page_break' as const },
  ],
};

describe('arquivos', () => {
  it('formatação inline', () => {
    expect(parseInline('a **b** c *d*')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c ' },
      { text: 'd', italic: true },
    ]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4' }]);
  });
  it('nomes de arquivo seguros', () => {
    expect(safeFilename('../../etc/passwd', 'pdf')).toBe('.. .. etc passwd.pdf');
    expect(safeFilename('Relatório: "final"?.docx', 'docx')).toBe('Relatório final.docx');
    expect(safeFilename('', 'xlsx')).toBe('arquivo.xlsx');
    expect(safeFilename('a'.repeat(200), 'pptx')).toHaveLength(85);
  });
  it('células do Excel: fórmula, número e texto', () => {
    expect(cellValue('=SUM(A1:A2)')).toEqual({ formula: 'SUM(A1:A2)' });
    expect(cellValue('1234.5')).toBe(1234.5);
    expect(cellValue('-7')).toBe(-7);
    expect(cellValue('01310100')).toBe('01310100');
    expect(cellValue('1.234,56')).toBe('1.234,56');
    expect(cellValue('=')).toBe('=');
  });
  it('gera uma planilha que o Excel lê de volta', async () => {
    const data = await buildExcel({
      filename: 'x',
      sheets: [
        { name: 'Vendas: [Q1]', headers: ['Item', 'Valor'], rows: [['A', '10'], ['B', '=B2*2']] },
        { name: 'Vendas: [Q1]', rows: [['repetida']] },
      ],
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(data as unknown as ArrayBuffer);
    expect(book.worksheets.map((w) => w.name)).toEqual(['Vendas Q1', 'Vendas Q1 2']);
    const ws = book.worksheets[0];
    expect(ws.getCell('B2').value).toBe(10);
    expect(ws.getCell('B3').value).toMatchObject({ formula: 'B2*2' });
    expect(ws.getRow(1).font?.bold).toBe(true);
  });
  it('gera Word, PowerPoint e PDF válidos', async () => {
    expect(isZip(await buildWord(doc))).toBe(true);
    expect(
      isZip(
        await buildPowerPoint({
          filename: 'x',
          title: 'Capa',
          slides: [
            { title: 'Um', bullets: ['**a**', 'b'], notes: 'n' },
            { title: 'Dois', text: 't', table: { headers: ['h'], rows: [['1']] } },
          ],
        }),
      ),
    ).toBe(true);
    const pdf = await buildPdf(doc);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
  it('o PDF descarta o que a fonte padrão não desenha', () => {
    expect(pdfSafe('Ação “ok” — 🚀 fim…')).toBe('Ação "ok" -  fim...');
  });
  it('salva o arquivo do dono e entrega o link para a resposta', async () => {
    const onFile = vi.fn();
    const result = await runTool(
      'criar_excel',
      JSON.stringify({ filename: 'Orçamento/2026', sheets: [{ rows: [['1']] }] }),
      { signal: new AbortController().signal, userId: 'user1', onFile },
    );
    expect(result).toMatch(/^Arquivo "Orçamento 2026.xlsx" criado/);
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^dl_user1_[a-f0-9]{24}_xlsx$/),
      expect.any(Buffer),
    );
    expect(onFile).toHaveBeenCalledWith({
      name: 'Orçamento 2026.xlsx',
      url: expect.stringMatching(
        /^\/api\/downloads\/dl_user1_[a-f0-9]{24}_xlsx\/Or%C3%A7amento%202026\.xlsx$/,
      ),
      sizeBytes: expect.any(Number),
    });
  });
});
