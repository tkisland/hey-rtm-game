import { afterEach, beforeEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let root: string;
const script = fileURLToPath(new URL('../scripts/check-public-build.mjs', import.meta.url));
const verify = () => execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const put = (path: string, content = '') => writeFileSync(join(root, 'dist', path), content);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hey-public-build-'));
  mkdirSync(join(root, 'dist/assets'), {recursive:true});
  put('index.html', '<h1>Select music</h1>'); put('game.html', '<canvas></canvas>');
});
afterEach(() => rmSync(root, {recursive:true, force:true}));
it('accepts the two public pages and their player assets', () => {
  put('assets/game-abc.js', 'console.log("player");');
  expect(verify()).toContain('Public output verified');
});
it('rejects leftover editor pages and hashed editor assets', () => {
  for (const path of ['editor.html', 'assets/editor-abc.js', 'assets/editor-abc.css']) {
    put(path); expect(verify).toThrow('Admin asset in public output'); rmSync(join(root, 'dist', path));
  }
});
it('rejects draft storage and editing controls embedded in shared assets or HTML', () => {
  for (const marker of ['hey-rhythm-editor-v1', 'hey-rhythm-custom-chart-v1', 'record-toggle', 'id="chart-source"', '譜面エディター']) {
    put('assets/shared.js', marker); expect(verify).toThrow('Admin functionality');
  }
});
it('rejects an incomplete public artifact', () => {
  rmSync(join(root, 'dist/game.html')); expect(verify).toThrow('Missing public page');
});
