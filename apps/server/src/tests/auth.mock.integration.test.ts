import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
type FakeUser = {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  defaultModel: string | null;
  systemPrompt: string | null;
};
type FakeToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};
const state = vi.hoisted(() => ({
  user: null as FakeUser | null,
  tokens: new Map<string, FakeToken>(),
  count: 0,
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      create: async ({
        data,
      }: {
        data: Omit<FakeUser, 'id' | 'defaultModel' | 'systemPrompt'>;
      }) => {
        state.user = {
          ...data,
          id: 'u1',
          defaultModel: null,
          systemPrompt: null,
        };
        return state.user;
      },
      findUnique: async () => state.user,
      findUniqueOrThrow: async () => state.user,
    },
    refreshToken: {
      create: async ({
        data,
      }: {
        data: Omit<FakeToken, 'id' | 'revokedAt'>;
      }) => {
        const row = { ...data, id: `t${++state.count}`, revokedAt: null };
        state.tokens.set(row.tokenHash, row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        state.tokens.get(where.tokenHash) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { revokedAt: Date };
      }) => {
        const row = [...state.tokens.values()].find((t) => t.id === where.id);
        if (row) row.revokedAt = data.revokedAt;
        return row;
      },
      updateMany: async () => ({ count: 1 }),
    },
    $queryRaw: async () => [1],
  },
}));
describe('multi-user HTTP auth', () => {
  let app: Express;
  beforeAll(async () => {
    process.env.AUTH_MODE = 'multi';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.CLIENT_URL = 'http://localhost:5173';
    ({ app } = await import('../app.js'));
    const { logger } = await import('../lib/logger.js');
    logger.level = 'silent';
  });
  it('registers, logs in and rotates the refresh cookie', async () => {
    const registered = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'secure-password',
        name: 'Lucca',
      })
      .expect(201);
    expect(registered.body.accessToken).toBeTruthy();
    expect(registered.body.user.passwordHash).toBeUndefined();
    const oldCookie = registered.headers['set-cookie'][0].split(';')[0];
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .expect(200);
    expect(me.body.user.email).toBe('test@example.com');
    const logged = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'secure-password' })
      .expect(200);
    expect(logged.body.accessToken).toBeTruthy();
    const renewed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', oldCookie)
      .expect(200);
    expect(renewed.body.accessToken).toBeTruthy();
    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', oldCookie)
      .expect(401);
  });
  it('rejects missing bearer tokens', async () => {
    await request(app).get('/api/conversations').expect(401);
  });
});
