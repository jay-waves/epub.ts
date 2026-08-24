import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const binary = resolve(root, 'release', 'epub.ts.exe');
if (!existsSync(binary)) throw new Error('Run pnpm package:windows:binary first.');

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const compiler = process.env.EPUB_TS_ISCC ?? (process.platform === 'win32' ? 'ISCC.exe' : 'iscc');
const script = resolve(root, 'packaging', 'windows', 'epub.ts.iss');
const result = spawnSync(compiler, [
  `/DMyAppVersion=${packageJson.version}`,
  '/Qp',
  script,
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`${compiler} exited with status ${result.status ?? 1}.`);
console.log(`Packaged ${resolve(root, 'release', `epub-ts-setup-v${packageJson.version}.exe`)}`);
