import { spawn, spawnSync } from 'node:child_process';
const shell = process.platform === 'win32';
// no Render (RENDER=true) o banco é gerenciado; localmente sobe o Postgres do Docker
if (!process.env.RENDER) {
  const db = spawnSync('docker', ['compose', 'up', '-d', 'db'], {
    stdio: 'inherit',
    shell,
  });
  if (db.status !== 0) process.exit(db.status ?? 1);
}
const child = spawn(
  shell ? 'npm.cmd' : 'npm',
  ['-w', 'apps/server', 'run', 'start'],
  {
    stdio: 'inherit',
    env: { ...process.env, SERVE_WEB: 'true' },
    shell,
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
