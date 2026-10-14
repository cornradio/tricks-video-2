'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const lease = require('../lib/lease');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv2-files-'));
let failed = 0;

function assert(cond, message) {
  if (!cond) {
    failed++;
    console.error('FAIL', message);
  } else {
    console.log('ok  ', message);
  }
}

async function hammer(filePath, ms) {
  const until = Date.now() + ms;
  let reads = 0;
  while (Date.now() < until) {
    try {
      await lease.readChunk(filePath, 0, 256 * 1024);
      reads++;
    } catch {
      break;
    }
  }
  return reads;
}

async function main() {
  const video = path.join(root, 'clip.mp4');
  fs.writeFileSync(video, Buffer.alloc(3 * 1024 * 1024, 7));

  const reading = hammer(video, 400);
  await new Promise((r) => setTimeout(r, 40));
  await lease.removeFile(video);
  await reading;
  assert(!fs.existsSync(video), 'delete while chunks are being read');

  fs.writeFileSync(video, Buffer.alloc(2 * 1024 * 1024, 3));
  const reading2 = hammer(video, 400);
  await new Promise((r) => setTimeout(r, 40));
  const renamed = path.join(root, 'renamed.mp4');
  await lease.movePath(video, renamed);
  await reading2;
  assert(fs.existsSync(renamed) && !fs.existsSync(video), 'rename while chunks are being read');

  const made = path.join(root, '新文件夹');
  const reading3 = hammer(renamed, 300);
  await new Promise((r) => setTimeout(r, 30));
  await lease.mkdir(made);
  await reading3;
  assert(fs.statSync(made).isDirectory(), 'create folder beside an open read');

  const pack = path.join(root, 'pack');
  fs.mkdirSync(pack);
  const inner = path.join(pack, 'inner.mp4');
  fs.writeFileSync(inner, Buffer.alloc(2 * 1024 * 1024, 9));
  fs.writeFileSync(path.join(pack, 'note.txt'), 'hello');
  const reading4 = hammer(inner, 500);
  await new Promise((r) => setTimeout(r, 40));
  const moved = path.join(made, 'pack');
  await lease.movePath(pack, moved);
  await reading4;
  assert(fs.existsSync(path.join(moved, 'inner.mp4')), 'move folder while a file inside is being read');
  assert(!fs.existsSync(pack), 'source folder is gone after the move');

  const reading5 = hammer(path.join(moved, 'inner.mp4'), 400);
  await new Promise((r) => setTimeout(r, 30));
  await lease.removeDir(made);
  await reading5;
  assert(!fs.existsSync(made), 'delete folder while a file inside is being read');

  fs.rmSync(root, { recursive: true, force: true });
  if (failed) {
    console.error(failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('file operations passed');
}

main().catch((err) => {
  console.error(err);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* gone */ }
  process.exit(1);
});
