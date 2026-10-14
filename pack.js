/**
 * pack.js — 服务器部署 zip（只含源码）
 *
 * 用法: node pack.js
 * 输出: dist/tricks-video-2-server.zip
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const ZIP_NAME = 'tricks-video-2-server.zip';
const ZIP_PATH = path.join(DIST, ZIP_NAME);

const EXCLUDES = [
  'node_modules', '.git', '.pkg-cache', 'dist',
  'uploads', 'data', '.idea', '.vscode',
  'release', 'out', ZIP_NAME,
  'Thumbs.db', '.DS_Store', '*.log'
];

fs.mkdirSync(DIST, { recursive: true });
if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);

console.log('[pack] Collecting source files...');
const excludeArgs = EXCLUDES.map((e) => `--exclude="${e}"`).join(' ');
const cmd = `tar -a -c -f "${ZIP_PATH}" ${excludeArgs} -C "${ROOT}" .`;

try {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
} catch (e) {
  console.error('[pack] failed:', e.message);
  process.exit(1);
}

if (!fs.existsSync(ZIP_PATH)) {
  console.error('[pack] zip not created');
  process.exit(1);
}

const size = (fs.statSync(ZIP_PATH).size / 1024).toFixed(1);
console.log('');
console.log('========================================');
console.log('  Server pack ready');
console.log('  ' + ZIP_PATH + ' (' + size + ' KB)');
console.log('========================================');
