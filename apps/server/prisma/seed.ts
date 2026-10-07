import dotenv from 'dotenv';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
dotenv.config({
  path: path.resolve(process.cwd(), existsSync('.env') ? '.env' : '../../.env'),
});
const db = new PrismaClient();
await db.user.upsert({
  where: { email: 'local@llm.lucca' },
  update: {},
  create: { email: 'local@llm.lucca', name: 'Lucca' },
});
await db.$disconnect();
