import { afterEach, beforeEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let root: string;
const script = fileURLToPath(new URL('../scripts/check-public-build.mjs', import.meta.url));
const verify = () => execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const requireManifest = () => readFileSync(join(root, 'dist/.vite/manifest.json'), 'utf8');
const put = (path: string, content = '') => writeFileSync(join(root, 'dist', path), content);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hey-public-build-'));
  mkdirSync(join(root, 'dist/assets'), {recursive:true});
  mkdirSync(join(root, 'dist/.vite'), {recursive:true});
  put('index.html', '<h1>Select music</h1>'); put('game.html', '<canvas></canvas>'); put('admin.html', '<button>Sign in</button>');
  const manifest = Object.fromEntries(['index','game','admin'].map(name => [`${name}.html`, {file:`assets/${name}.js`}]));
  put('.vite/manifest.json',JSON.stringify(manifest));
  for (const name of ['index','game','admin']) put(`assets/${name}.js`,'console.log(1);');
});
afterEach(() => rmSync(root, {recursive:true, force:true}));
it('accepts player pages and the sign-in entry', () => {
  put('assets/game.js', 'console.log("player");');
  expect(verify()).toContain('Public output verified');
});
it('allows the editor only in the dynamically loaded administrator graph', () => {
  const manifest = JSON.parse(requireManifest());
  manifest['admin.html'].dynamicImports = ['controller'];
  manifest.controller = {file:'assets/editor-controller.js'};
  put('.vite/manifest.json',JSON.stringify(manifest)); put('assets/editor-controller.js','record-toggle');
  expect(verify()).toContain('Public output verified');
});
it('rejects editor UI loaded before administrator authentication', () => {
  put('assets/admin.js','record-toggle'); expect(verify).toThrow('Admin functionality');
});
it('rejects leftover editor pages and hashed editor assets', () => {
  for (const path of ['editor.html', 'assets/editor-abc.js', 'assets/editor-abc.css']) {
    put(path); expect(verify).toThrow('Admin asset in public output'); rmSync(join(root, 'dist', path));
  }
});
it('rejects draft storage and editing controls embedded in shared assets or HTML', () => {
  for (const marker of ['hey-rhythm-editor-v1', 'hey-rhythm-custom-chart-v1', 'record-toggle', 'id="chart-source"', '譜面エディター']) {
    put('assets/game.js', marker); expect(verify).toThrow('Admin functionality');
  }
});
it('rejects an incomplete public artifact', () => {
  rmSync(join(root, 'dist/game.html')); expect(verify).toThrow('Missing public page');
});
it('refuses to publish the test project or emulator configuration', () => {
  put('assets/admin.js','demo-hey-rtm'); expect(verify).toThrow('Emulator configuration must not be published');
});
