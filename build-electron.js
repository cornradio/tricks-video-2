/**
 * build-electron.js — Electron 桌面端
 *
 * 用法: node build-electron.js
 * 输出: dist/electron/
 *
 * 国内网络：Electron / builder 二进制走 npmmirror，不走 GitHub。
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { applyChinaMirrors, npmInstall } = require('./scripts/china-mirrors');

const ROOT = __dirname;

console.log('[electron 1/4] Check electron + electron-builder (CN mirrors)...');
for (const mod of ['electron', 'electron-builder']) {
  try {
    require.resolve(mod);
  } catch {
    console.log('  installing ' + mod + '...');
    npmInstall('--save-dev ' + mod);
  }
}

console.log('[electron 2/4] Ensure runtime deps...');
try {
  require.resolve('express');
} catch {
  npmInstall('');
}

console.log('[electron 3/4] Ensure app icon...');
const iconIco = path.join(ROOT, 'build', 'icon.ico');
const iconPng = path.join(ROOT, 'build', 'icon.png');
const fs = require('fs');
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
if (!fs.existsSync(iconPng)) fs.copyFileSync(path.join(ROOT, 'public', 'favicon.png'), iconPng);
// NSIS rejects oversized ICOs; prefer compact tray icon for installer/exe branding
if (!fs.existsSync(iconIco) || fs.statSync(iconIco).size > 200 * 1024) {
  fs.copyFileSync(path.join(ROOT, 'public', 'tray-icon.ico'), iconIco);
}

console.log('[electron 4/4] Building Windows Electron package...');
try {
  execSync('npx electron-builder --win --x64', {
    stdio: 'inherit',
    cwd: ROOT,
    windowsHide: true,
    env: applyChinaMirrors()
  });
} catch (e) {
  console.error('\n[electron] failed:', e.message);
  process.exit(1);
}

console.log('');
console.log('========================================');
console.log('  Electron build done — see dist/electron/');
console.log('========================================');
