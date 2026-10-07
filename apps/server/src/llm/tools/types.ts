import type { z } from 'zod';
import type { ToolSpec } from '../types.js';

export interface ToolContext {
  signal: AbortSignal;
  /** Dono dos arquivos gerados. */
  userId: string;
  /** Registra um arquivo gerado; o link é anexado ao fim da resposta. */
  onFile?: (file: GeneratedFile) => void;
}

export interface GeneratedFile {
  name: string;
  url: string;
  sizeBytes: number;
}

/** Uma extensão: o que o modelo vê (spec) e o que o servidor executa. */
export interface Tool<T = unknown> extends ToolSpec {
  /** Nome mostrado nas Configurações. */
  title: string;
  /** Valida os argumentos enviados pelo modelo. */
  schema: z.ZodType<T>;
  execute(args: T, ctx: ToolContext): Promise<string>;
}

/** Erro com mensagem que pode ser devolvida ao modelo. */
export class ToolError extends Error {}
