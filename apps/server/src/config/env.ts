import dotenv from 'dotenv';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
dotenv.config({
  path: path.resolve(process.cwd(), existsSync('.env') ? '.env' : '../../.env'),
});
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    AUTH_MODE: z.enum(['local', 'multi']).default('local'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(3000),
    SERVE_WEB: bool.default(false),
    CLIENT_URL: z.url(),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    ENCRYPTION_KEY: z.string().refine((v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'Deve conter 32 bytes em base64'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./storage/uploads'),
    CACHE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
    STREAM_REGISTRY_DRIVER: z.enum(['memory', 'redis']).default('memory'),
    REDIS_URL: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    ALLOW_REGISTER: bool.default(true),
    // nº de proxies à frente do app (Render = 1); 0 = acesso direto
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    COOKIE_SECURE: bool.default(false),
    COOKIE_SAMESITE: z.enum(['lax', 'none', 'strict']).default('lax'),
    MODEL_MAX_AGE_MONTHS: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.coerce.number().int().min(0).default(12),
    ),
    BASE_SYSTEM_PROMPT: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z
        .string()
        .default(
          'Você é {persona}, a assistente do LLM — Lucca Language Model. Quando perguntarem seu nome, diga que é {persona}. Responda com clareza e honestidade.',
        ),
    ),
  })
  .superRefine((v, ctx) => {
    if (
      v.STORAGE_DRIVER === 's3' &&
      (!v.S3_BUCKET ||
        !v.S3_REGION ||
        !v.S3_ACCESS_KEY_ID ||
        !v.S3_SECRET_ACCESS_KEY)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'S3 exige bucket, região e credenciais',
      });
    if (
      (v.CACHE_DRIVER === 'redis' || v.STREAM_REGISTRY_DRIVER === 'redis') &&
      !v.REDIS_URL
    )
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'Redis exige REDIS_URL',
      });
    if (v.COOKIE_SAMESITE === 'none' && !v.COOKIE_SECURE)
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'Cookies SameSite=none exigem Secure=true',
      });
  });
const parsed = schema.safeParse(process.env);
if (!parsed.success)
  throw new Error('Configuração inválida: ' + z.prettifyError(parsed.error));
export const env = parsed.data;
