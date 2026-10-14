'use strict';

/**
 * Short-lived file access for Windows.
 *
 * A video response must not keep a handle open for the whole playback.
 * Directory rename/delete fails on Windows while any file inside is open,
 * even when the file itself was opened with delete sharing.
 *
 * Reads open, copy one chunk, and close before returning. Mutations freeze
 * the target, stop ffmpeg jobs that touch it, wait until those chunks finish,
 * then retry the filesystem call.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const leases = new Map();
const freezes = new Set();
const jobs = new Set();

function norm(p) {
  const resolved = path.resolve(String(p));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function hits(target, fileKey) {
  const t = norm(target);
  const f = norm(fileKey);
  if (f === t) return true;
  const sep = t.includes('\\') ? '\\' : '/';
  return f.startsWith(t.endsWith(sep) ? t : t + sep);
}

function isFrozen(fileKey) {
  for (const frozen of freezes) {
    if (hits(frozen, fileKey)) return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bump(key, delta) {
  const next = (leases.get(key) || 0) + delta;
  if (next <= 0) leases.delete(key);
  else leases.set(key, next);
}

function releaseKey(key) {
  bump(key, -1);
}

async function hold(filePath) {
  const key = norm(filePath);
  for (;;) {
    while (isFrozen(key)) await sleep(20);
    bump(key, 1);
    if (!isFrozen(key)) return key;
    releaseKey(key);
  }
}

function busy(targets) {
  for (const [key, count] of leases) {
    if (count > 0 && targets.some((target) => hits(target, key))) return true;
  }
  return false;
}

function killProcess(child) {
  if (!child || child.exitCode != null || child.signalCode) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch { /* already gone */ }
    return;
  }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

function killJobs(targets) {
  for (const job of jobs) {
    if (job.paths.some((p) => targets.some((target) => hits(target, p)))) killProcess(job.child);
  }
}

function track(child, paths) {
  const job = {
    child,
    paths: (paths || []).filter(Boolean).map(norm)
  };
  jobs.add(job);
  const done = () => jobs.delete(job);
  child.once('exit', done);
  child.once('error', done);
  return job;
}

async function mutate(targets, fn) {
  const list = (Array.isArray(targets) ? targets : [targets]).filter(Boolean).map(norm);
  for (const key of list) freezes.add(key);
  try {
    killJobs(list);
    const deadline = Date.now() + 8000;
    while (busy(list) && Date.now() < deadline) await sleep(20);
    return await fn();
  } finally {
    for (const key of list) freezes.delete(key);
  }
}

const RETRYABLE = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'UNKNOWN', 'EMFILE']);

async function retry(fn, times = 8) {
  let last;
  for (let i = 0; i < times; i++) {
    if (i) await sleep(30 * (i + 1));
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!RETRYABLE.has(err.code)) throw err;
    }
  }
  throw last;
}

async function readChunk(filePath, position, length) {
  const key = await hold(filePath);
  let fh;
  try {
    fh = await fsp.open(filePath, 'r');
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await fh.read(buf, 0, length, position);
    return buf.subarray(0, bytesRead);
  } finally {
    if (fh) {
      try { await fh.close(); } catch { /* closed */ }
    }
    releaseKey(key);
  }
}

async function readWhole(filePath, maxBytes) {
  const key = await hold(filePath);
  let fh;
  try {
    fh = await fsp.open(filePath, 'r');
    const stat = await fh.stat();
    if (maxBytes && stat.size > maxBytes) {
      const err = new Error('File is too large to read at once');
      err.code = 'EFBIG';
      throw err;
    }
    const buf = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      const { bytesRead } = await fh.read(buf, offset, stat.size - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return buf.subarray(0, offset);
  } finally {
    if (fh) {
      try { await fh.close(); } catch { /* closed */ }
    }
    releaseKey(key);
  }
}

async function removeFile(filePath) {
  await mutate(filePath, () => retry(async () => {
    try {
      await fsp.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }));
}

async function removeDir(dirPath) {
  await mutate(dirPath, () => retry(() => fsp.rm(dirPath, { recursive: true, force: true })));
}

async function mkdir(dirPath) {
  try {
    await fsp.mkdir(dirPath);
    return;
  } catch (err) {
    if (err.code === 'EEXIST') return;
    if (!RETRYABLE.has(err.code)) throw err;
  }
  await mutate(path.dirname(dirPath), () => retry(async () => {
    try { await fsp.mkdir(dirPath); } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }));
}

async function movePath(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await mutate([from, to], () => retry(async () => {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      if (err.code !== 'EXDEV' && err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
    }
    await fsp.cp(from, to, { recursive: true, force: true, errorOnExist: false });
    const stat = await fsp.stat(from);
    if (stat.isDirectory()) await fsp.rm(from, { recursive: true, force: true });
    else await fsp.unlink(from);
  }));
}

async function writeAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  await mutate(filePath, async () => {
    await fsp.writeFile(tmp, data);
    await retry(() => fsp.rename(tmp, filePath));
  });
}

module.exports = {
  norm,
  hits,
  track,
  killProcess,
  mutate,
  retry,
  readChunk,
  readWhole,
  removeFile,
  removeDir,
  mkdir,
  movePath,
  writeAtomic
};
