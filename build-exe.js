/**
 * build-exe.js — 用 @yao-pkg/pkg 打成单文件 Node EXE
 *
 * 用法: node build-exe.js
 * 输出: dist/tricks-video-2.exe
 *
 * 国内网络：优先复用 / 从 npmmirror 拉 pkg 缓存，不走 GitHub。
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { applyChinaMirrors, npmInstall, ensurePkgCache, PKG_CACHE } = require('./scripts/china-mirrors');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

console.log('[exe 1/5] Check deps...');
try {
  require.resolve('express');
  require.resolve('multer');
} catch {
  npmInstall('--omit=dev');
}

console.log('[exe 2/5] Check @yao-pkg/pkg...');
try {
  require.resolve('@yao-pkg/pkg');
} catch {
  npmInstall('--save-dev @yao-pkg/pkg');
}

console.log('[exe 3/5] Prepare pkg binary cache (CN mirror)...');
ensurePkgCache('v18.20.8');

console.log('[exe 4/5] Prepare data defaults...');
const dataDir = path.join(ROOT, 'data');
fs.mkdirSync(dataDir, { recursive: true });
for (const [name, content] of Object.entries({
  'tricks.json': '[]',
  'categories.json': '[]',
  'local-clips.json': '{}',
  'play-history.json': '[]',
  'history-exclude.json': '[]',
  'thumb-times.json': '{}',
  'resource-links.json': '[]'
})) {
  const fp = path.join(dataDir, name);
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, content);
}

console.log('[exe 5/5] Packaging with pkg...');
fs.mkdirSync(DIST, { recursive: true });
const outExe = path.join(DIST, 'tricks-video-2.exe');
if (fs.existsSync(outExe)) fs.unlinkSync(outExe);

try {
  execSync('npx @yao-pkg/pkg server.js --config package.json --targets node18-win-x64 --output dist/tricks-video-2.exe', {
    stdio: 'inherit',
    cwd: ROOT,
    windowsHide: true,
    env: applyChinaMirrors({
      PKG_CACHE_PATH: PKG_CACHE
    })
  });
} catch (e) {
  console.error('\n[exe] failed:', e.message);
  process.exit(1);
}

if (!fs.existsSync(outExe)) {
  console.error('[exe] output missing');
  process.exit(1);
}

const size = (fs.statSync(outExe).size / 1024 / 1024).toFixed(1);
console.log('');
console.log('========================================');
console.log('  EXE ready: dist/tricks-video-2.exe (' + size + ' MB)');
console.log('  Double-click or: tricks-video-2.exe 3210');
console.log('  data/ uploads/ are created next to the exe');
console.log('========================================');
