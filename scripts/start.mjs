import { spawn } from 'node:child_process';
const child = spawn(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['-w', 'apps/server', 'run', 'start'],
  {
    stdio: 'inherit',
    env: { ...process.env, SERVE_WEB: 'true' },
    shell: process.platform === 'win32',
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
