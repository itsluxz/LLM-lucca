import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
describe.runIf(!!process.env.TEST_DATABASE_URL)(
  'HTTP routes with PostgreSQL',
  () => {
    let app: Express;
    let prisma: PrismaClient;
    let conversationId = '';
    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      process.env.AUTH_MODE = 'local';
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
      process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
      process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
      process.env.CLIENT_URL = 'http://localhost:5173';
      process.env.SERVE_WEB = 'false';
      ({ app } = await import('../app.js'));
      ({ prisma } = await import('../lib/prisma.js'));
    });
    afterAll(async () => {
      if (conversationId)
        await prisma.conversation.deleteMany({ where: { id: conversationId } });
      await prisma?.$disconnect();
    });
    it('returns the local user without login', async () => {
      const res = await request(app).get('/api/auth/me').expect(200);
      expect(res.body.authMode).toBe('local');
      expect(res.body.user.email).toBe('local@llm.lucca');
    });
    it('creates, lists, edits and deletes only owned conversations', async () => {
      const created = await request(app)
        .post('/api/conversations')
        .send({ model: 'openai:example' })
        .expect(201);
      conversationId = created.body.id;
      const list = await request(app).get('/api/conversations').expect(200);
      expect(
        list.body.items.some((c: { id: string }) => c.id === conversationId),
      ).toBe(true);
      await request(app)
        .patch(`/api/conversations/${conversationId}`)
        .send({ title: 'Título editado', pinned: true })
        .expect(200);
      const detail = await request(app)
        .get(`/api/conversations/${conversationId}`)
        .expect(200);
      expect(detail.body.title).toBe('Título editado');
      expect(detail.body.usageTotals.responses).toBe(0);
      await request(app)
        .delete(`/api/conversations/${conversationId}`)
        .expect(204);
      conversationId = '';
      await request(app)
        .get(`/api/conversations/${created.body.id}`)
        .expect(404);
    });
  },
);
