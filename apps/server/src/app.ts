import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { requireAuth } from './middlewares/auth.js';
import { asyncRoute, errorHandler } from './middlewares/error.js';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { providerRoutes } from './modules/providers/routes.js';
import { modelRoutes } from './modules/models/routes.js';
import { projectRoutes } from './modules/projects/routes.js';
import { conversationRoutes } from './modules/conversations/routes.js';
import { messageRoutes } from './modules/messages/routes.js';
import { chatRoutes } from './modules/chat/routes.js';
import { imageRoutes } from './modules/images/routes.js';
import { toolRoutes } from './modules/tools/routes.js';
import { downloadRoutes } from './modules/downloads/routes.js';
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(
  pinoHttp({
    logger,
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
const api = express.Router();
api.get(
  '/health',
  asyncRoute(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  }),
);
api.use('/auth', authRoutes);
api.use(requireAuth);
api.use('/users', userRoutes);
api.use('/providers', providerRoutes);
api.use('/models', modelRoutes);
api.use('/projects', projectRoutes);
api.use('/conversations', conversationRoutes);
api.use('/messages', messageRoutes);
api.use('/chat', chatRoutes);
api.use('/images', imageRoutes);
api.use('/tools', toolRoutes);
api.use('/downloads', downloadRoutes);
api.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
app.use('/api', api);
if (env.SERVE_WEB) {
  const web = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../web/dist',
  );
  app.use(express.static(web));
  app.get('*', (_req, res) => res.sendFile(path.join(web, 'index.html')));
}
app.use(errorHandler);
