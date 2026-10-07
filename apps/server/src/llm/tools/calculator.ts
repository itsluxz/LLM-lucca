import { z } from 'zod';
import { ToolError, type Tool } from './types.js';

const functions: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
};
const constants: Record<string, number> = { pi: Math.PI, e: Math.E };

/**
 * Avalia uma expressão aritmética sem eval: + - * / % ^, parênteses,
 * funções de um argumento (sqrt, ln, sin…) e as constantes pi e e.
 * Gramática: expr = termo (('+'|'-') termo)*; termo = unário (('*'|'/'|'%') unário)*;
 * unário = ('-'|'+') unário | potência; potência = átomo ('^' unário)?.
 */
export function evaluate(expression: string): number {
  const src = expression.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  if (!src) throw new ToolError('Expressão vazia');
  if (src.length > 500) throw new ToolError('Expressão longa demais');
  let i = 0;
  const peek = () => src[i];
  const expect = (c: string) => {
    if (src[i] !== c) throw new ToolError(`Esperado "${c}" na posição ${i + 1}`);
    i++;
  };
  const atom = (): number => {
    if (peek() === '(') {
      i++;
      const v = expr();
      expect(')');
      return v;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const name = /^[a-z][a-z0-9]*/i.exec(src.slice(i))?.[0];
    if (name) {
      i += name.length;
      const lower = name.toLowerCase();
      if (lower in constants) return constants[lower];
      const fn = functions[lower];
      if (!fn) throw new ToolError(`Função desconhecida: ${name}`);
      expect('(');
      const v = fn(expr());
      expect(')');
      return v;
    }
    throw new ToolError(
      i < src.length ? `Caractere inesperado "${src[i]}"` : 'Expressão incompleta',
    );
  };
  // o expoente liga mais forte que o sinal: -2^2 = -(2^2) = -4, e 2^-1 = 0.5
  const power = (): number => {
    const base = atom();
    if (peek() === '^') {
      i++;
      return base ** unary();
    }
    return base;
  };
  const unary = (): number => {
    if (peek() === '-') {
      i++;
      return -unary();
    }
    if (peek() === '+') {
      i++;
      return unary();
    }
    return power();
  };
  const term = (): number => {
    let v = unary();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = src[i++];
      const r = unary();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const result = expr();
  if (i < src.length) throw new ToolError(`Caractere inesperado "${src[i]}"`);
  if (!Number.isFinite(result))
    throw new ToolError('O resultado não é um número finito (divisão por zero?)');
  return result;
}

export const calculator: Tool<{ expression: string }> = {
  name: 'calculadora',
  title: 'Calculadora',
  label: 'Calculando',
  description:
    'Calcula expressões matemáticas com precisão. Use sempre que precisar de uma conta exata. ' +
    'Suporta + - * / % ^, parênteses, sqrt, abs, round, floor, ceil, sin, cos, tan, asin, acos, atan, exp, ln, log (base 10), log2 e as constantes pi e e. Use ponto como separador decimal.',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Expressão a calcular, ex.: (1250 * 0.15) + sqrt(144)',
      },
    },
    required: ['expression'],
  },
  schema: z.object({ expression: z.string().min(1).max(500) }),
  async execute({ expression }) {
    const result = evaluate(expression);
    // evita ruído de ponto flutuante (0.1 + 0.2 = 0.30000000000000004)
    return `${expression} = ${Number(result.toPrecision(15))}`;
  },
};
