import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
await prisma.$connect();
app.listen(env.PORT, env.HOST, () =>
  logger.info(`API em http://${env.HOST}:${env.PORT}`),
);
