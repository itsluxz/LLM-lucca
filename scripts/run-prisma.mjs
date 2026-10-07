import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
const env = { ...process.env, ...dotenv.parse(readFileSync('.env')) };
const result = spawnSync('npm', ['-w', 'apps/server', 'run', 'db:migrate'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});
process.exit(result.status ?? 1);
