import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));

try {
  requireFromApi.resolve('prisma/package.json');
} catch {
  console.warn('Prisma CLI is not installed; skipping client generation.');
  process.exit(0);
}

const result = spawnSync('npm', ['run', 'db:generate'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
