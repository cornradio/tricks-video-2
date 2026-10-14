'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG_CACHE = path.join(ROOT, '.pkg-cache');
const SIBLING_PKG_CACHE = path.join(ROOT, '..', 'videos-tricks', '.pkg-cache');

/** Apply China-friendly download mirrors for Electron / electron-builder / npm. */
function applyChinaMirrors(env = process.env) {
  const next = Object.assign({}, env);
  // npmmirror layout: .../electron/v33.2.1/electron-v33.2.1-win32-x64.zip
  next.ELECTRON_MIRROR = next.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
  next.ELECTRON_BUILDER_BINARIES_MIRROR =
    next.ELECTRON_BUILDER_BINARIES_MIRROR ||
    'https://npmmirror.com/mirrors/electron-builder-binaries/';
  // Do NOT set ELECTRON_CUSTOM_DIR for electron-builder (it breaks URL templates).
  // npm's electron postinstall uses .npmrc electron_mirror instead.
  next.npm_config_registry = next.npm_config_registry || 'https://registry.npmmirror.com';
  next.CSC_IDENTITY_AUTO_DISCOVERY = next.CSC_IDENTITY_AUTO_DISCOVERY || 'false';
  next.PKG_CACHE_PATH = next.PKG_CACHE_PATH || PKG_CACHE;
  return next;
}

function npmInstall(args, cwd = ROOT) {
  execSync('npm install ' + args, {
    stdio: 'inherit',
    cwd,
    windowsHide: true,
    env: applyChinaMirrors()
  });
}

/** pkg-fetch only talks to GitHub; reuse local cache or pull from npmmirror CDN. */
function ensurePkgCache(nodeTag = 'v18.20.8') {
  const name = 'fetched-' + nodeTag + '-win-x64';
  const localDir = path.join(PKG_CACHE, 'v3.5');
  const localFile = path.join(localDir, name);
  if (fs.existsSync(localFile) && fs.statSync(localFile).size > 10 * 1024 * 1024) {
    console.log('[pkg-cache] using existing ' + localFile);
    return;
  }

  const sibling = path.join(SIBLING_PKG_CACHE, 'v3.5', name);
  if (fs.existsSync(sibling) && fs.statSync(sibling).size > 10 * 1024 * 1024) {
    console.log('[pkg-cache] copying from videos-tricks...');
    fs.mkdirSync(localDir, { recursive: true });
    fs.copyFileSync(sibling, localFile);
    return;
  }

  fs.mkdirSync(localDir, { recursive: true });
  const urls = [
    'https://cdn.npmmirror.com/binaries/pkg/v3.5/' + name,
    'https://npmmirror.com/mirrors/pkg/v3.5/' + name
  ];
  for (const url of urls) {
    console.log('[pkg-cache] downloading ' + url);
    try {
      execSync(
        'curl -L --fail --retry 3 --connect-timeout 20 -o "' + localFile + '" "' + url + '"',
        { stdio: 'inherit', windowsHide: true, env: applyChinaMirrors() }
      );
      if (fs.existsSync(localFile) && fs.statSync(localFile).size > 10 * 1024 * 1024) {
        console.log('[pkg-cache] ready');
        return;
      }
    } catch {
      try { if (fs.existsSync(localFile)) fs.unlinkSync(localFile); } catch { /* ignore */ }
    }
  }
  console.warn('[pkg-cache] mirror download failed; pkg may try GitHub (slow in CN)');
}

module.exports = { applyChinaMirrors, npmInstall, ensurePkgCache, PKG_CACHE };
