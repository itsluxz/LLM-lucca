import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, '.env');
let contents;
try {
  contents = await readFile(file, 'utf8');
} catch {
  contents = await readFile(path.join(root, '.env.example'), 'utf8');
}
for (const [key, length] of [
  ['JWT_ACCESS_SECRET', 48],
  ['JWT_REFRESH_SECRET', 48],
  ['ENCRYPTION_KEY', 32],
]) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (!new RegExp(`^${key}=.+$`, 'm').test(contents))
    contents = contents.replace(
      pattern,
      `${key}=${randomBytes(length).toString('base64')}`,
    );
}
await writeFile(file, contents, { flag: 'w' });
await mkdir(path.join(root, 'storage', 'uploads'), { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...dotenv.parse(contents) },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Falha em ${command} ${args.join(' ')}. Verifique se Docker Desktop está instalado e em execução.`,
    );
}
run('docker', ['compose', 'up', '-d', 'db']);
for (let attempt = 0; attempt < 30; attempt++) {
  const ready = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'db',
      'pg_isready',
      '-U',
      'lucca',
      '-d',
      'llm_lucca',
    ],
    { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  if (ready.status === 0) break;
  if (attempt === 29)
    throw new Error('PostgreSQL não ficou pronto em 30 segundos');
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
run('npm', ['-w', 'apps/server', 'exec', 'prisma', 'generate']);
run('npm', ['-w', 'apps/server', 'run', 'db:migrate', '--', '--name', 'init']);
run('npm', ['-w', 'apps/server', 'run', 'db:seed']);
console.log('Pronto! Execute npm run dev e abra http://localhost:5173');
