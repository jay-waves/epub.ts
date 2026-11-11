// Ad hoc local integration checks. Never run in release CI/CD or the default test loop.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const suites = {
  smoke: ['navigation'],
  reading: ['navigation', 'search'],
  ui: ['popovers'],
};
const requested = process.argv.slice(2);
if (requested.includes('--list')) {
  for (const [suite, checks] of Object.entries(suites)) console.log(`${suite}: ${checks.join(', ')}`);
  process.exit(0);
}
const checks = new Set();
for (const name of requested.length ? requested : ['smoke']) {
  const selected = suites[name] ?? (Object.values(suites).flat().includes(name) ? [name] : null);
  if (!selected) { console.error(`Unknown suite/check: ${name}. Use --list.`); process.exit(2); }
  selected.forEach(check => checks.add(check));
}
const base = process.env.EPUB_TEST_URL ?? 'http://127.0.0.1:5173';
try {
  const response = await fetch(new URL('/@vite/client', base), { signal: AbortSignal.timeout(5000) });
  if (!response.ok || !(await response.text()).includes('WebSocket')) throw Error('Not a Vite dev server');
} catch (error) {
  console.error(`Start pnpm dev first, or set EPUB_TEST_URL to the Vite dev server: ${error.message}`);
  process.exit(1);
}
for (const check of checks) {
  console.log(`Running ${check}`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`check-${check}.mjs`, import.meta.url))], {
    stdio: 'inherit', env: { ...process.env, EPUB_TEST_URL: base }, timeout: 180_000,
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
