/**
 * build-all.js — 打出三套产物
 *  1) Electron 桌面端
 *  2) Node EXE (pkg)
 *  3) 服务器 zip
 *
 * 用法: node build-all.js
 *       node build-all.js --skip-electron
 *       node build-all.js --only server|exe|electron
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const args = new Set(process.argv.slice(2));
const only = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

function run(label, script) {
  console.log('\n######## ' + label + ' ########\n');
  execSync('node "' + path.join(ROOT, script) + '"', {
    stdio: 'inherit',
    cwd: ROOT
  });
}

const want = (name) => {
  if (only) return only === name;
  if (name === 'electron' && args.has('--skip-electron')) return false;
  return true;
};

if (want('server')) run('Server zip', 'pack.js');
if (want('exe')) run('Node EXE', 'build-exe.js');
if (want('electron')) run('Electron', 'build-electron.js');

console.log('\nAll requested builds finished. Outputs under dist/\n');
