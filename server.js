'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const express = require('express');
const multer = require('multer');
const { spawn, execFile } = require('child_process');
const { randomUUID, createHash } = require('crypto');
const lease = require('./lib/lease');

const PORT = Number(process.env.PORT || process.argv[2] || 3210);
const IS_PKG = !!process.pkg;
const CODE_ROOT = path.resolve(__dirname);
const BASE = process.env.TV2_BASE
  ? path.resolve(process.env.TV2_BASE)
  : (IS_PKG ? path.dirname(process.execPath) : CODE_ROOT);
const PUBLIC_DIR = process.env.TV2_PUBLIC
  ? path.resolve(process.env.TV2_PUBLIC)
  : path.join(CODE_ROOT, 'public');
const DATA_DIR = path.join(BASE, 'data');
const UPLOADS = path.join(BASE, 'uploads');
const THUMBS = path.join(UPLOADS, 'thumbs');
const TRICK_VIDEOS = path.join(UPLOADS, 'videos');
const TRIMMED = path.join(UPLOADS, 'trimmed');
const INCOMING = path.join(UPLOADS, 'incoming');
const PLAY_CACHE = path.join(UPLOADS, 'play-cache');

const FILES = {
  tricks: path.join(DATA_DIR, 'tricks.json'),
  cats: path.join(DATA_DIR, 'categories.json'),
  clips: path.join(DATA_DIR, 'local-clips.json'),
  history: path.join(DATA_DIR, 'play-history.json'),
  exclude: path.join(DATA_DIR, 'history-exclude.json'),
  thumbs: path.join(DATA_DIR, 'thumb-times.json'),
  links: path.join(DATA_DIR, 'resource-links.json'),
  whitelist: path.join(DATA_DIR, 'whitelist.txt'),
  convertLog: path.join(DATA_DIR, 'convert-history.log')
};

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.m4v', '.ts', '.m2ts']);
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus', '.wma']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.avif', '.svg']);
const SUB_EXTS = new Set(['.srt', '.ass', '.ssa', '.vtt']);
const REMUX_EXTS = new Set(['.mkv', '.avi', '.wmv', '.flv', '.ts', '.m2ts']);
const PRESETS = {
  copy: { name: '快速转封装', height: 0, video: 0, audio: 0 },
  '1080p-high': { name: '1080p 高画质', height: 1080, video: 8000, audio: 128 },
  '1080p': { name: '1080p 省空间', height: 1080, video: 4000, audio: 128 },
  '720p': { name: '720p 手机', height: 720, video: 2000, audio: 96 },
  '480p': { name: '480p 最小', height: 480, video: 1000, audio: 64 }
};
const AUDIO_PRESETS = {
  '320k': { name: '高质量 320k', bitrate: 320, ext: '.mp3' },
  '192k': { name: '标准 192k', bitrate: 192, ext: '.mp3' },
  '128k': { name: '省空间 128k', bitrate: 128, ext: '.mp3' },
  '96k': { name: '最小 96k', bitrate: 96, ext: '.mp3' }
};
const FUNNY = ['地板杀手', '膝盖终结者', '重力叛逆者', '水泥冲浪王', '空中飞人', '刹车失灵', '轮子成精', '摔倒艺术家', '牛顿棺材板', '今天不摔了'];

for (const dir of [DATA_DIR, THUMBS, TRICK_VIDEOS, TRIMMED, INCOMING, PLAY_CACHE]) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function md5(text) {
  return createHash('md5').update(String(text)).digest('hex');
}
function readWhitelist() {
  try {
    return fs.readFileSync(FILES.whitelist, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}
function allowed(target) {
  const list = readWhitelist();
  if (!list.length) return true;
  const resolved = path.resolve(target);
  return list.some((entry) => {
    const root = path.resolve(entry);
    return lease.hits(root, resolved) || lease.norm(root) === lease.norm(resolved);
  });
}
function samePath(a, b) {
  return lease.norm(a) === lease.norm(b);
}
function retarget(full, oldRoot, newRoot) {
  const from = path.resolve(full);
  const root = path.resolve(oldRoot);
  if (lease.norm(from) === lease.norm(root)) return newRoot;
  if (!lease.hits(root, from)) return null;
  return path.join(newRoot, from.slice(root.length).replace(/^[\\/]/, ''));
}
function validName(name) {
  const cleaned = String(name || '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return null;
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(cleaned)) return null;
  if (cleaned.endsWith('.') || cleaned.endsWith(' ')) return null;
  return cleaned;
}
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo', '.wmv': 'video/x-msvideo', '.mkv': 'video/x-matroska',
    '.flv': 'video/x-flv', '.ts': 'video/mp2t', '.m2ts': 'video/mp2t',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
    '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wma': 'audio/x-ms-wma',
    '.vtt': 'text/vtt', '.srt': 'text/plain', '.ass': 'text/x-ssa', '.ssa': 'text/x-ssa'
  };
  return map[ext] || 'application/octet-stream';
}
function isMedia(name) {
  const ext = path.extname(name).toLowerCase();
  return VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext) || IMAGE_EXTS.has(ext);
}
function mediaKind(name) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'file';
}
function notePath(filePath) {
  return filePath + '.notes.txt';
}
function coverFile(filePath) {
  return path.join(THUMBS, md5(filePath) + '.manual.jpg');
}
function hasNote(filePath) {
  try { return fs.statSync(notePath(filePath)).size > 0; } catch { return false; }
}

function spawnTracked(cmd, args, paths) {
  const child = spawn(cmd, args, { windowsHide: true });
  lease.track(child, paths);
  return child;
}

function shellQuote(arg) {
  const s = String(arg);
  if (!s) return '""';
  if (/^[A-Za-z0-9_./:\\@%+=,-]+$/.test(s)) return s;
  return '"' + s.replace(/"/g, '\\"') + '"';
}
function formatCmd(bin, args) {
  return [bin, ...args.map(shellQuote)].join(' ');
}
function listVideosUnder(dirPath) {
  const videos = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) videos.push(full);
    }
  };
  walk(dirPath);
  return videos;
}
function convertOutputFor(filePath) {
  const ext = path.extname(filePath);
  const isMp4 = ext.toLowerCase() === '.mp4';
  const output = path.join(path.dirname(filePath), path.basename(filePath, ext) + (isMp4 ? '.fixed.mp4' : '.mp4'));
  return { ext, isMp4, output };
}

function runCommand(cmd, args, paths, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(cmd, args, paths);
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };
    const timer = timeoutMs > 0 ? setTimeout(() => {
      lease.killProcess(child);
      finish(reject, new Error(cmd + ' timed out'));
    }, timeoutMs) : null;
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => {
      err += chunk;
      if (err.length > 8000) err = err.slice(-4000);
    });
    child.once('error', (error) => finish(reject, error));
    child.once('close', (code) => {
      if (code === 0) finish(resolve, { stdout: out, stderr: err });
      else finish(reject, new Error((err || out || cmd + ' failed').trim().slice(-500)));
    });
  });
}

function remapRecords(oldRoot, newRoot, isDir) {
  const clips = readJson(FILES.clips, []);
  let clipsChanged = false;
  for (const clip of clips) {
    const next = retarget(clip.videoPath, oldRoot, newRoot);
    if (next && next !== clip.videoPath) {
      clip.videoPath = next;
      clipsChanged = true;
    }
  }
  if (clipsChanged) writeJson(FILES.clips, clips);

  const history = readJson(FILES.history, []);
  let historyChanged = false;
  for (const row of history) {
    const next = retarget(row.trickId, oldRoot, newRoot);
    if (next && next !== row.trickId) {
      row.trickId = next;
      historyChanged = true;
    }
  }
  if (historyChanged) writeJson(FILES.history, history);

  const times = readJson(FILES.thumbs, {});
  const nextTimes = {};
  let timesChanged = false;
  for (const [key, value] of Object.entries(times)) {
    const next = retarget(key, oldRoot, newRoot);
    nextTimes[next || key] = value;
    if (next && next !== key) timesChanged = true;
  }
  if (timesChanged) writeJson(FILES.thumbs, nextTimes);

  if (!isDir) {
    const fromNote = notePath(oldRoot);
    if (fs.existsSync(fromNote)) {
      try { fs.renameSync(fromNote, notePath(newRoot)); } catch { /* sidecar can be rewritten */ }
    }
    const fromCover = coverFile(oldRoot);
    if (fs.existsSync(fromCover)) {
      try { fs.renameSync(fromCover, coverFile(newRoot)); } catch { /* cover is optional */ }
    }
    return;
  }

  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (isMedia(entry.name)) {
        const previous = retarget(full, newRoot, oldRoot);
        if (!previous) continue;
        const fromCover = coverFile(previous);
        if (fs.existsSync(fromCover)) {
          try { fs.renameSync(fromCover, coverFile(full)); } catch { /* keep going */ }
        }
      }
    }
  };
  walk(newRoot);
}

function forgetPath(target, isDir) {
  const clips = readJson(FILES.clips, []).filter((clip) => {
    if (!isDir) return !samePath(clip.videoPath, target);
    return !(samePath(clip.videoPath, target) || lease.hits(target, clip.videoPath));
  });
  writeJson(FILES.clips, clips);

  const history = readJson(FILES.history, []).filter((row) => {
    if (!isDir) return !samePath(row.trickId, target);
    return !(samePath(row.trickId, target) || lease.hits(target, row.trickId));
  });
  writeJson(FILES.history, history);

  if (!isDir) {
    try { fs.unlinkSync(notePath(target)); } catch { /* none */ }
    try { fs.unlinkSync(coverFile(target)); } catch { /* none */ }
    return;
  }
  const times = readJson(FILES.thumbs, {});
  let changed = false;
  for (const key of Object.keys(times)) {
    if (samePath(key, target) || lease.hits(target, key)) {
      delete times[key];
      changed = true;
    }
  }
  if (changed) writeJson(FILES.thumbs, times);
}

async function readEntries(dirPath) {
  try { return await fsp.readdir(dirPath, { withFileTypes: true }); }
  catch { return []; }
}

async function treeFolder(dirPath, depth) {
  const node = {
    name: path.basename(dirPath) || dirPath,
    path: dirPath,
    count: 0,
    hasThumb: false,
    folders: []
  };
  if (depth > 40) return node;
  const entries = await readEntries(dirPath);
  const children = [];
  for (const entry of entries) {
    if (entry.name === '.TThumb.PNG') { node.hasThumb = true; continue; }
    if (entry.name.endsWith('.notes.txt')) continue;
    if (entry.isDirectory()) children.push(path.join(dirPath, entry.name));
    else if (entry.isFile() && isMedia(entry.name)) node.count += 1;
  }
  node.folders = await Promise.all(children.map((child) => treeFolder(child, depth + 1)));
  node.folders.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  for (const child of node.folders) node.count += child.count;
  return node;
}

async function describeMedia(dirPath, name, names, subs) {
  const full = path.join(dirPath, name);
  let size = 0;
  let birthtime = 0;
  try {
    const stat = await fsp.stat(full);
    size = stat.size;
    birthtime = stat.birthtimeMs || stat.mtimeMs;
  } catch { /* raced with a delete */ }
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name, ext);
  const noteName = name + '.notes.txt';
  let note = '';
  if (names.has(noteName)) {
    try {
      note = (await lease.readWhole(path.join(dirPath, noteName), 256 * 1024)).toString('utf8');
    } catch { /* missing / locked */ }
  }
  return {
    name,
    path: full,
    size,
    birthtime,
    type: mediaKind(name),
    hasNote: names.has(noteName),
    note,
    subtitles: subs
      .filter((sub) => path.basename(sub, path.extname(sub)) === base)
      .map((sub) => ({ name: sub, path: path.join(dirPath, sub) }))
  };
}

async function listMedia(dirPath, depth, out) {
  if (depth > 40) return;
  const entries = await readEntries(dirPath);
  const names = new Set(entries.map((entry) => entry.name));
  const subs = [];
  const files = [];
  const children = [];
  for (const entry of entries) {
    if (entry.name === '.TThumb.PNG' || entry.name.endsWith('.notes.txt')) continue;
    if (entry.isDirectory()) children.push(path.join(dirPath, entry.name));
    else if (entry.isFile() && isMedia(entry.name)) files.push(entry.name);
    else if (entry.isFile() && SUB_EXTS.has(path.extname(entry.name).toLowerCase())) subs.push(entry.name);
  }
  const described = await Promise.all(files.map((name) => describeMedia(dirPath, name, names, subs)));
  out.push(...described);
  await Promise.all(children.map((child) => listMedia(child, depth + 1, out)));
}

async function sendBytes(filePath, req, res, type, extra = {}) {
  const stat = await fsp.stat(filePath);
  const size = stat.size;
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    if (match[1] === '') {
      const suffix = Number(match[2]);
      start = Math.max(0, size - suffix);
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
    }
    if (!Number.isFinite(start) || start < 0 || start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    end = Math.min(end, size - 1);
    status = 206;
  }
    const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Cache-Control': 'no-store',
    ...extra
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  let aborted = false;
  res.on('close', () => { aborted = true; });
  const chunkSize = 1024 * 1024;
  let pos = start;
  try {
    while (pos <= end && !aborted && !res.destroyed) {
      const len = Math.min(chunkSize, end - pos + 1);
      const buf = await lease.readChunk(filePath, pos, len);
      if (!buf.length || aborted) break;
      if (!res.write(buf)) await new Promise((resolve) => res.once('drain', resolve));
      pos += buf.length;
    }
  } catch (err) {
    if (!res.headersSent) throw err;
    res.destroy();
    return;
  }
  if (!res.writableEnded && !aborted) res.end();
}

function srtToVtt(text) {
  const body = text.replace(/^\uFEFF/, '').replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return 'WEBVTT\n\n' + body.replace(/^\d+\n/gm, '');
}

let thumbActive = 0;
const thumbWaiters = [];
function takeThumbSlot() {
  if (thumbActive < 2) {
    thumbActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => thumbWaiters.push(resolve));
}
function freeThumbSlot() {
  thumbActive -= 1;
  if (thumbWaiters.length && thumbActive < 2) {
    thumbActive += 1;
    thumbWaiters.shift()();
  }
}

async function ensureThumb(filePath, seconds) {
  const stamp = seconds == null ? '1' : String(seconds);
  const dest = path.join(THUMBS, md5(filePath + '@' + stamp) + '.jpg');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 500) return dest;
  await takeThumbSlot();
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 500) return dest;
    const seek = Math.max(0, Number(stamp) || 0);
    await runCommand('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-ss', String(seek), '-i', filePath,
      '-frames:v', '1', '-vf', 'scale=640:-1', dest
    ], [filePath], 12000);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 500) return dest;
    throw new Error('thumbnail empty');
  } finally {
    freeThumbSlot();
  }
}
async function ensureAudioCover(filePath) {
  const dest = path.join(THUMBS, md5(filePath + '@cover') + '.jpg');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 200) return dest;
  await takeThumbSlot();
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 200) return dest;
    // Prefer embedded album art / attached picture stream.
    try {
      await runCommand('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', filePath, '-an', '-vcodec', 'mjpeg', '-frames:v', '1',
        '-vf', 'scale=640:-1', dest
      ], [filePath], 8000);
    } catch {
      try { fs.unlinkSync(dest); } catch { /* retry */ }
      throw new Error('no cover');
    }
    if (fs.existsSync(dest) && fs.statSync(dest).size > 200) return dest;
    throw new Error('cover empty');
  } finally {
    freeThumbSlot();
  }
}

const playJobs = new Map();
function playKey(filePath) {
  const stat = fs.statSync(filePath);
  return md5(filePath + '@' + stat.size + '@' + Math.floor(stat.mtimeMs));
}
async function ensurePlayable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!REMUX_EXTS.has(ext)) return filePath;
  const key = playKey(filePath);
  const dest = path.join(PLAY_CACHE, key + '.mp4');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest;
  if (playJobs.has(key)) return playJobs.get(key);
  const job = (async () => {
    const tmp = dest + '.part';
    try { fs.unlinkSync(tmp); } catch { /* clean */ }
    const base = ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn'];
    try {
      await runCommand('ffmpeg', [...base, '-c', 'copy', '-movflags', '+faststart', tmp], [filePath], 0);
    } catch {
      try { fs.unlinkSync(tmp); } catch { /* retry */ }
      await runCommand('ffmpeg', [...base, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp], [filePath], 0);
    }
    await lease.movePath(tmp, dest);
    return dest;
  })();
  playJobs.set(key, job);
  try { return await job; } finally { playJobs.delete(key); }
}

function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  return (payload) => {
    if (!res.writableEnded) res.write('data: ' + JSON.stringify(payload) + '\n\n');
  };
}

function descendants(cats, id) {
  const ids = [id];
  for (const child of cats.filter((cat) => cat.parentId === id)) ids.push(...descendants(cats, child.id));
  return ids;
}

const app = express();
app.use(express.json({ limit: '10mb' }));

function needPath(req, res) {
  const filePath = req.query.path || req.body?.path || req.body?.filePath;
  if (!filePath) {
    res.status(400).json({ error: '缺少路径' });
    return null;
  }
  if (!allowed(filePath)) {
    res.status(403).json({ error: '该路径不在白名单中' });
    return null;
  }
  return filePath;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'Tricks Video 2' }));
app.get('/api/whitelist', (_req, res) => res.json(readWhitelist()));

app.get('/api/tree', async (req, res) => {
  const dirPath = needPath(req, res);
  if (!dirPath) return;
  try {
    const stat = await fsp.stat(dirPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: '不是文件夹' });
    res.set('Cache-Control', 'no-store');
    res.json(await treeFolder(dirPath, 0));
  } catch (err) {
    if (!res.headersSent) res.status(400).json({ error: err.message });
  }
});

app.get('/api/files', async (req, res) => {
  const dirPath = needPath(req, res);
  if (!dirPath) return;
  try {
    const stat = await fsp.stat(dirPath);
    if (!stat.isDirectory()) return res.status(400).json({ error: '不是文件夹' });
    const entries = await readEntries(dirPath);
    const files = [];
    await listMedia(dirPath, 0, files);
    files.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    res.set('Cache-Control', 'no-store');
    res.json({
      name: path.basename(dirPath),
      path: dirPath,
      hasThumb: entries.some((entry) => entry.name === '.TThumb.PNG'),
      files
    });
  } catch (err) {
    if (!res.headersSent) res.status(400).json({ error: err.message });
  }
});

app.get('/api/stream', async (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  try {
    const download = req.query.download === '1';
    const ext = path.extname(filePath).toLowerCase();
    const isAudio = AUDIO_EXTS.has(ext);
    const stat = await fsp.stat(filePath);
    const extra = {
      ...(download
        ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}` }
        : {}),
      'Cache-Control': isAudio && !download ? 'private, max-age=604800' : (download ? 'private, max-age=60' : 'no-store'),
      ETag: '"' + stat.size + '-' + Math.floor(stat.mtimeMs) + '"'
    };
    await sendBytes(filePath, req, res, contentType(filePath), extra);
  } catch (err) {
    if (!res.headersSent) res.status(404).json({ error: err.message });
    else res.destroy();
  }
});

app.get('/api/play-ready', (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  const ext = path.extname(filePath).toLowerCase();
  if (!REMUX_EXTS.has(ext)) return res.json({ ready: true, remux: false });
  try {
    const dest = path.join(PLAY_CACHE, playKey(filePath) + '.mp4');
    res.json({ ready: fs.existsSync(dest), remux: true, preparing: playJobs.has(playKey(filePath)) });
  } catch {
    res.json({ ready: false, remux: true });
  }
});

app.get('/api/play', async (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  try {
    const playable = await ensurePlayable(filePath);
    const ext = path.extname(playable).toLowerCase();
    const isAudio = AUDIO_EXTS.has(ext);
    const stat = await fsp.stat(playable);
    await sendBytes(playable, req, res, contentType(playable), {
      // Audio: allow browser HTTP cache so progressive play + later "download from cache" work.
      'Cache-Control': isAudio ? 'private, max-age=604800' : 'no-store',
      ETag: '"' + stat.size + '-' + Math.floor(stat.mtimeMs) + '"'
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: '无法播放: ' + err.message });
    else res.destroy();
  }
});

app.get('/api/subtitle', async (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  try {
    const buf = await lease.readWhole(filePath, 8 * 1024 * 1024);
    let text = buf.toString('utf8');
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.srt') text = srtToVtt(text);
    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(text);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/api/thumbnail', async (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  try {
    const manual = coverFile(filePath);
    if (fs.existsSync(manual) && fs.statSync(manual).size > 500) {
      const buf = await lease.readWhole(manual, 20 * 1024 * 1024);
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'no-store');
      return res.end(buf);
    }
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      const buf = await lease.readWhole(filePath, 40 * 1024 * 1024);
      res.set('Content-Type', contentType(filePath));
      res.set('Cache-Control', 'no-store');
      return res.end(buf);
    }
    if (AUDIO_EXTS.has(ext)) {
      try {
        const cover = await ensureAudioCover(filePath);
        const buf = await lease.readWhole(cover, 20 * 1024 * 1024);
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', req.query.fresh ? 'no-store' : 'public, max-age=86400');
        return res.end(buf);
      } catch {
        return res.status(404).send('audio has no cover');
      }
    }
    if (req.query.fresh) {
      const stamp = req.query.t == null ? '1' : String(req.query.t);
      try { fs.unlinkSync(path.join(THUMBS, md5(filePath + '@' + stamp) + '.jpg')); } catch { /* regen */ }
    }
    const thumb = await ensureThumb(filePath, req.query.t);
    const buf = await lease.readWhole(thumb, 20 * 1024 * 1024);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', req.query.fresh ? 'no-store' : 'public, max-age=86400');
    res.end(buf);
  } catch (err) {
    if (!res.headersSent) res.status(404).send(err.message);
  }
});

app.get('/api/folder-thumb', async (req, res) => {
  const dirPath = needPath(req, res);
  if (!dirPath) return;
  const thumb = path.join(dirPath, '.TThumb.PNG');
  try {
    const buf = await lease.readWhole(thumb, 20 * 1024 * 1024);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.end(buf);
  } catch {
    res.status(404).end();
  }
});

const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
app.post('/api/folder-thumb', memoryUpload.single('thumb'), async (req, res) => {
  const dirPath = req.body?.folderPath || req.body?.path;
  if (!dirPath || !req.file) return res.status(400).json({ error: '缺少参数' });
  if (!allowed(dirPath)) return res.status(403).json({ error: '该路径不在白名单中' });
  try {
    await lease.writeAtomic(path.join(dirPath, '.TThumb.PNG'), req.file.buffer);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/folder-thumb', async (req, res) => {
  const dirPath = needPath(req, res);
  if (!dirPath) return;
  try {
    await lease.removeFile(path.join(dirPath, '.TThumb.PNG'));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cover', memoryUpload.single('thumb'), async (req, res) => {
  const filePath = req.body?.path;
  if (!filePath || !req.file) return res.status(400).json({ error: '缺少参数' });
  if (!allowed(filePath)) return res.status(403).json({ error: '该路径不在白名单中' });
  try {
    await lease.writeAtomic(coverFile(filePath), req.file.buffer);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/cover', async (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  try {
    await lease.removeFile(coverFile(filePath));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const CARD_PREFS_FILE = '.tv2-card.json';
const CARD_PREFS_DEFAULTS = { size: 280, ratio: 56, ui: 'out', fit: 'contain', thumbTime: 1 };
function cardPrefsPath(dirPath) {
  return path.join(dirPath, CARD_PREFS_FILE);
}
function normalizeCardPrefs(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const ui = src.ui === 'in' ? 'in' : 'out';
  const fit = src.fit === 'cover' || src.fit === 'fit' ? 'cover' : 'contain';
  const out = {
    size: Math.min(560, Math.max(160, Number(src.size) || CARD_PREFS_DEFAULTS.size)),
    ratio: Math.min(200, Math.max(50, Number(src.ratio) || CARD_PREFS_DEFAULTS.ratio)),
    ui,
    fit,
    thumbTime: Math.min(180, Math.max(0, Number(src.thumbTime ?? src.time) || CARD_PREFS_DEFAULTS.thumbTime))
  };
  // Keep explicit history flag when present (do not invent one here).
  if (typeof src.history === 'boolean') out.history = src.history;
  return out;
}
async function readCardPrefsRaw(dirPath) {
  try {
    const buf = await lease.readWhole(cardPrefsPath(dirPath), 64 * 1024);
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}
async function readCardPrefsFile(dirPath) {
  const raw = await readCardPrefsRaw(dirPath);
  return raw ? normalizeCardPrefs(raw) : null;
}
async function writeCardPrefsFile(dirPath, prefs) {
  const existing = (await readCardPrefsRaw(dirPath)) || {};
  const merged = { ...existing, ...prefs };
  const next = normalizeCardPrefs(merged);
  await lease.writeAtomic(cardPrefsPath(dirPath), JSON.stringify(next, null, 2) + '\n');
  return next;
}
async function resolveHistoryEnabled(dirPath) {
  let cur = path.resolve(dirPath);
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const raw = await readCardPrefsRaw(cur);
    if (raw && typeof raw.history === 'boolean') {
      return { enabled: raw.history, from: cur };
    }
    const parent = path.dirname(cur);
    if (parent === cur || !allowed(parent)) break;
    cur = parent;
  }
  const excludes = readJson(FILES.exclude, []);
  if (excludes.some((folder) => samePath(dirPath, folder) || lease.hits(folder, dirPath))) {
    return { enabled: false, from: 'exclude' };
  }
  return { enabled: true, from: '' };
}
async function resolveCardPrefs(dirPath) {
  let cur = path.resolve(dirPath);
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const local = await readCardPrefsFile(cur);
    if (local) {
      return { ...local, source: samePath(cur, dirPath) ? 'file' : 'parent', from: cur };
    }
    const parent = path.dirname(cur);
    if (parent === cur || !allowed(parent)) break;
    cur = parent;
  }
  const times = readJson(FILES.thumbs, {});
  const found = Object.entries(times).find(([key]) => samePath(key, dirPath));
  if (found) {
    return { ...CARD_PREFS_DEFAULTS, thumbTime: Number(found[1]) || 1, source: 'legacy', from: '' };
  }
  return { ...CARD_PREFS_DEFAULTS, source: 'default', from: '' };
}
async function collectDirPaths(dirPath, out = []) {
  out.push(dirPath);
  let entries = [];
  try { entries = await readEntries(dirPath); } catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.' || entry.name === '..') continue;
    await collectDirPaths(path.join(dirPath, entry.name), out);
  }
  return out;
}

app.get('/api/card-prefs', async (req, res) => {
  const dirPath = needPath(req, res);
  if (!dirPath) return;
  try {
    res.json(await resolveCardPrefs(dirPath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.put('/api/card-prefs', async (req, res) => {
  const dirPath = req.body?.path;
  if (!dirPath) return res.status(400).json({ error: '缺少路径' });
  if (!allowed(dirPath)) return res.status(403).json({ error: '该路径不在白名单中' });
  try {
    const prefs = await writeCardPrefsFile(dirPath, req.body);
    res.json({ success: true, prefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/folder-history', async (req, res) => {
  const dirPath = needPath(req, res);
  if (!dirPath) return;
  try {
    const data = await resolveHistoryEnabled(dirPath);
    res.json({ enabled: data.enabled, from: data.from });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.put('/api/folder-history', async (req, res) => {
  const dirPath = req.body?.path;
  if (!dirPath) return res.status(400).json({ error: '缺少路径' });
  if (!allowed(dirPath)) return res.status(403).json({ error: '该路径不在白名单中' });
  const enabled = req.body?.enabled !== false;
  try {
    const prefs = await writeCardPrefsFile(dirPath, { history: enabled });
    res.json({ success: true, enabled: prefs.history !== false, prefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/card-prefs/apply', async (req, res) => {
  const dirPath = req.body?.path;
  if (!dirPath) return res.status(400).json({ error: '缺少路径' });
  if (!allowed(dirPath)) return res.status(403).json({ error: '该路径不在白名单中' });
  const prefs = normalizeCardPrefs(req.body);
  try {
    const dirs = await collectDirPaths(dirPath);
    for (const dir of dirs) await writeCardPrefsFile(dir, prefs);
    res.json({ success: true, count: dirs.length, prefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/thumb-time', async (req, res) => {
  const dirPath = needPath(req, res);
  if (!dirPath) return;
  const prefs = await resolveCardPrefs(dirPath);
  res.json({ time: prefs.thumbTime });
});
app.post('/api/thumb-time', async (req, res) => {
  const dirPath = req.body?.path;
  if (!dirPath || req.body.time == null) return res.status(400).json({ error: '参数不完整' });
  if (!allowed(dirPath)) return res.status(403).json({ error: '该路径不在白名单中' });
  try {
    const current = (await readCardPrefsFile(dirPath)) || { ...CARD_PREFS_DEFAULTS };
    const prefs = await writeCardPrefsFile(dirPath, { ...current, thumbTime: Number(req.body.time) });
    res.json({ success: true, time: prefs.thumbTime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notes', async (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  try {
    const buf = await lease.readWhole(notePath(filePath), 2 * 1024 * 1024);
    res.json({ text: buf.toString('utf8') });
  } catch {
    res.json({ text: '' });
  }
});
app.put('/api/notes', async (req, res) => {
  const filePath = req.body?.path;
  if (!filePath) return res.status(400).json({ error: '缺少路径' });
  if (!allowed(filePath)) return res.status(403).json({ error: '该路径不在白名单中' });
  const text = String(req.body.text || '');
  try {
    if (!text.trim()) await lease.removeFile(notePath(filePath));
    else await lease.writeAtomic(notePath(filePath), text);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clips', (req, res) => {
  const filePath = req.query.path || '';
  const rows = readJson(FILES.clips, []);
  res.json(filePath ? rows.filter((clip) => samePath(clip.videoPath, filePath)) : rows);
});
app.get('/api/clips-counts', (_req, res) => {
  const counts = {};
  for (const clip of readJson(FILES.clips, [])) counts[clip.videoPath] = (counts[clip.videoPath] || 0) + 1;
  res.json(counts);
});
app.post('/api/clips', (req, res) => {
  const { path: filePath, name, startTime, endTime } = req.body || {};
  if (!filePath || startTime == null || endTime == null) return res.status(400).json({ error: '参数不完整' });
  if (!allowed(filePath)) return res.status(403).json({ error: '该路径不在白名单中' });
  const clip = {
    id: randomUUID(),
    videoPath: filePath,
    name: String(name || '').trim() || '片段',
    startTime: Number(startTime),
    endTime: Number(endTime),
    createdAt: new Date().toISOString()
  };
  const rows = readJson(FILES.clips, []);
  rows.push(clip);
  writeJson(FILES.clips, rows);
  res.json(clip);
});
app.patch('/api/clips/:id', (req, res) => {
  const rows = readJson(FILES.clips, []);
  const clip = rows.find((item) => item.id === req.params.id);
  if (!clip) return res.status(404).json({ error: '未找到' });
  if (req.body.name != null) clip.name = req.body.name;
  if (req.body.startTime != null) clip.startTime = Number(req.body.startTime);
  if (req.body.endTime != null) clip.endTime = Number(req.body.endTime);
  writeJson(FILES.clips, rows);
  res.json(clip);
});
app.delete('/api/clips/:id', (req, res) => {
  writeJson(FILES.clips, readJson(FILES.clips, []).filter((clip) => clip.id !== req.params.id));
  res.json({ success: true });
});
app.get('/api/clips/:id/export', async (req, res) => {
  const clip = readJson(FILES.clips, []).find((item) => item.id === req.params.id);
  if (!clip) return res.status(404).json({ error: '未找到' });
  if (!allowed(clip.videoPath)) return res.status(403).json({ error: '该路径不在白名单中' });
  const dur = Math.max(0.1, clip.endTime - clip.startTime).toFixed(3);
  const safe = String(clip.name || 'clip').replace(/[^\w\u4e00-\u9fff-]+/g, '_');
  const output = path.join(TRIMMED, safe + '_' + Date.now() + '.mp4');
  try {
    try {
      await runCommand('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', String(clip.startTime), '-i', clip.videoPath,
        '-t', dur, '-c', 'copy', '-avoid_negative_ts', 'make_zero', output
      ], [clip.videoPath], 0);
    } catch {
      await runCommand('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', String(clip.startTime), '-i', clip.videoPath,
        '-t', dur, '-c:v', 'libx264', '-c:a', 'aac', output
      ], [clip.videoPath], 0);
    }
    await sendBytes(output, req, res, 'video/mp4', {
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safe + '.mp4')}`
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: '导出失败: ' + err.message });
  } finally {
    setTimeout(() => { fs.unlink(output, () => {}); }, 4000);
  }
});

app.post('/api/file/delete', async (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  try {
    await lease.removeFile(filePath);
    forgetPath(filePath, false);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/file/rename', async (req, res) => {
  const filePath = req.body?.path;
  const name = validName(req.body?.name);
  if (!filePath || !name) return res.status(400).json({ error: '参数不完整或名称不合法' });
  if (!allowed(filePath)) return res.status(403).json({ error: '该路径不在白名单中' });
  const dest = path.join(path.dirname(filePath), name);
  if (fs.existsSync(dest) && !samePath(dest, filePath)) return res.status(409).json({ error: '已有同名文件' });
  try {
    await lease.movePath(filePath, dest);
    remapRecords(filePath, dest, false);
    res.json({ success: true, path: dest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/file/move', async (req, res) => {
  const destDir = req.body?.dest;
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
  if (!destDir || !paths.length) return res.status(400).json({ error: '参数不完整' });
  if (!allowed(destDir) || paths.some((item) => !allowed(item))) return res.status(403).json({ error: '该路径不在白名单中' });
  if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) return res.status(400).json({ error: '目标文件夹不存在' });
  const moved = [];
  const errors = [];
  for (const filePath of paths) {
    const dest = path.join(destDir, path.basename(filePath));
    if (samePath(path.dirname(filePath), destDir)) {
      moved.push({ oldPath: filePath, newPath: filePath });
      continue;
    }
    if (fs.existsSync(dest)) {
      errors.push({ path: filePath, error: '目标已有同名文件' });
      continue;
    }
    try {
      await lease.movePath(filePath, dest);
      remapRecords(filePath, dest, false);
      moved.push({ oldPath: filePath, newPath: dest });
    } catch (err) {
      errors.push({ path: filePath, error: err.message });
    }
  }
  res.json({ success: errors.length === 0, moved, errors });
});

app.post('/api/folder/create', async (req, res) => {
  const parent = req.body?.parent || req.body?.path;
  const name = validName(req.body?.name);
  if (!parent || !name) return res.status(400).json({ error: '参数不完整或名称不合法' });
  if (!allowed(parent)) return res.status(403).json({ error: '该路径不在白名单中' });
  const dest = path.join(parent, name);
  try {
    await lease.mkdir(dest);
    res.json({ success: true, path: dest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/folder/rename', async (req, res) => {
  const dirPath = req.body?.path;
  const name = validName(req.body?.name);
  if (!dirPath || !name) return res.status(400).json({ error: '参数不完整或名称不合法' });
  if (!allowed(dirPath)) return res.status(403).json({ error: '该路径不在白名单中' });
  const dest = path.join(path.dirname(dirPath), name);
  if (fs.existsSync(dest) && !samePath(dest, dirPath)) return res.status(409).json({ error: '已有同名文件夹' });
  try {
    const isDir = fs.statSync(dirPath).isDirectory();
    await lease.movePath(dirPath, dest);
    remapRecords(dirPath, dest, isDir);
    res.json({ success: true, path: dest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/folder/delete', async (req, res) => {
  const dirPath = needPath(req, res);
  if (!dirPath) return;
  try {
    await lease.removeDir(dirPath);
    forgetPath(dirPath, true);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/folder/move', async (req, res) => {
  const dirPath = req.body?.path;
  const destDir = req.body?.dest;
  if (!dirPath || !destDir) return res.status(400).json({ error: '参数不完整' });
  if (!allowed(dirPath) || !allowed(destDir)) return res.status(403).json({ error: '该路径不在白名单中' });
  if (samePath(destDir, dirPath) || lease.hits(dirPath, destDir)) return res.status(400).json({ error: '不能移动到自身或子文件夹' });
  const dest = path.join(destDir, path.basename(dirPath));
  if (fs.existsSync(dest)) return res.status(409).json({ error: '目标已有同名文件夹' });
  try {
    await lease.movePath(dirPath, dest);
    remapRecords(dirPath, dest, true);
    res.json({ success: true, path: dest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, INCOMING),
    filename: (_req, file, cb) => cb(null, randomUUID() + path.extname(file.originalname || ''))
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }
});
function originalName(file) {
  const raw = file.originalname || 'upload';
  let name = raw;
  try { name = Buffer.from(raw, 'latin1').toString('utf8'); } catch { /* keep */ }
  if (name.includes('\uFFFD')) name = raw;
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 180) || 'upload';
}
app.post('/api/upload', (req, res) => {
  diskUpload.array('files', 40)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const folder = req.body?.folderPath;
    if (!folder) return res.status(400).json({ error: '缺少目标文件夹' });
    if (!allowed(folder)) return res.status(403).json({ error: '该路径不在白名单中' });
    try { await lease.mkdir(folder); } catch { /* exists */ }
    const moved = [];
    for (const file of req.files || []) {
      const dest = path.join(folder, originalName(file));
      try {
        await lease.movePath(file.path, dest);
        moved.push({ name: path.basename(dest), path: dest, size: file.size });
      } catch (error) {
        try { fs.unlinkSync(file.path); } catch { /* temp */ }
        moved.push({ name: file.originalname, error: error.message });
      }
    }
    res.json({ success: true, files: moved });
  });
});

function firstExisting(candidates) {
  return candidates.find((item) => item && fs.existsSync(item)) || null;
}
function playerLaunch(player, filePath) {
  const kind = String(player || 'mpv').toLowerCase();
  if (kind === 'mpv') {
    const bin = process.env.MPV_PATH || firstExisting([
      'C:\\Program Files\\mpv\\mpv.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'mpv', 'mpv.exe')
    ]) || 'mpv';
    return { bin, args: ['--force-window=immediate', '--', filePath], label: 'MPV' };
  }
  if (kind === 'vlc') {
    const bin = process.env.VLC_PATH || firstExisting([
      'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
      'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'
    ]) || 'vlc';
    return { bin, args: ['--', filePath], label: 'VLC' };
  }
  if (kind === 'potplayer' || kind === 'pot') {
    const bin = process.env.POTPLAYER_PATH || firstExisting([
      'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe',
      'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini.exe'
    ]) || 'PotPlayerMini64.exe';
    return { bin, args: [filePath], label: 'PotPlayer' };
  }
  return null;
}
app.post('/api/open-player', (req, res) => {
  const filePath = req.body?.path;
  if (!filePath) return res.status(400).json({ error: '缺少路径' });
  if (!allowed(filePath)) return res.status(403).json({ error: '该路径不在白名单中' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  const launch = playerLaunch(req.body?.player, filePath);
  if (!launch) return res.status(400).json({ error: '未知播放器' });
  const child = spawn(launch.bin, launch.args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.once('error', (err) => {
    if (!res.headersSent) res.status(500).json({ error: '无法启动 ' + launch.label + ': ' + err.message });
  });
  child.unref();
  setTimeout(() => { if (!res.headersSent) res.json({ ok: true, player: launch.label }); }, 200);
});

app.get('/api/probe', (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  execFile('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath
  ], { timeout: 8000 }, (err, stdout) => {
    const duration = err ? 0 : Number(stdout.trim()) || 0;
    let size = 0;
    try { size = fs.statSync(filePath).size; } catch { /* missing */ }
    res.json({
      duration,
      size,
      presets: Object.entries(PRESETS).map(([key, preset]) => ({
        key,
        name: preset.name,
        estimatedSize: preset.video ? Math.round((preset.video + preset.audio) * 1000 / 8 * duration) : size
      }))
    });
  });
});

app.get('/api/file-info', async (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  let stat;
  try { stat = await fsp.stat(filePath); }
  catch (err) { return res.status(404).json({ error: err.code === 'ENOENT' ? '文件不存在' : err.message }); }
  if (!stat.isFile()) return res.status(400).json({ error: '不是文件' });
  const ext = path.extname(filePath).toLowerCase();
  const info = {
    name: path.basename(filePath),
    path: filePath,
    size: stat.size,
    mtime: stat.mtimeMs,
    birthtime: stat.birthtimeMs || stat.mtimeMs,
    ext,
    type: mediaKind(path.basename(filePath))
  };
  if (VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext) || IMAGE_EXTS.has(ext)) {
    try {
      const probed = await runCommand('ffprobe', [
        '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath
      ], [filePath], 12000);
      const data = JSON.parse(probed.stdout || '{}');
      const format = data.format || {};
      const streams = Array.isArray(data.streams) ? data.streams : [];
      const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1) || streams.find((s) => s.codec_type === 'video');
      const audio = streams.find((s) => s.codec_type === 'audio');
      info.duration = Number(format.duration) || (video ? Number(video.duration) : 0) || 0;
      info.bitrate = Number(format.bit_rate) || 0;
      info.formatName = String(format.format_long_name || format.format_name || '').trim();
      info.container = String(format.format_name || '').trim();
      if (video) {
        info.width = Number(video.width) || 0;
        info.height = Number(video.height) || 0;
        info.videoCodec = String(video.codec_long_name || video.codec_name || '').trim();
        info.videoCodecTag = String(video.codec_name || '').trim();
        info.pixFmt = String(video.pix_fmt || '').trim();
        const fpsRaw = video.avg_frame_rate || video.r_frame_rate || '';
        if (typeof fpsRaw === 'string' && fpsRaw.includes('/')) {
          const [a, b] = fpsRaw.split('/').map(Number);
          info.fps = b ? Math.round((a / b) * 1000) / 1000 : 0;
        } else info.fps = Number(fpsRaw) || 0;
      }
      if (audio) {
        info.audioCodec = String(audio.codec_long_name || audio.codec_name || '').trim();
        info.audioCodecTag = String(audio.codec_name || '').trim();
        info.sampleRate = Number(audio.sample_rate) || 0;
        info.channels = Number(audio.channels) || 0;
        info.channelLayout = String(audio.channel_layout || '').trim();
        info.audioBitrate = Number(audio.bit_rate) || 0;
      }
      info.streamCount = streams.length;
    } catch {
      /* ffprobe optional — basic stat still returned */
    }
  }
  res.json(info);
});

app.get('/api/convert/file', async (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  const quality = PRESETS[req.query.quality] ? req.query.quality : '720p';
  const preset = PRESETS[quality];
  const send = sse(res);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const output = quality === 'copy'
    ? path.join(path.dirname(filePath), base + '.mp4')
    : path.join(path.dirname(filePath), base + '.' + quality + '.mp4');
  let duration = 0;
  try {
    const probed = await runCommand('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath
    ], [filePath], 8000);
    duration = Number(probed.stdout.trim()) || 0;
  } catch { /* progress stays coarse */ }
  const args = ['-y', '-hide_banner', '-i', filePath, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn'];
  if (quality === 'copy') args.push('-c', 'copy');
  else args.push('-vf', `scale=-2:${preset.height}`, '-c:v', 'libx264', '-b:v', preset.video + 'k', '-c:a', 'aac', '-b:a', preset.audio + 'k');
  args.push('-movflags', '+faststart', '-progress', 'pipe:1', output);
  send({
    type: 'start',
    file: path.basename(filePath),
    output: path.basename(output),
    command: formatCmd('ffmpeg', args.filter((item) => item !== '-progress' && item !== 'pipe:1')),
    overall: 0
  });
  const child = spawnTracked('ffmpeg', args, [filePath, output]);
  const stop = () => lease.killProcess(child);
  req.on('close', stop);
  child.stdout.on('data', (chunk) => {
    const match = /out_time_ms=(\d+)/.exec(chunk.toString());
    if (match && duration) {
      const percent = Math.min(99, Math.round((Number(match[1]) / 1000000) / duration * 100));
      send({ type: 'progress', percent, overall: percent, name: path.basename(filePath) });
    }
  });
  child.once('close', (code) => {
    if (code === 0 && fs.existsSync(output)) send({ type: 'done', output, percent: 100, overall: 100 });
    else {
      try { fs.unlinkSync(output); } catch { /* partial */ }
      send({ type: 'error', msg: '转换失败' });
    }
    res.end();
  });
  child.once('error', (err) => { send({ type: 'error', msg: err.message }); res.end(); });
});

function uniqueAudioOutput(dir, base, quality, ext) {
  let name = `${base}.${quality}${ext}`;
  let full = path.join(dir, name);
  let n = 2;
  while (fs.existsSync(full)) {
    name = `${base}.${quality}-${n}${ext}`;
    full = path.join(dir, name);
    n += 1;
  }
  return full;
}

app.get('/api/convert/audio', async (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).json({ error: '文件不存在' });
  }
  const quality = AUDIO_PRESETS[req.query.quality] ? req.query.quality : '192k';
  const preset = AUDIO_PRESETS[quality];
  const send = sse(res);
  const ext = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) {
    send({ type: 'error', msg: '不是可压缩的音视频文件' });
    return res.end();
  }
  const base = path.basename(filePath, path.extname(filePath));
  const output = uniqueAudioOutput(path.dirname(filePath), base, quality, preset.ext);
  let duration = 0;
  try {
    const probed = await runCommand('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath
    ], [filePath], 8000);
    duration = Number(probed.stdout.trim()) || 0;
  } catch { /* progress stays coarse */ }

  // Prefer sidecar / embedded cover so the compressed MP3 keeps artwork.
  let coverSrc = null;
  const manualCover = coverFile(filePath);
  if (fs.existsSync(manualCover) && fs.statSync(manualCover).size > 200) coverSrc = manualCover;
  else {
    try { coverSrc = await ensureAudioCover(filePath); } catch { coverSrc = null; }
  }

  const tracked = [filePath, output];
  const args = ['-y', '-hide_banner', '-i', filePath];
  if (coverSrc) {
    args.push('-i', coverSrc);
    tracked.push(coverSrc);
  }
  args.push('-map', '0:a:0?');
  if (coverSrc) {
    args.push(
      '-map', '1:0',
      '-c:v', 'mjpeg',
      '-disposition:v:0', 'attached_pic',
      '-metadata:s:v', 'title=Album cover',
      '-metadata:s:v', 'comment=Cover (front)'
    );
  }
  args.push(
    '-c:a', 'libmp3lame', '-b:a', preset.bitrate + 'k',
    '-id3v2_version', '3',
    '-progress', 'pipe:1', output
  );
  send({
    type: 'start',
    file: path.basename(filePath),
    output: path.basename(output),
    quality,
    command: formatCmd('ffmpeg', args.filter((item) => item !== '-progress' && item !== 'pipe:1')),
    overall: 0
  });
  const child = spawnTracked('ffmpeg', args, tracked);
  const stop = () => lease.killProcess(child);
  req.on('close', stop);
  child.stdout.on('data', (chunk) => {
    const match = /out_time_ms=(\d+)/.exec(chunk.toString());
    if (match && duration) {
      const percent = Math.min(99, Math.round((Number(match[1]) / 1000000) / duration * 100));
      send({ type: 'progress', percent, overall: percent, name: path.basename(filePath) });
    }
  });
  child.once('close', (code) => {
    if (code === 0 && fs.existsSync(output)) {
      // Keep manual sidecar cover for the new file (thumbnail API prefers it).
      try {
        if (coverSrc && fs.existsSync(coverSrc)) {
          fs.copyFileSync(coverSrc, coverFile(output));
        } else if (fs.existsSync(manualCover)) {
          fs.copyFileSync(manualCover, coverFile(output));
        }
      } catch { /* cover copy optional */ }
      let size = 0;
      try { size = fs.statSync(output).size; } catch { /* ok */ }
      send({ type: 'done', output, size, quality, percent: 100, overall: 100 });
    } else {
      try { fs.unlinkSync(output); } catch { /* partial */ }
      send({ type: 'error', msg: '音频压缩失败' });
    }
    res.end();
  });
  child.once('error', (err) => { send({ type: 'error', msg: err.message }); res.end(); });
});

function listChildFolders(dirPath) {
  let entries = [];
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: path.join(dirPath, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

app.get('/api/convert/children', (req, res) => {
  const dirPath = needPath(req, res);
  if (!dirPath) return;
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return res.status(400).json({ error: '找不到这个文件夹' });
  }
  res.json(listChildFolders(dirPath));
});

app.get('/api/convert/search', (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  const basePath = req.query.basePath || req.query.path;
  const type = req.query.type || 'file';
  if (!query || !basePath) return res.json([]);
  if (!allowed(basePath)) return res.status(403).json({ error: '该路径不在白名单中' });
  const results = [];
  const walk = (dir) => {
    if (results.length >= 40) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= 40) return;
      const full = path.join(dir, entry.name);
      const hit = entry.name.toLowerCase().includes(query);
      if (type === 'folder' && entry.isDirectory() && hit) {
        const children = listChildFolders(full).slice(0, 80);
        results.push({ name: entry.name, path: full, children, hasChildren: children.length > 0 });
      }
      if (type === 'file' && entry.isFile() && VIDEO_EXTS.has(path.extname(entry.name).toLowerCase()) && hit) results.push({ name: entry.name, path: full });
      if (type === 'subtitle' && entry.isFile() && SUB_EXTS.has(path.extname(entry.name).toLowerCase()) && hit) results.push({ name: entry.name, path: full });
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(basePath);
  res.json(results);
});

function handbrakeArgs(input, output, encoder) {
  return ['-i', input, '-o', output, '-e', encoder || 'x265', '-q', '26', '--maxHeight', '1080', '--maxWidth', '1920', '-r', '30', '--vfr', '-a', '1', '-E', 'avc_aac', '-B', '160', '--mixdown', 'stereo'];
}

app.get('/api/convert/preview', (req, res) => {
  const mode = String(req.query.mode || 'single');
  const encoder = req.query.encoder === 'x264' ? 'x264' : 'x265';
  if (mode === 'single') {
    const filePath = needPath(req, res);
    if (!filePath) return;
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(400).json({ error: '找不到这个视频文件' });
    }
    const { isMp4, output } = convertOutputFor(filePath);
    const args = handbrakeArgs(filePath, output, encoder);
    return res.json({
      mode,
      path: filePath,
      output,
      encoder,
      isMp4,
      replace: isMp4,
      total: 1,
      files: [path.basename(filePath)],
      command: formatCmd('HandBrakeCLI', args),
      note: isMp4
        ? '这是 MP4→MP4 修复转换：先写出 .fixed.mp4，成功后再替换原文件。'
        : '转换完成后会在同目录生成同名 .mp4。'
    });
  }
  if (mode === 'folder') {
    const dirPath = needPath(req, res);
    if (!dirPath) return;
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return res.status(400).json({ error: '找不到这个文件夹' });
    }
    let videos = [];
    try { videos = listVideosUnder(dirPath); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    const sample = videos[0];
    const sampleOut = sample ? convertOutputFor(sample).output : '';
    const sampleArgs = sample ? handbrakeArgs(sample, sampleOut, encoder) : handbrakeArgs('<input>', '<output>', encoder);
    return res.json({
      mode,
      path: dirPath,
      encoder,
      total: videos.length,
      files: videos.map((item) => path.relative(dirPath, item) || path.basename(item)).slice(0, 40),
      more: Math.max(0, videos.length - 40),
      command: formatCmd('HandBrakeCLI', sampleArgs),
      note: '会递归转换文件夹内全部视频（含 MP4→MP4 修复）。MP4 成功后替换原文件；其他格式生成同名 .mp4。'
    });
  }
  if (mode === 'batch') {
    const dirPath = needPath(req, res);
    if (!dirPath) return;
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return res.status(400).json({ error: '找不到这个文件夹' });
    }
    const limit = Number(req.query.limit) || 0;
    const done = new Set(fs.existsSync(FILES.convertLog) ? fs.readFileSync(FILES.convertLog, 'utf8').split(/\r?\n/).filter(Boolean) : []);
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (path.extname(entry.name).toLowerCase() === '.mkv') found.push(full);
      }
    };
    try { walk(dirPath); } catch (err) { return res.status(400).json({ error: err.message }); }
    const pending = found.filter((file) => !done.has(path.relative(dirPath, file)));
    const queue = limit > 0 ? pending.slice(0, limit) : pending;
    const sample = queue[0];
    const sampleOut = sample ? sample.replace(/\.mkv$/i, '.mp4') : '<output.mp4>';
    const sampleArgs = [
      '-i', sample || '<input.mkv>', '-o', sampleOut, '-e', encoder,
      '--maxHeight', '1080', '--maxWidth', '1920', '-r', '30', '--vfr',
      '--audio-lang-list', 'cmn,chi,eng', '--subtitle-lang-list', 'chi,zho'
    ];
    return res.json({
      mode,
      path: dirPath,
      encoder,
      total: queue.length,
      skipped: found.length - pending.length,
      files: queue.map((item) => path.relative(dirPath, item) || path.basename(item)).slice(0, 40),
      more: Math.max(0, queue.length - 40),
      command: formatCmd('HandBrakeCLI', sampleArgs),
      note: '只处理尚未记录过的 MKV；已存在同名 MP4 会跳过。'
    });
  }
  return res.status(400).json({ error: '未知预览类型' });
});

app.get('/api/convert/extract-sub', (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  const send = sse(res);
  const output = path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)) + '.zh.srt');
  const args = ['-y', '-i', filePath, '-map', '0:s:0', output];
  const child = spawnTracked('ffmpeg', args, [filePath, output]);
  req.on('close', () => lease.killProcess(child));
  send({ type: 'start', file: path.basename(filePath), output: path.basename(output), command: formatCmd('ffmpeg', args), overall: 0 });
  child.once('close', (code) => {
    if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) send({ type: 'done', output, overall: 100 });
    else {
      try { fs.unlinkSync(output); } catch { /* none */ }
      send({ type: 'error', msg: '没有可提取的软字幕' });
    }
    res.end();
  });
  child.once('error', (err) => { send({ type: 'error', msg: err.message }); res.end(); });
});

app.get('/api/convert/merge-sub', async (req, res) => {
  const video = req.query.video;
  const sub = req.query.sub;
  if (!video || !sub) return res.status(400).json({ error: '缺少视频或字幕' });
  if (!allowed(video) || !allowed(sub)) return res.status(403).json({ error: '该路径不在白名单中' });
  const send = sse(res);
  const tmp = path.join(path.dirname(video), path.basename(video, path.extname(video)) + '.subbed.mp4');
  const args = [
    '-y', '-i', video, '-i', sub, '-c', 'copy', '-c:s', 'mov_text',
    '-metadata:s:s:0', 'language=chi', tmp
  ];
  send({ type: 'start', file: path.basename(video), command: formatCmd('ffmpeg', args), overall: 0 });
  try {
    await runCommand('ffmpeg', args, [video, sub, tmp], 0);
    const backup = video + '.tv2bak';
    await lease.movePath(video, backup);
    try {
      await lease.movePath(tmp, video);
      await lease.removeFile(backup);
    } catch (err) {
      if (!fs.existsSync(video) && fs.existsSync(backup)) await lease.movePath(backup, video);
      throw err;
    }
    send({ type: 'done', output: video, overall: 100 });
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* partial */ }
    send({ type: 'error', msg: err.message });
  }
  res.end();
});

app.get('/api/convert/single', (req, res) => {
  const filePath = needPath(req, res);
  if (!filePath) return;
  const encoder = req.query.encoder === 'x264' ? 'x264' : 'x265';
  const send = sse(res);
  const { isMp4, output } = convertOutputFor(filePath);
  const args = handbrakeArgs(filePath, output, encoder);
  send({
    type: 'start',
    file: path.basename(filePath),
    path: filePath,
    output,
    encoder,
    isMp4,
    replace: isMp4,
    command: formatCmd('HandBrakeCLI', args),
    index: 1,
    total: 1,
    overall: 0
  });
  const child = spawnTracked('HandBrakeCLI', args, [filePath, output]);
  req.on('close', () => lease.killProcess(child));
  const onData = (chunk) => {
    const match = /(\d+\.?\d*)\s*%/.exec(chunk.toString());
    if (match) {
      const percent = Number(match[1]);
      send({ type: 'progress', percent, overall: percent, index: 1, total: 1, name: path.basename(filePath) });
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('close', async (code) => {
    if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) {
      if (isMp4) {
        const backup = filePath + '.tv2bak';
        try {
          await lease.movePath(filePath, backup);
          await lease.movePath(output, filePath);
          await lease.removeFile(backup);
        } catch (err) {
          send({ type: 'error', msg: '转换完成但替换失败: ' + err.message });
          return res.end();
        }
      }
      send({ type: 'done', output: isMp4 ? filePath : output, overall: 100 });
    } else {
      try { fs.unlinkSync(output); } catch { /* none */ }
      send({ type: 'error', msg: '转换失败，请确认已安装 HandBrakeCLI' });
    }
    res.end();
  });
  child.once('error', (err) => { send({ type: 'error', msg: err.message }); res.end(); });
});

app.get('/api/convert/folder', (req, res) => {
  const dirPath = needPath(req, res);
  if (!dirPath) return;
  const encoder = req.query.encoder === 'x264' ? 'x264' : 'x265';
  const send = sse(res);
  let videos = [];
  try { videos = listVideosUnder(dirPath); } catch (err) { send({ type: 'error', msg: err.message }); return res.end(); }
  if (!videos.length) { send({ type: 'error', msg: '文件夹里没有视频' }); return res.end(); }
  const sample = videos[0];
  const sampleOut = convertOutputFor(sample).output;
  send({
    type: 'start',
    total: videos.length,
    path: dirPath,
    encoder,
    command: formatCmd('HandBrakeCLI', handbrakeArgs(sample, sampleOut, encoder)),
    overall: 0
  });
  let index = 0;
  let ok = 0;
  let fail = 0;
  const next = () => {
    if (index >= videos.length) {
      send({ type: 'done', total: videos.length, ok, fail, overall: 100 });
      return res.end();
    }
    const filePath = videos[index];
    const { isMp4, output } = convertOutputFor(filePath);
    const args = handbrakeArgs(filePath, output, encoder);
    send({
      type: 'file',
      index: index + 1,
      total: videos.length,
      name: path.basename(filePath),
      path: filePath,
      command: formatCmd('HandBrakeCLI', args),
      overall: Math.round((index / videos.length) * 100)
    });
    const child = spawnTracked('HandBrakeCLI', args, [filePath, output]);
    const onData = (chunk) => {
      const match = /(\d+\.?\d*)\s*%/.exec(chunk.toString());
      if (match) {
        const percent = Number(match[1]);
        const overall = Math.min(99, Math.round(((index + percent / 100) / videos.length) * 100));
        send({ type: 'progress', percent, overall, index: index + 1, total: videos.length, name: path.basename(filePath) });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('close', async (code) => {
      if (code === 0 && fs.existsSync(output)) {
        if (isMp4) {
          const backup = filePath + '.tv2bak';
          try {
            await lease.movePath(filePath, backup);
            await lease.movePath(output, filePath);
            await lease.removeFile(backup);
          } catch { /* original stays */ }
        }
        ok += 1;
        send({ type: 'file-done', index: index + 1, total: videos.length, name: path.basename(filePath), ok, fail });
      } else {
        try { fs.unlinkSync(output); } catch { /* none */ }
        fail += 1;
        send({ type: 'file-error', index: index + 1, total: videos.length, name: path.basename(filePath), ok, fail, msg: '转换失败' });
      }
      index += 1;
      next();
    });
    child.once('error', () => {
      fail += 1;
      send({ type: 'file-error', index: index + 1, total: videos.length, name: path.basename(filePath), ok, fail, msg: '无法启动 HandBrakeCLI' });
      index += 1;
      next();
    });
  };
  next();
});

app.get('/api/convert/batch', (req, res) => {
  const dirPath = needPath(req, res);
  if (!dirPath) return;
  const encoder = req.query.encoder === 'x264' ? 'x264' : 'x265';
  const limit = Number(req.query.limit) || 0;
  const send = sse(res);
  const done = new Set(fs.existsSync(FILES.convertLog) ? fs.readFileSync(FILES.convertLog, 'utf8').split(/\r?\n/).filter(Boolean) : []);
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (path.extname(entry.name).toLowerCase() === '.mkv') found.push(full);
    }
  };
  try { walk(dirPath); } catch (err) { send({ type: 'error', msg: err.message }); return res.end(); }
  const pending = found.filter((file) => !done.has(path.relative(dirPath, file)));
  const queue = limit > 0 ? pending.slice(0, limit) : pending;
  if (!queue.length) { send({ type: 'done', total: 0, skipped: found.length, overall: 100 }); return res.end(); }
  const sample = queue[0];
  const sampleArgs = [
    '-i', sample, '-o', sample.replace(/\.mkv$/i, '.mp4'), '-e', encoder,
    '--maxHeight', '1080', '--maxWidth', '1920', '-r', '30', '--vfr',
    '--audio-lang-list', 'cmn,chi,eng', '--subtitle-lang-list', 'chi,zho'
  ];
  send({
    type: 'start',
    total: queue.length,
    skipped: found.length - pending.length,
    path: dirPath,
    command: formatCmd('HandBrakeCLI', sampleArgs),
    overall: 0
  });
  let index = 0;
  let ok = 0;
  let fail = 0;
  const next = () => {
    if (index >= queue.length) {
      send({ type: 'done', total: queue.length, ok, fail, overall: 100 });
      return res.end();
    }
    const filePath = queue[index];
    const rel = path.relative(dirPath, filePath);
    const output = filePath.replace(/\.mkv$/i, '.mp4');
    if (fs.existsSync(output) && fs.statSync(output).size > 0) {
      fs.appendFileSync(FILES.convertLog, rel + '\n');
      ok += 1;
      send({ type: 'file-skip', index: index + 1, total: queue.length, name: path.basename(filePath), ok, fail });
      index += 1;
      return next();
    }
    const args = [
      '-i', filePath, '-o', output, '-e', encoder, '--maxHeight', '1080', '--maxWidth', '1920',
      '-r', '30', '--vfr', '--audio-lang-list', 'cmn,chi,eng', '--subtitle-lang-list', 'chi,zho'
    ];
    send({
      type: 'file',
      index: index + 1,
      total: queue.length,
      name: path.basename(filePath),
      command: formatCmd('HandBrakeCLI', args),
      overall: Math.round((index / queue.length) * 100)
    });
    const child = spawnTracked('HandBrakeCLI', args, [filePath, output]);
    const onData = (chunk) => {
      const match = /(\d+\.?\d*)\s*%/.exec(chunk.toString());
      if (match) {
        const percent = Number(match[1]);
        const overall = Math.min(99, Math.round(((index + percent / 100) / queue.length) * 100));
        send({ type: 'progress', percent, overall, index: index + 1, total: queue.length, name: path.basename(filePath) });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('close', (code) => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) {
        fs.appendFileSync(FILES.convertLog, rel + '\n');
        ok += 1;
        send({ type: 'file-done', index: index + 1, total: queue.length, name: path.basename(filePath), ok, fail });
      } else {
        try { fs.unlinkSync(output); } catch { /* none */ }
        fail += 1;
        send({ type: 'file-error', index: index + 1, total: queue.length, name: path.basename(filePath), ok, fail, msg: '转换失败' });
      }
      index += 1;
      next();
    });
  };
  next();
});

app.get('/api/categories', (_req, res) => res.json(readJson(FILES.cats, [])));
app.post('/api/categories', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '请输入分类名称' });
  const cats = readJson(FILES.cats, []);
  const cat = { id: randomUUID(), name, parentId: req.body?.parentId || null, createdAt: new Date().toISOString() };
  cats.push(cat);
  writeJson(FILES.cats, cats);
  res.json(cat);
});
app.patch('/api/categories/:id', (req, res) => {
  const cats = readJson(FILES.cats, []);
  const cat = cats.find((item) => item.id === req.params.id);
  if (!cat) return res.status(404).json({ error: '未找到' });
  if (req.body.name != null) cat.name = String(req.body.name).trim() || cat.name;
  if (req.body.parentId !== undefined) cat.parentId = req.body.parentId || null;
  writeJson(FILES.cats, cats);
  res.json(cat);
});
app.delete('/api/categories/:id', (req, res) => {
  let cats = readJson(FILES.cats, []);
  const drop = new Set(descendants(cats, req.params.id));
  const tricks = readJson(FILES.tricks, []);
  let changed = false;
  for (const trick of tricks) {
    if (drop.has(trick.category)) { trick.category = null; changed = true; }
  }
  if (changed) writeJson(FILES.tricks, tricks);
  cats = cats.filter((cat) => !drop.has(cat.id));
  writeJson(FILES.cats, cats);
  res.json({ success: true });
});

const trickUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TRICK_VIDEOS),
    filename: (_req, file, cb) => cb(null, randomUUID() + path.extname(file.originalname || '').toLowerCase())
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});
app.get('/api/tricks', (req, res) => {
  let tricks = readJson(FILES.tricks, []);
  if (req.query.category) {
    const ids = new Set(descendants(readJson(FILES.cats, []), req.query.category));
    tricks = tricks.filter((trick) => ids.has(trick.category));
  }
  tricks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(tricks);
});
app.post('/api/tricks', trickUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    const ext = path.extname(req.file.filename).toLowerCase();
    const mediaType = ext === '.gif' ? 'gif' : 'video';
    let thumbnail = null;
    if (mediaType === 'video') {
      try {
        const thumb = await ensureThumb(req.file.path, 1);
        const publicName = req.file.filename.replace(ext, '.jpg');
        fs.copyFileSync(thumb, path.join(THUMBS, publicName));
        thumbnail = '/uploads/thumbs/' + publicName;
      } catch { thumbnail = null; }
    }
    const trick = {
      id: randomUUID(),
      name: String(req.body?.name || '').trim() || FUNNY[Math.floor(Math.random() * FUNNY.length)],
      category: req.body?.category || null,
      mediaType,
      videoPath: '/uploads/videos/' + req.file.filename,
      fileSize: req.file.size,
      thumbnail,
      clips: [],
      notes: String(req.body?.notes || '').trim(),
      originalName: originalName(req.file),
      createdAt: new Date().toISOString()
    };
    const tricks = readJson(FILES.tricks, []);
    tricks.push(trick);
    writeJson(FILES.tricks, tricks);
    res.json(trick);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.patch('/api/tricks/:id', (req, res) => {
  const tricks = readJson(FILES.tricks, []);
  const trick = tricks.find((item) => item.id === req.params.id);
  if (!trick) return res.status(404).json({ error: '未找到' });
  if (req.body.name != null) trick.name = req.body.name;
  if (req.body.category !== undefined) trick.category = req.body.category || null;
  if (req.body.notes != null) trick.notes = req.body.notes;
  writeJson(FILES.tricks, tricks);
  res.json(trick);
});
app.post('/api/tricks/:id/clips', (req, res) => {
  const tricks = readJson(FILES.tricks, []);
  const trick = tricks.find((item) => item.id === req.params.id);
  if (!trick) return res.status(404).json({ error: '未找到' });
  trick.clips = trick.clips || [];
  const clip = {
    id: randomUUID(),
    name: String(req.body?.name || '').trim() || `片段 ${trick.clips.length + 1}`,
    startTime: Number(req.body?.startTime),
    endTime: Number(req.body?.endTime)
  };
  if (!Number.isFinite(clip.startTime) || !Number.isFinite(clip.endTime)) return res.status(400).json({ error: '缺少起止时间' });
  trick.clips.push(clip);
  writeJson(FILES.tricks, tricks);
  res.json(clip);
});
app.patch('/api/tricks/:id/clips/:clipId', (req, res) => {
  const tricks = readJson(FILES.tricks, []);
  const trick = tricks.find((item) => item.id === req.params.id);
  const clip = trick?.clips?.find((item) => item.id === req.params.clipId);
  if (!clip) return res.status(404).json({ error: '未找到' });
  if (req.body.name != null) clip.name = req.body.name;
  if (req.body.startTime != null) clip.startTime = Number(req.body.startTime);
  if (req.body.endTime != null) clip.endTime = Number(req.body.endTime);
  writeJson(FILES.tricks, tricks);
  res.json(clip);
});
app.delete('/api/tricks/:id/clips/:clipId', (req, res) => {
  const tricks = readJson(FILES.tricks, []);
  const trick = tricks.find((item) => item.id === req.params.id);
  if (!trick) return res.status(404).json({ error: '未找到' });
  trick.clips = (trick.clips || []).filter((clip) => clip.id !== req.params.clipId);
  writeJson(FILES.tricks, tricks);
  res.json({ success: true });
});
app.get('/api/tricks/:id/clips/:clipId/export', async (req, res) => {
  const trick = readJson(FILES.tricks, []).find((item) => item.id === req.params.id);
  const clip = trick?.clips?.find((item) => item.id === req.params.clipId);
  if (!clip) return res.status(404).json({ error: '未找到' });
  const input = path.join(BASE, trick.videoPath);
  const dur = Math.max(0.1, clip.endTime - clip.startTime).toFixed(3);
  const safe = String(clip.name || 'clip').replace(/[^\w\u4e00-\u9fff-]+/g, '_');
  const format = req.query.format === 'gif' ? 'gif' : 'mp4';
  const output = path.join(TRIMMED, safe + '_' + Date.now() + '.' + format);
  try {
    if (format === 'gif') {
      const palette = output + '.png';
      await runCommand('ffmpeg', ['-y', '-ss', String(clip.startTime), '-t', dur, '-i', input, '-vf', 'fps=12,scale=480:-1:flags=lanczos,palettegen', palette], [input], 0);
      await runCommand('ffmpeg', ['-y', '-ss', String(clip.startTime), '-t', dur, '-i', input, '-i', palette, '-filter_complex', '[0:v]fps=12,scale=480:-1:flags=lanczos[v];[v][1:v]paletteuse', output], [input], 0);
      fs.unlink(palette, () => {});
    } else {
      try {
        await runCommand('ffmpeg', ['-y', '-ss', String(clip.startTime), '-i', input, '-t', dur, '-c', 'copy', '-avoid_negative_ts', 'make_zero', output], [input], 0);
      } catch {
        await runCommand('ffmpeg', ['-y', '-ss', String(clip.startTime), '-i', input, '-t', dur, '-c:v', 'libx264', '-c:a', 'aac', output], [input], 0);
      }
    }
    await sendBytes(output, req, res, format === 'gif' ? 'image/gif' : 'video/mp4', {
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safe + '.' + format)}`
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally {
    setTimeout(() => fs.unlink(output, () => {}), 4000);
  }
});
app.delete('/api/tricks/:id', async (req, res) => {
  const tricks = readJson(FILES.tricks, []);
  const index = tricks.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '未找到' });
  const trick = tricks[index];
  const video = path.join(BASE, trick.videoPath);
  try { await lease.removeFile(video); } catch { /* already gone */ }
  if (trick.thumbnail) {
    try { await lease.removeFile(path.join(BASE, trick.thumbnail)); } catch { /* thumb */ }
  }
  tricks.splice(index, 1);
  writeJson(FILES.tricks, tricks);
  res.json({ success: true });
});

app.get('/api/play-history', (_req, res) => res.json(readJson(FILES.history, [])));
app.post('/api/play-history', async (req, res) => {
  const trickId = req.body?.trickId;
  if (!trickId) return res.status(400).json({ error: '缺少 trickId' });
  const excludes = readJson(FILES.exclude, []);
  if (excludes.some((folder) => samePath(trickId, folder) || lease.hits(folder, trickId))) {
    return res.json({ success: true, excluded: true });
  }
  try {
    // Folder .tv2-card.json history flag applies to itself and descendants.
    const folder = path.dirname(trickId);
    if (folder && allowed(folder)) {
      const hist = await resolveHistoryEnabled(folder);
      if (!hist.enabled) return res.json({ success: true, excluded: true, from: hist.from });
    }
  } catch { /* fall through and record */ }
  let history = readJson(FILES.history, []);
  const existing = history.find((row) => samePath(row.trickId, trickId));
  if (existing) {
    existing.lastPlayedAt = new Date().toISOString();
    if (req.body.progress != null) existing.progress = req.body.progress;
    if (req.body.trickName != null) existing.trickName = req.body.trickName;
    existing.trickId = trickId;
  } else {
    history.push({
      trickId,
      trickName: req.body.trickName || path.basename(trickId),
      progress: req.body.progress || 0,
      lastPlayedAt: new Date().toISOString()
    });
  }
  history.sort((a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt));
  history = history.slice(0, 200);
  writeJson(FILES.history, history);
  res.json({ success: true });
});
app.delete('/api/play-history', (_req, res) => { writeJson(FILES.history, []); res.json({ success: true }); });
app.delete('/api/play-history/folder', (req, res) => {
  const folderPath = req.query.path;
  if (!folderPath) return res.status(400).json({ error: '缺少路径' });
  const history = readJson(FILES.history, []).filter((row) => !lease.hits(folderPath, row.trickId));
  writeJson(FILES.history, history);
  res.json({ success: true });
});
app.get('/api/history-exclude', (_req, res) => res.json(readJson(FILES.exclude, [])));
app.post('/api/history-exclude', (req, res) => {
  const folder = req.body?.path;
  if (!folder) return res.status(400).json({ error: '缺少路径' });
  let excludes = readJson(FILES.exclude, []);
  if (req.body.action === 'remove') excludes = excludes.filter((item) => !samePath(item, folder));
  else if (!excludes.some((item) => samePath(item, folder))) excludes.push(folder);
  writeJson(FILES.exclude, excludes);
  res.json({ success: true, excludes });
});

app.get('/api/resource-links', (_req, res) => res.json(readJson(FILES.links, [])));
app.post('/api/resource-links', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: '无效数据' });
  writeJson(FILES.links, req.body);
  res.json({ success: true });
});

app.use('/uploads', async (req, res, next) => {
  const filePath = path.resolve(UPLOADS, decodeURIComponent(req.path).replace(/^[/\\]+/, ''));
  if (!lease.hits(UPLOADS, filePath) && lease.norm(filePath) !== lease.norm(UPLOADS)) return res.status(403).end();
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return next();
    await sendBytes(filePath, req, res, contentType(filePath), { 'Cache-Control': 'public, max-age=3600' });
  } catch (err) {
    if (err.code === 'ENOENT') return next();
    if (!res.headersSent) res.status(404).end();
  }
});

app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

function listen(preferredPort) {
  const port = Number(preferredPort || PORT);
  return new Promise((resolve, reject) => {
    const httpServer = app.listen(port, '0.0.0.0', () => {
      const list = readWhitelist();
      console.log('Tricks Video 2  http://localhost:' + port);
      if (list.length) console.log('[whitelist] ' + list.join(', '));
      else console.log('[whitelist] 未配置，本机路径都可访问。建议只在自己的电脑上打开。');
      try {
        if (process.versions && process.versions.electron) {
          resolve({ port, server: httpServer });
          return;
        }
        const SysTray = require('systray').default;
        const ico = path.join(PUBLIC_DIR, 'tray-icon.ico');
        if (!fs.existsSync(ico)) {
          resolve({ port, server: httpServer });
          return;
        }
        const tray = new SysTray({
          menu: {
            icon: fs.readFileSync(ico).toString('base64'),
            title: 'Tricks Video 2',
            tooltip: 'Tricks Video 2',
            items: [
              { title: '打开', tooltip: '', checked: false, enabled: true },
              { title: '退出', tooltip: '', checked: false, enabled: true }
            ]
          },
          debug: false,
          copyDir: false
        });
        tray.onClick((action) => {
          if (action.item?.title === '打开') spawn('cmd', ['/c', 'start', 'http://localhost:' + port], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
          if (action.item?.title === '退出') { tray.kill(); process.exit(0); }
        });
      } catch { /* tray is optional */ }
      resolve({ port, server: httpServer });
    });
    httpServer.on('error', (err) => reject(err));
  });
}

if (require.main === module) {
  listen().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { app, lease, listen, PORT, BASE, PUBLIC_DIR };
