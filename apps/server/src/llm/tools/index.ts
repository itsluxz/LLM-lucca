import type { ToolSpec } from '../types.js';
import { calculator } from './calculator.js';
import { datetime } from './datetime.js';
import { fetchUrl } from './fetchUrl.js';
import { excelTool } from './files/excel.js';
import { pdfTool } from './files/pdf.js';
import { powerPointTool } from './files/powerpoint.js';
import { wordTool } from './files/word.js';
import { ToolError, type Tool, type ToolContext } from './types.js';

/** Extensões disponíveis. Para criar uma nova, implemente `Tool` e adicione aqui. */
export const tools: Tool[] = [
  calculator,
  fetchUrl,
  datetime,
  wordTool,
  excelTool,
  powerPointTool,
  pdfTool,
] as Tool[];

const maxResultChars = 20000;

/** Specs das extensões pedidas (ids desconhecidos são ignorados). */
export function toolSpecs(names: string[] = []): ToolSpec[] {
  return tools
    .filter((t) => names.includes(t.name))
    .map(({ name, label, description, parameters }) => ({
      name,
      label,
      description,
      parameters,
    }));
}

/**
 * Executa a ferramenta pedida pelo modelo. Erros viram texto para o próprio
 * modelo ler e se corrigir, em vez de derrubar a resposta.
 */
export async function runTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `Erro: a ferramenta "${name}" não existe.`;
  let args: unknown;
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return 'Erro: os argumentos não são um JSON válido.';
  }
  const parsed = tool.schema.safeParse(args);
  if (!parsed.success)
    return `Erro: argumentos inválidos (${parsed.error.issues
      .map((i) => `${i.path.join('.') || 'raiz'}: ${i.message}`)
      .join('; ')}).`;
  try {
    const result = await tool.execute(parsed.data, ctx);
    return result.length > maxResultChars
      ? `${result.slice(0, maxResultChars)}\n[resultado cortado]`
      : result;
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    return `Erro: ${e instanceof ToolError ? e.message : 'falha ao executar a ferramenta'}.`;
  }
}
