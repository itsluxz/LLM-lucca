import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';
export const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (res.headersSent) {
    logger.error({ err }, 'Falha após início da resposta');
    if (!res.writableEnded) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ message: 'Erro interno do servidor' })}\n\n`,
      );
      res.end();
    }
    return;
  }
  if (err instanceof ZodError)
    return res
      .status(400)
      .json({ error: 'Dados inválidos', details: err.issues });
  const e = err as {
    code?: string;
    message?: string;
    status?: number;
    expose?: boolean;
  };
  if (e.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'Arquivo acima do limite de 10 MB' });
  if (e.code === 'P2025')
    return res.status(404).json({ error: 'Recurso não encontrado' });
  if (e.code === 'P2002')
    return res.status(409).json({ error: 'Registro já existe' });
  if (!e.status || e.status >= 500)
    logger.error({ err }, 'Falha na requisição');
  res.status(e.status ?? 500).json({
    error:
      e.expose || (e.status && e.status < 500)
        ? e.message
        : 'Erro interno do servidor',
  });
}
export function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}
