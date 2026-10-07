import pino from 'pino';
export const logger = pino({
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    '*.apiKey',
    '*.encryptedKey',
    '*.password',
  ],
});
