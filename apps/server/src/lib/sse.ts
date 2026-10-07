import type { Response } from 'express';
export function openSse(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // proxies não seguram os deltas
  res.flushHeaders();
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  res.on('close', () => clearInterval(ping));
}
export function sendSse(res: Response, event: string, data: unknown) {
  if (!res.writableEnded)
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
