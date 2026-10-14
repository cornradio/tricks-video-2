/**
 * deploy.js — 上传服务器 zip 并替换家里服务器上的运行版本
 *
 * 目标与旧版 videos-tricks 相同:
 *   Host  192.168.31.11
 *   Dir   /home/kasusa/video-tricks
 *   Port  6688
 *   Screen videotrick
 *
 * 用法: node deploy.js
 *       node deploy.js --pack   (先打 zip 再部署)
 */
'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ZIP = path.join(ROOT, 'dist', 'tricks-video-2-server.zip');
const HOST = process.env.TV2_DEPLOY_HOST || '192.168.31.11';
const USER = process.env.TV2_DEPLOY_USER || 'kasusa';
const APP_DIR = process.env.TV2_DEPLOY_DIR || '/home/kasusa/video-tricks';
const REMOTE_ZIP = APP_DIR + '/tricks-video-2-server.zip';
const NODE = process.env.TV2_DEPLOY_NODE || '/home/kasusa/.nvm/versions/node/v20.20.0/bin/node';
const PORT = process.env.TV2_DEPLOY_PORT || '6688';
const SCREEN = process.env.TV2_DEPLOY_SCREEN || 'videotrick';
const SSH = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];

function sh(cmd, opts = {}) {
  console.log('> ' + cmd);
  execSync(cmd, Object.assign({ stdio: 'inherit', windowsHide: true }, opts));
}

function ssh(remoteCmd) {
  const r = spawnSync('ssh', SSH.concat([USER + '@' + HOST, remoteCmd]), {
    encoding: 'utf8',
    windowsHide: true
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error('ssh failed with code ' + r.status);
  }
  return r;
}

if (process.argv.includes('--pack') || !fs.existsSync(ZIP)) {
  console.log('[deploy] packing server zip...');
  sh('node "' + path.join(ROOT, 'pack.js') + '"', { cwd: ROOT });
}

if (!fs.existsSync(ZIP)) {
  console.error('[deploy] missing ' + ZIP);
  process.exit(1);
}

console.log('[deploy] upload ' + ZIP);
sh([
  'scp',
  ...SSH,
  '"' + ZIP + '"',
  USER + '@' + HOST + ':' + REMOTE_ZIP
].join(' '));

console.log('[deploy] replace + restart on ' + HOST);
const remote = [
  'set -e',
  'cd ' + APP_DIR,
  'NODE=' + NODE,
  'screen -S ' + SCREEN + ' -X quit 2>/dev/null || true',
  'fuser -k ' + PORT + '/tcp 2>/dev/null || true',
  'sleep 1',
  'unzip -o tricks-video-2-server.zip',
  'screen -dmS ' + SCREEN + ' "$NODE" ' + APP_DIR + '/server.js ' + PORT,
  'sleep 2',
  'screen -ls | grep -i ' + SCREEN + ' || true',
  'ss -tlnp 2>/dev/null | grep ' + PORT + ' || true',
  'curl -s -o /dev/null -w "http=%{http_code}\\n" --connect-timeout 3 http://127.0.0.1:' + PORT + '/'
].join('\n');

ssh(remote);

console.log('');
console.log('========================================');
console.log('  Deployed to ' + USER + '@' + HOST + ':' + APP_DIR);
console.log('  http://' + HOST + ':' + PORT + '/');
console.log('========================================');
