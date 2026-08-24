import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const binary = resolve(root, 'release', 'epub.ts.exe');
if (!existsSync(binary)) throw new Error('Run pnpm package:windows:binary first.');

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const compiler = process.env.EPUB_TS_MAKENSIS ?? 'makensis';
const script = resolve(root, 'packaging', 'windows', 'epub.ts.nsi');
const output = resolve(root, 'release', `epub-ts-setup-v${packageJson.version}.exe`);
const fedoraStubDirectory = '/usr/share/nsis/Stubs';
if (compiler === 'makensis'
  && existsSync(resolve(fedoraStubDirectory, 'zlib-amd64-unicode'))
  && !existsSync(resolve(fedoraStubDirectory, 'zlib-x86-unicode'))) {
  throw new Error(
    'NSIS is missing its default x86-unicode stub.\n\n'
      + 'On Fedora, install it with:\n  sudo dnf install mingw32-nsis\n\n'
      + 'The x86 NSIS bootstrap installs the 64-bit epub.ts.exe into Program Files.',
  );
}
const numericVersion = packageJson.version.match(/^\d+(?:\.\d+){0,2}/u)?.[0];
if (!numericVersion) throw new Error(`Cannot create a Windows version from ${packageJson.version}.`);
const versionQuad = `${numericVersion}.0`.split('.').slice(0, 4).join('.');
const result = spawnSync(compiler, [
  `-DAPP_VERSION=${packageJson.version}`,
  `-DAPP_VERSION_QUAD=${versionQuad}`,
  `-DREPO_ROOT=${root}`,
  `-DOUTPUT_FILE=${output}`,
  '-V2',
  script,
], { cwd: root, stdio: 'inherit' });
if (result.error?.code === 'ENOENT') {
  throw new Error(
    `NSIS compiler not found: ${compiler}\n\n`
      + 'Install it on Debian/Ubuntu with:\n  sudo apt install nsis\n\n'
      + 'Install it on Fedora with:\n  sudo dnf install mingw32-nsis\n\n'
      + 'Or point EPUB_TS_MAKENSIS to a makensis executable.',
  );
}
if (result.error) throw new Error(`Failed to start NSIS compiler: ${compiler}`, { cause: result.error });
if (result.status !== 0) throw new Error(`${compiler} exited with status ${result.status ?? 1}.`);
console.log(`Packaged ${output}`);
