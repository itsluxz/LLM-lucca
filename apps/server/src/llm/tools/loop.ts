import type { StreamParams, TokenUsage, ToolSpec } from '../types.js';

/**
 * Máximo de idas e voltas modelo → ferramenta → modelo numa resposta.
 * Na última volta as ferramentas ficam bloqueadas e o modelo precisa responder.
 */
export const maxToolRounds = 5;

const sum = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : a + b;

/** Soma o uso de várias chamadas ao provedor (cada volta é cobrada). */
export function addUsage(
  a: TokenUsage | null,
  b: TokenUsage | null,
): TokenUsage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: sum(a.inputTokens, b.inputTokens),
    cachedTokens: sum(a.cachedTokens, b.cachedTokens),
    reasoningTokens: sum(a.reasoningTokens, b.reasoningTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
  };
}

/** Ferramentas ativas nesta geração (precisa das specs e de quem as execute). */
export function activeTools(p: StreamParams): ToolSpec[] {
  return p.runTool && p.tools?.length ? p.tools : [];
}

export const toolLabel = (tools: ToolSpec[], name: string) =>
  `${tools.find((t) => t.name === name)?.label ?? `Usando ${name}`}…`;

/**
 * Separa com uma linha em branco o texto de voltas diferentes
 * ("Vou calcular." + resultado), sem duplicar quebras.
 */
export class RoundText {
  private last = '';
  private pending = false;
  /** Chame ao iniciar uma nova volta. */
  nextRound() {
    this.pending = this.last.length > 0;
  }
  /** Texto a emitir para este delta, já com o separador se for o primeiro da volta. */
  push(text: string): string {
    let out = text;
    if (this.pending && text) {
      out = (this.last.endsWith('\n\n') ? '' : this.last.endsWith('\n') ? '\n' : '\n\n') + text;
      this.pending = false;
    }
    this.last = (this.last + out).slice(-2);
    return out;
  }
}
