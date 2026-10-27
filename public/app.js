const $ = (id) => document.getElementById(id);
const state = {
  view: 'browse',
  root: localStorage.getItem('tv2-root') || '',
  folder: localStorage.getItem('tv2-folder') || '',
  expanded: new Set(),
  tree: null,
  files: [],
  folders: [],
  playlist: [],
  sort: localStorage.getItem('tv2-sort') || 'name_asc',
  filter: 'all', // restored per-folder via tv2-folder-filters
  query: '',
  selected: new Set(),
  thumbTime: 1,
  coverStamp: 0,
  history: [],
  clips: [],
  player: null,
  blobUrl: '',
  markA: null,
  markB: null,
  loopClipId: null,
  repeat: localStorage.getItem('tv2-repeat') === 'one' ? 'one' : 'all',
  shuffle: localStorage.getItem('tv2-shuffle') === '1',
  shuffleBack: [],
  shuffleSeen: new Set(),
  listScroll: 0,
  cats: [],
  tricks: [],
  category: '',
  links: [],
  convertTab: 'extract',
  convertPick: '',
  convertCommand: '',
  convertPreview: null,
  gridShuffleRank: new Map(),
  folderHistory: true,
  local: { root: null, map: new Map(), tree: [], folder: '', files: [] },
  thumbToken: 0,
  listSeq: 0,
  cues: [],
  subs: [],
  cardPrefs: null,
  audioTrack: null,
  audioBlobUrl: '',
  audioCacheBlob: null,
  audioCacheKey: '',
  audioPrefetchToken: 0,
  audioLoop: localStorage.getItem('tv2-audio-loop') === '1',
  audioVolume: Number(localStorage.getItem('tv2-audio-vol') || '1') || 1,
  audioScrubbing: false,
  audioScrubResume: false,
  audioInfoPath: '',
  audioPaletteKey: '',
  audioPaletteToken: 0,
  audioPendingDelete: null,
  musicMode: localStorage.getItem('tv2-music-mode') === '1'
};

const ACCENTS = [
  ['ember', '橘黄', '#e08a55'],
  ['classic', '经典橘', '#d4471f'],
  ['hub', 'Pornhub', '#ff9000'],
  ['youtube', 'YouTube', '#ff0000'],
  ['google', 'Google', '#4285f4'],
  ['twitter', 'Twitter', '#1da1f2'],
  ['microsoft', 'Microsoft', '#0078d4']
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function dirname(filePath) {
  const index = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return index > 0 ? filePath.slice(0, index) : filePath;
}
function formatSize(bytes) {
  if (bytes == null || bytes === '') return '';
  let size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return (index ? size.toFixed(size < 10 ? 1 : 0) : size) + ' ' + units[index];
}
function clock(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—';
  const whole = Math.max(0, Math.floor(Number(seconds)));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}
/** Accepts 2:08 / 1:02:08 / 128 / 2.5 — returns seconds or null. */
function parseClock(text) {
  const raw = String(text || '').trim().replace(/，/g, '.').replace(/：/g, ':');
  if (!raw || raw === '—' || raw === '-') return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}
function setMarkDisplay(which, seconds) {
  const el = $(which === 'a' ? 'markAVal' : 'markBVal');
  if (!el) return;
  el.value = seconds == null || !Number.isFinite(Number(seconds)) ? '' : clock(seconds);
}
function commitMarkInput(which) {
  const el = $(which === 'a' ? 'markAVal' : 'markBVal');
  if (!el) return null;
  const parsed = parseClock(el.value);
  if (parsed == null) {
    if (!String(el.value || '').trim()) {
      if (which === 'a') state.markA = null;
      else state.markB = null;
      el.value = '';
      return null;
    }
    toast('时间格式用 2:08 或秒数');
    setMarkDisplay(which, which === 'a' ? state.markA : state.markB);
    return which === 'a' ? state.markA : state.markB;
  }
  const video = $('video');
  const dur = Number(video?.duration);
  const capped = Number.isFinite(dur) && dur > 0 ? Math.min(parsed, dur) : parsed;
  if (which === 'a') state.markA = capped;
  else state.markB = capped;
  setMarkDisplay(which, capped);
  return capped;
}
function clearClipLoop() {
  if (!state.loopClipId) return;
  state.loopClipId = null;
  renderClips();
}
function activeLoopClip() {
  if (!state.loopClipId) return null;
  return state.clips.find((clip) => clip.id === state.loopClipId) || null;
}
function toggleClipLoop(clip) {
  if (!clip) return;
  if (state.loopClipId === clip.id) {
    state.loopClipId = null;
    renderClips();
    toast('已取消片段循环');
    return;
  }
  state.loopClipId = clip.id;
  renderClips();
  const video = $('video');
  try { video.currentTime = Number(clip.startTime) || 0; } catch { /* ok */ }
  video.play().catch(() => {});
  toast('片段循环中 · 再点取消');
}
function formatDurationLong(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return '—';
  const whole = Math.floor(Number(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}
function formatBitrate(bps) {
  const n = Number(bps) || 0;
  if (n <= 0) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + ' Mbps';
  if (n >= 1e3) return Math.round(n / 1e3) + ' kbps';
  return n + ' bps';
}
function formatInfoTime(ms) {
  const n = Number(ms) || 0;
  if (!n) return '—';
  try {
    return new Date(n).toLocaleString('zh-CN', { hour12: false });
  } catch { return '—'; }
}
function noSidecars() {
  return localStorage.getItem('tv2-no-sidecars') === '1';
}
function sidecarLossHtml() {
  return `
    <div class="sidecar-warn">
      <div>开启后<strong>不会</strong>在媒体文件夹里再写入这些点开头文件：</div>
      <ul>
        <li><code>.tv2-card.json</code> — 卡片大小 / 比例 / 封面秒数、文件夹历史开关</li>
        <li><code>.TThumb.PNG</code> — 文件夹自定义封面</li>
      </ul>
      <div>相应会缺少：</div>
      <ul>
        <li>卡片设置只保存在本浏览器，换设备或清缓存会丢</li>
        <li>不能再把文件夹封面写进目录（粘贴/上传封面会提示跳过）</li>
        <li>「历史记录开/关」改走排除列表，不再写进 <code>.tv2-card.json</code></li>
        <li>「应用到子文件夹 / 资料库全部」不可用（会污染大量目录）</li>
      </ul>
      <div class="sub">备注 <code>*.notes.txt</code> 仍会按原样保存（不是点开头文件）。</div>
    </div>
  `;
}
function isMediaName(name) {
  return /\.(mp4|webm|mov|avi|mkv|wmv|flv|m4v|ts|m2ts|mp3|m4a|aac|flac|wav|ogg|opus|wma|jpg|jpeg|png|webp|gif|bmp|avif)$/i.test(name);
}
function mediaType(name) {
  if (/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i.test(name)) return 'image';
  if (/\.(mp3|m4a|aac|flac|wav|ogg|opus|wma)$/i.test(name)) return 'audio';
  if (/\.(mp4|webm|mov|avi|mkv|wmv|flv|m4v|ts|m2ts)$/i.test(name)) return 'video';
  return 'file';
}
/** Prefer extension so JPG never sneaks into the audio filter. */
function fileKind(file) {
  if (!file) return '';
  const byName = mediaType(file.name || '');
  if (byName === 'image' || byName === 'audio' || byName === 'video') return byName;
  if (file.type === 'image' || file.type === 'audio' || file.type === 'video') return file.type;
  return byName || '';
}
/** In music mode, videos open in the audio player too. */
function playsAsAudio(file) {
  const kind = fileKind(file);
  if (kind === 'audio') return true;
  return !!(state.musicMode && kind === 'video');
}
function syncMusicModeButton() {
  const btn = $('musicModeBtn');
  if (!btn) return;
  const on = !!state.musicMode;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.title = on
    ? '音乐模式开：视频用音乐播放器听（再点关闭）'
    : '音乐模式：视频也用音乐播放器听';
}
async function toggleMusicMode() {
  state.musicMode = !state.musicMode;
  localStorage.setItem('tv2-music-mode', state.musicMode ? '1' : '0');
  syncMusicModeButton();
  if (state.musicMode) {
    const player = state.player;
    const main = $('video');
    if (player && fileKind(player) === 'video') {
      const time = main && Number.isFinite(main.currentTime) ? main.currentTime : 0;
      try {
        await openAudio({ ...player }, time);
        closePlayer();
        toast('已用音乐播放器继续播');
      } catch (err) {
        toast(err.message || '切到音乐播放失败');
      }
      return;
    }
    toast('音乐模式已开：点视频用播放器听');
    return;
  }
  const track = state.audioTrack;
  if (track && fileKind(track) === 'video') {
    const audio = $('miniAudio');
    const time = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    try {
      await openFile({ ...track }, time);
    } catch (err) {
      toast(err.message || '切回视频失败');
      return;
    }
  }
  toast('音乐模式已关');
}
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2400);
}
async function api(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 180) }; }
  }
  if (!response.ok) throw new Error((data && data.error) || response.statusText);
  return data;
}
function showUploadDock(title = '正在上传') {
  const dock = $('dock');
  if (!dock) return;
  dock.hidden = false;
  dock.innerHTML = `
    <div class="dock-head"><strong id="dockTitle">${esc(title)}</strong><span id="dockPct">0%</span></div>
    <div class="bar"><span id="dockBar"></span></div>
    <div id="dockText" class="sub">准备中…</div>
    <div class="dock-actions">
      <button class="text-btn" id="dockClose" type="button">隐藏</button>
    </div>`;
  $('dockClose').onclick = () => { dock.hidden = true; };
}
function setUploadProgress(pct, text) {
  if ($('dockBar')) $('dockBar').style.width = Math.max(0, Math.min(100, pct)) + '%';
  if ($('dockPct')) $('dockPct').textContent = Math.round(pct) + '%';
  if ($('dockText') && text) $('dockText').textContent = text;
}
function uploadFiles(folder, fileList) {
  const files = [...(fileList || [])].filter((file) => file && file.name);
  if (!folder) return Promise.reject(new Error('先打开一个文件夹'));
  if (!files.length) return Promise.reject(new Error('没有可上传的文件'));
  showUploadDock('正在上传');
  setUploadProgress(0, `0 / ${files.length} · 准备发送`);
  const body = new FormData();
  body.append('folderPath', folder);
  files.forEach((file) => body.append('files', file, file.name));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const pct = (event.loaded / event.total) * 100;
      setUploadProgress(pct, `${formatSize(event.loaded)} / ${formatSize(event.total)} · ${files.length} 个文件`);
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { data = { error: xhr.responseText?.slice(0, 180) }; }
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadProgress(100, '上传完成');
        if ($('dockTitle')) $('dockTitle').textContent = '上传完成';
        resolve(data);
      } else {
        if ($('dockTitle')) $('dockTitle').textContent = '上传失败';
        reject(new Error((data && data.error) || xhr.statusText || '上传失败'));
      }
    };
    xhr.onerror = () => {
      if ($('dockTitle')) $('dockTitle').textContent = '上传失败';
      reject(new Error('网络错误，上传失败'));
    };
    xhr.send(body);
  });
}
function qs(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value != null) search.set(key, value); });
  return search.toString();
}

function savedTheme() {
  let mode = localStorage.getItem('tv2-mode');
  let accent = localStorage.getItem('tv2-accent');
  if (!mode || !accent) {
    const old = localStorage.getItem('tv2-theme') || 'hearth';
    const light = ['paper', 'blossom', 'moss', 'linen', 'snow'];
    const accents = { hearth: 'ember', paper: 'ember', linen: 'amber', lagoon: 'sea', blossom: 'rose', dusk: 'violet', moss: 'moss', ink: 'sky', snow: 'sky' };
    if (!mode) mode = light.includes(old) ? 'light' : 'dark';
    if (!accent) accent = accents[old] || 'ember';
  }
  if (!ACCENTS.some((item) => item[0] === accent)) accent = 'ember';
  if (mode !== 'light' && mode !== 'dark') mode = 'dark';
  return [mode, accent];
}
function applyTheme(mode, accent) {
  const root = document.documentElement;
  root.setAttribute('data-mode', mode);
  root.setAttribute('data-accent', accent);
  localStorage.setItem('tv2-mode', mode);
  localStorage.setItem('tv2-accent', accent);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--theme').trim();
  document.querySelectorAll('#helpPop [data-mode]').forEach((button) => {
    button.classList.toggle('on', button.dataset.mode === mode);
  });
  document.querySelectorAll('#helpPop [data-accent]').forEach((button) => {
    button.classList.toggle('on', button.dataset.accent === accent);
  });
}
function themeMarkup() {
  const mode = document.documentElement.getAttribute('data-mode') || 'dark';
  const accent = document.documentElement.getAttribute('data-accent') || 'ember';
  const modes = `<div class="mode-row">
    <button type="button" class="mode-btn ${mode === 'dark' ? 'on' : ''}" data-mode="dark" style="background:#141414;color:#f3f3f3">黑</button>
    <button type="button" class="mode-btn ${mode === 'light' ? 'on' : ''}" data-mode="light" style="background:#f6f6f4;color:#1a1a1a">白</button>
  </div>`;
  const dots = '<div class="accent-row">' + ACCENTS.map(([id, label, color]) =>
    `<button type="button" class="accent-dot ${id === accent ? 'on' : ''}" data-accent="${id}" title="${label}" aria-label="${label}" style="background:${color}"></button>`
  ).join('') + '</div>';
  return modes + dots;
}

function setView(view, opts = {}) {
  if (view === 'library' || view === 'local') view = 'browse';
  closePlayer();
  state.view = view;
  location.hash = view;
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });
  document.querySelectorAll('#modeDrop button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  const noside = view === 'convert' || view === 'links' || view === 'help';
  $('app').classList.toggle('noside', noside);
  $('app').dataset.view = view;
  $('sideTitle').textContent = '文件夹';
  $('sideAdd').hidden = noside;
  $('app').classList.remove('nav-open');
  if (view === 'convert') renderConvert();
  if (view === 'links') loadLinks().catch((err) => toast(err.message));
  if (view === 'browse' && !opts.keep) {
    if (state.root) refreshBrowse().catch((err) => toast(err.message));
    else renderWelcome();
  }
}

function releaseVideo() {
  const video = $('video');
  video.pause();
  video.removeAttribute('src');
  while (video.firstChild) video.removeChild(video.firstChild);
  video.load();
  state.cues = [];
  state.subs = [];
  state.loopClipId = null;
  state.markA = null;
  state.markB = null;
  setMarkDisplay('a', null);
  setMarkDisplay('b', null);
  if ($('subOverlay')) $('subOverlay').textContent = '';
  if ($('subSelect')) $('subSelect').hidden = true;
  $('still').hidden = true;
  $('still').removeAttribute('src');
  if (state.blobUrl) {
    URL.revokeObjectURL(state.blobUrl);
    state.blobUrl = '';
  }
  state.thumbToken += 1;
}

function syncAppTopH() {
  const top = document.querySelector('.top');
  if (!top) return;
  document.documentElement.style.setProperty('--app-top-h', Math.ceil(top.getBoundingClientRect().height) + 'px');
}
function syncTopChrome() {
  const top = document.querySelector('.top');
  if (!top) return;
  const playing = !$('player').hidden;
  const mobile = isMobileLayout();
  const filtersOpen = top.classList.contains('filters-open');
  // Playing: hide search/sort. Mobile: collapsed unless filter toggle is open.
  top.classList.toggle('filters-collapsed', playing || (mobile && !filtersOpen));
  document.querySelector('.app')?.classList.toggle('playing', playing);
  const toggle = $('filterToggleBtn');
  if (toggle) {
    toggle.classList.toggle('on', filtersOpen && !playing);
    toggle.setAttribute('aria-expanded', filtersOpen && !playing ? 'true' : 'false');
    toggle.hidden = playing;
  }
  syncAppTopH();
}
function showPlayerPage() {
  if (typeof hideHover === 'function') hideHover();
  if ($('player').hidden) state.listScroll = $('main').scrollTop;
  document.querySelectorAll('[data-view-panel]').forEach((panel) => { panel.hidden = true; });
  $('player').hidden = false;
  $('main').scrollTop = 0;
  const box = $('detailVideoBox');
  const saved = localStorage.getItem('tv2-video-height');
  if (box) box.style.height = saved ? saved + 'px' : '50vh';
  syncTopChrome();
}
function closePlayer() {
  const wasOpen = !$('player').hidden;
  releaseVideo();
  $('player').hidden = true;
  leaveDouyin();
  state.player = null;
  state.markA = null;
  state.markB = null;
  state.loopClipId = null;
  setMarkDisplay('a', null);
  setMarkDisplay('b', null);
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== state.view;
  });
  if (wasOpen) $('main').scrollTop = state.listScroll || 0;
  syncTopChrome();
}
function currentList() {
  if (state.view === 'library') return state.trickPlaylist || [];
  if (state.view === 'local') return state.local.files || [];
  return state.playlist || [];
}
function updateChrome() {
  const list = currentList();
  const player = state.player;
  const key = player ? (player.kind === 'trick' ? player.id : player.path || player.key) : '';
  const index = list.findIndex((item) => (item.id || item.path || item.key) === key);
  $('navInfo').textContent = index >= 0 ? (index + 1) + ' / ' + list.length : '';
  $('playerTitle').textContent = player?.name || '';
  $('detailDrag').hidden = player?.kind !== 'file';
  $('streamMenu').hidden = player?.kind !== 'file';
  if (player?.kind !== 'file') $('streamPinned').hidden = true;
  $('repeatBtn').classList.toggle('on', state.repeat === 'one');
  $('shuffleBtn').classList.toggle('on', state.shuffle);
  renderDetailTags();
}
function folderTags(filePath) {
  if (!filePath) return [];
  const root = String(state.root || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const full = String(filePath).replace(/\\/g, '/');
  const rel = root && (full === root || full.startsWith(root + '/')) ? full.slice(root.length).replace(/^\//, '') : full;
  return rel.split('/').slice(0, -1).filter(Boolean);
}
function tagButtons(tags) {
  return tags.map((tag, index) => `<button type="button" class="card-tag" data-tag-index="${index}">${esc(tag)}</button>`).join('');
}
function renderDetailTags() {
  const el = $('detailTags');
  if (!el) return;
  const tags = state.player?.kind === 'file' ? folderTags(state.player.path) : [];
  el.innerHTML = tagButtons(tags);
  el.hidden = !tags.length;
}
function openTag(filePath, index) {
  const parts = folderTags(filePath).slice(0, Number(index) + 1);
  let node = state.tree;
  let cur = state.tree;
  for (const part of parts) {
    const child = (cur?.folders || []).find((folder) => folder.name === part);
    if (!child) return;
    state.expanded.add(child.path);
    cur = child;
    node = child;
  }
  renderSide();
  selectFolder(node.path).catch((err) => toast(err.message));
}

function itemKey(item) {
  if (!item) return '';
  return item.id || item.path || item.key || '';
}
function matchesQuery(parts, words) {
  if (!words.length) return true;
  const hay = parts.filter(Boolean).join('\n').toLowerCase();
  return words.every((word) => hay.includes(word));
}
function noteMarkHtml(file) {
  const text = String(file?.note || file?.notes || '').trim();
  if (!file?.hasNote && !text) return '';
  return `<span class="note-mark" tabindex="0">有笔记${text ? `<span class="note-pop">${esc(text)}</span>` : ''}</span>`;
}
function resetShuffleCycle() {
  state.shuffleBack = [];
  state.shuffleSeen = new Set();
}
function reshuffleGridOrder() {
  state.gridShuffleRank = new Map();
}
function visibleFiles(files) {
  const words = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rank = new Map(state.history.map((row, index) => [row.trickId, index]));
  const list = files.filter((file) => {
    const kind = fileKind(file);
    if (state.filter !== 'all' && kind !== state.filter) return false;
    return matchesQuery([file.name, file.note, file.notes], words);
  });
  if (state.sort === 'shuffle') {
    for (const file of list) {
      const key = itemKey(file);
      if (!state.gridShuffleRank.has(key)) state.gridShuffleRank.set(key, Math.random());
    }
    return list.sort((a, b) => (state.gridShuffleRank.get(itemKey(a)) || 0) - (state.gridShuffleRank.get(itemKey(b)) || 0));
  }
  return list.sort((a, b) => {
    if (state.sort === 'name_desc') return b.name.localeCompare(a.name, 'zh');
    if (state.sort === 'time_desc') return (b.birthtime || 0) - (a.birthtime || 0);
    if (state.sort === 'time_asc') return (a.birthtime || 0) - (b.birthtime || 0);
    if (state.sort === 'recent') return (rank.get(a.path) ?? 9999) - (rank.get(b.path) ?? 9999);
    return a.name.localeCompare(b.name, 'zh');
  });
}
function syncFolderHistoryBtn() {
  const btn = $('folderHistoryBtn');
  if (!btn) return;
  const on = state.folderHistory !== false;
  btn.textContent = on ? '历史记录(开)' : '历史记录(关)';
  btn.classList.toggle('off', !on);
  btn.title = on
    ? '此文件夹及子文件夹会写入播放历史（点按关闭）'
    : '此文件夹及子文件夹不写播放历史（点按开启）';
}
async function loadFolderHistory(folder = state.folder) {
  if (!folder) {
    state.folderHistory = true;
    syncFolderHistoryBtn();
    return true;
  }
  try {
    const data = await api('/api/folder-history?' + qs({ path: folder }));
    state.folderHistory = data.enabled !== false;
  } catch {
    state.folderHistory = true;
  }
  syncFolderHistoryBtn();
  return state.folderHistory;
}
async function toggleFolderHistory() {
  if (!state.folder) return toast('先打开一个文件夹');
  const next = state.folderHistory === false;
  // Clean mode: don't write .tv2-card.json — use the global exclude list instead.
  if (noSidecars()) {
    await api('/api/history-exclude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.folder, action: next ? 'remove' : 'add' })
    });
    state.folderHistory = next;
    syncFolderHistoryBtn();
    toast(state.folderHistory ? '已开启此文件夹历史记录' : '已关闭此文件夹历史记录（排除列表）');
    return;
  }
  const data = await api('/api/folder-history', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: state.folder, enabled: next })
  });
  state.folderHistory = data.enabled !== false;
  syncFolderHistoryBtn();
  toast(state.folderHistory ? '已开启此文件夹历史记录' : '已关闭此文件夹历史记录（含子文件夹）');
}

function folderBase(dir) {
  const parts = String(dir || '').split(/[/\\]/).filter(Boolean);
  return parts.pop() || dir || '文件夹';
}
function readRecents() {
  try { return JSON.parse(localStorage.getItem('tv2-recents') || '[]').filter(Boolean); } catch { return []; }
}
function remember(dir) {
  if (!dir) return;
  const recents = readRecents().filter((item) => item !== dir);
  recents.unshift(dir);
  localStorage.setItem('tv2-recents', JSON.stringify(recents.slice(0, 16)));
}
function removeRecent(dir) {
  localStorage.setItem('tv2-recents', JSON.stringify(readRecents().filter((item) => item !== dir)));
  renderWorkspaceList();
}
function projectOpen() {
  return !!($('browseBody') && !$('browseBody').hidden && state.root);
}
function syncWorkspace() {
  const switcher = $('browseSwitch');
  const label = $('workspaceLabel');
  const pathRow = $('workspacePathRow');
  if (!switcher || !label) return;
  const open = projectOpen();
  switcher.classList.toggle('project-open', open);
  if (pathRow) pathRow.hidden = open;
  label.textContent = open ? folderBase(state.root) : '打开文件夹';
  label.title = open ? state.root : '选择或打开文件夹';
  if ($('pathInput') && document.activeElement !== $('pathInput')) {
    $('pathInput').value = state.root || '';
  }
  if (!$('workspaceDrop').hidden) renderWorkspaceList();
}
function renderWorkspaceList() {
  const list = $('workspaceList');
  if (!list) return;
  const recents = readRecents();
  const current = state.root || '';
  if (!recents.length) {
    list.innerHTML = '<div class="empty" style="padding:12px 10px;margin:0;">还没有历史文件夹。</div>';
    return;
  }
  list.innerHTML = recents.map((dir) => `
    <div class="workspace-item ${dir === current ? 'active' : ''}" data-open="${esc(dir)}" role="button" tabindex="0">
      <div class="workspace-item-name">${esc(folderBase(dir))}</div>
      <button class="workspace-item-remove" type="button" data-forget="${esc(dir)}" title="从列表移除">×</button>
      <div class="workspace-item-path">${esc(dir)}</div>
    </div>
  `).join('');
}
function closeWorkspaceDrop() {
  if ($('workspaceDrop')) $('workspaceDrop').hidden = true;
  if ($('workspaceNew')) $('workspaceNew').hidden = true;
}
function toggleWorkspaceDrop() {
  const drop = $('workspaceDrop');
  if (!drop) return;
  if (!drop.hidden) {
    closeWorkspaceDrop();
    return;
  }
  renderWorkspaceList();
  if ($('workspaceNew')) $('workspaceNew').hidden = true;
  drop.hidden = false;
}

async function renderWelcome() {
  const list = await api('/api/whitelist').catch(() => []);
  const recents = readRecents();
  $('welcome').hidden = false;
  $('browseBody').hidden = true;
  syncWorkspace();
  $('welcome').innerHTML = `
    <h1>把片子放在手边。</h1>
    <p class="lede">左边可以打开历史文件夹，也可以直接输入路径。播放时不会一直占着文件，所以删除、改名、新建和移动文件夹可以照常进行。</p>
    ${list.length ? `<div class="chips">${list.map((dir) => `<button class="chip" type="button" data-open="${esc(dir)}">${esc(dir)}</button>`).join('')}</div>` : ''}
    ${recents.length ? `<div class="recent">${recents.map((dir) => `<button class="chip" type="button" data-open="${esc(dir)}">${esc(dir)}</button>`).join('')}</div>` : ''}
  `;
  $('welcome').querySelectorAll('[data-open]').forEach((button) => {
    button.onclick = () => openRoot(button.dataset.open);
  });
}

async function openRoot(dir) {
  if (!dir) return;
  state.root = dir;
  state.folder = dir;
  if ($('pathInput')) $('pathInput').value = dir;
  localStorage.setItem('tv2-root', dir);
  localStorage.setItem('tv2-folder', dir);
  remember(dir);
  closeWorkspaceDrop();
  await refreshBrowse();
  syncWorkspace();
}

function findNode(node, dir) {
  if (!node) return null;
  if (node.path === dir) return node;
  for (const child of node.folders || []) {
    const found = findNode(child, dir);
    if (found) return found;
  }
  return null;
}
function countVideos(node) {
  return node && node.count ? node.count : 0;
}
function revealFolder(dir) {
  state.expanded.add(state.root);
  const trail = [];
  const walk = (node) => {
    if (!node) return false;
    if (node.path === dir) return true;
    for (const child of node.folders || []) {
      if (walk(child)) { trail.push(node.path); return true; }
    }
    return false;
  };
  walk(state.tree);
  trail.forEach((item) => state.expanded.add(item));
}

async function refreshBrowse() {
  if (!state.root) return renderWelcome();
  try {
    state.tree = await api('/api/tree?' + qs({ path: state.root }));
    if (!state.folder || !findNode(state.tree, state.folder)) state.folder = state.root;
    state.expanded.add(state.root);
    await selectFolder(state.folder, { keepPlayer: true });
    syncWorkspace();
  } catch (err) {
    toast(err.message);
    await renderWelcome();
  }
}

function renderTreeNode(node, depth) {
  const kids = node.folders || [];
  const open = state.expanded.has(node.path);
  const count = countVideos(node);
  return `<div class="tree-node">
    <div class="tree-row ${depth === 0 ? 'root' : ''} ${node.path === state.folder ? 'active' : ''}" data-folder="${esc(node.path)}" data-drop="${esc(node.path)}" draggable="${depth ? 'true' : 'false'}">
      <button type="button" class="tree-toggle ${kids.length ? (open ? 'open' : '') : 'leaf'}" data-toggle="${esc(node.path)}" aria-label="展开"></button>
      <span class="tree-name">${node.hasThumb ? `<img class="tree-thumb" alt="" src="/api/folder-thumb?${qs({ path: node.path, _: state.coverStamp })}">` : ''}${esc(node.name || node.path)}</span>
      <span class="tree-count">${count || ''}</span>
    </div>
    ${kids.length && open ? `<div class="tree-kids">${kids.map((child) => renderTreeNode(child, depth + 1)).join('')}</div>` : ''}
  </div>`;
}

function renderSide() {
  if (state.view === 'library') return renderLibrarySide();
  if (state.view === 'local') return renderLocalSide();
  if (!state.tree) { $('sideBody').innerHTML = ''; return; }
  $('sideBody').innerHTML = renderTreeNode(state.tree, 0);
}

function joinFolder(base, name) {
  if (!base) return name;
  if (/[/\\]$/.test(base)) return base + name;
  return base + (base.includes('\\') ? '\\' : '/') + name;
}
function breadcrumbParts(folder = state.folder, root = state.root) {
  if (!folder) return [];
  if (!root || folder === root || (!underPath(folder, root) && folder !== root)) {
    return [{ name: folderBase(folder), path: folder }];
  }
  const rel = folder.slice(root.length).replace(/^[/\\]+/, '');
  const parts = [{ name: folderBase(root), path: root }];
  let acc = root;
  for (const bit of rel.split(/[/\\]/).filter(Boolean)) {
    acc = joinFolder(acc, bit);
    parts.push({ name: bit, path: acc });
  }
  return parts;
}
function breadcrumbHtml(opts = {}) {
  const parts = breadcrumbParts();
  if (!parts.length) return '';
  const large = !!opts.large;
  return parts.map((part, index) => {
    const last = index === parts.length - 1;
    return `${index ? '<span class="crumb-sep" aria-hidden="true">/</span>' : ''}<button type="button" class="crumb ${large ? 'crumb-lg' : ''} ${last ? 'current' : ''}" data-crumb="${esc(part.path)}" title="${esc(part.path)}" ${last ? 'aria-current="page"' : ''}>${esc(part.name)}</button>`;
  }).join('');
}
function renderCrumbs() {
  const el = $('crumbs');
  if (el) el.innerHTML = breadcrumbHtml();
}
function openCrumb(dir) {
  if (!dir || dir === state.folder) return;
  selectFolder(dir).catch((err) => toast(err.message));
}

function renderFolderHead() {
  const info = state.folderInfo || { name: '', path: state.folder, hasThumb: false };
  const thumb = info.hasThumb ? `/api/folder-thumb?${qs({ path: info.path, _: state.coverStamp })}` : '';
  $('folderHead').innerHTML = `
    <div class="cover-wrap${thumb ? ' has-thumb' : ''}">
      <button class="cover" id="coverBtn" type="button" title="上传文件夹封面">${thumb ? `<img src="${esc(thumb)}" alt="">` : '封面'}</button>
      ${thumb ? '<button class="cover-remove" id="coverRemove" type="button" title="删除封面" aria-label="删除封面">×</button>' : ''}
    </div>
    <div class="folder-copy">
      <div class="folder-crumbs">${breadcrumbHtml({ large: true })}</div>
    </div>
    <div class="folder-count">${state.files.length} 个文件</div>
    <input id="coverInput" type="file" accept="image/*" hidden>
  `;
  $('coverBtn').onclick = () => $('coverInput').click();
  const remove = $('coverRemove');
  if (remove) {
    remove.onclick = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (noSidecars()) return toast('已开启「禁止导出拉屎」，不删除目录内的 .TThumb.PNG');
      try {
        await api('/api/folder-thumb?' + qs({ path: info.path || state.folder }), { method: 'DELETE' });
        state.folderInfo.hasThumb = false;
        const node = findNode(state.tree, state.folder);
        if (node) node.hasThumb = false;
        state.coverStamp += 1;
        renderFolderHead();
        renderSide();
        toast('封面已删除');
      } catch (err) { toast(err.message); }
    };
  }
  $('coverInput').onchange = async () => {
    const file = $('coverInput').files[0];
    if (!file) return;
    if (noSidecars()) {
      $('coverInput').value = '';
      return toast('已开启「禁止导出拉屎」，不会写入 .TThumb.PNG');
    }
    const body = new FormData();
    body.append('thumb', file);
    body.append('folderPath', state.folder);
    try {
      await api('/api/folder-thumb', { method: 'POST', body });
      state.folderInfo.hasThumb = true;
      const node = findNode(state.tree, state.folder);
      if (node) node.hasThumb = true;
      state.coverStamp += 1;
      renderFolderHead();
      renderSide();
    } catch (err) { toast(err.message); }
  };
}

let cardRaf = 0;
function fillCard(card, file) {
  if (!card.isConnected) return;
  if (previewOpen() && hoverCard === card) closePreviewNow();
  card.classList.remove('placeholder');
  const nested = dirname(file.path) !== state.folder;
  const where = nested ? dirname(file.path).split(/[/\\]/).pop() : '';
  const bits = [esc(formatSize(file.size)), where ? esc(where) : ''].filter(Boolean);
  const note = noteMarkHtml(file);
  const sub = [bits.join(' · '), note].filter(Boolean).join(bits.length && note ? ' · ' : '');
  const kind = fileKind(file);
  const playing = !!(state.audioTrack && (
    (state.audioTrack.path && file.path && state.audioTrack.path === file.path)
    || (state.audioTrack.key && file.key && state.audioTrack.key === file.key)
  ));
  card.classList.toggle('now-playing', playing);
  const thumbSrc = file.path
    ? `/api/thumbnail?${qs({ path: file.path, t: kind === 'audio' ? 'cover' : state.thumbTime, _: state.coverStamp })}`
    : '';
  let thumb;
  if (kind === 'audio' && !thumbSrc) thumb = '<div class="audio-thumb" aria-hidden="true">♪</div>';
  else if (thumbSrc) thumb = `<img alt="" loading="lazy" src="${esc(thumbSrc)}">`;
  else thumb = '<div class="thumb-fallback" aria-hidden="true"></div>';
  card.innerHTML = `
    <div class="thumb">${thumb}<span class="badge">${esc(file.name.split('.').pop().toUpperCase())}</span></div>
    <div class="meta"><div class="name">${esc(file.name)}</div><div class="sub">${sub}</div>${folderTags(file.path).length ? `<div class="card-tags">${tagButtons(folderTags(file.path))}</div>` : ''}</div>`;
  const img = card.querySelector('img');
  if (img) {
    img.onerror = () => {
      const fallback = document.createElement('div');
      if (kind === 'audio') {
        fallback.className = 'audio-thumb';
        fallback.textContent = '♪';
      } else {
        fallback.className = 'thumb-fallback';
      }
      img.replaceWith(fallback);
    };
  }
}
function renderGrid() {
  if (previewOpen()) closePreviewNow();
  if (state.cardObserver) { state.cardObserver.disconnect(); state.cardObserver = null; }
  if (cardRaf) { cancelAnimationFrame(cardRaf); cardRaf = 0; }
  const files = visibleFiles(state.files);
  state.playlist = files;
  const grid = $('grid');
  if (!files.length) {
    grid.innerHTML = '<div class="empty">这里没有媒体文件。</div>';
    return;
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  const frag = document.createDocumentFragment();
  for (const file of files) {
    const card = document.createElement('div');
    card.className = 'card placeholder' + (file.name.includes('-[stared]') ? ' star' : '') + (state.selected.has(file.path) ? ' selected' : '');
    card.draggable = true;
    card.dataset.file = file.path;
    card.innerHTML = '<div class="thumb"></div><div class="meta"></div>';
    frag.appendChild(card);
  }
  grid.replaceChildren(frag);
  const pending = [];
  const pump = () => {
    pending.splice(0, 4).forEach((card) => {
      const file = byPath.get(card.dataset.file);
      if (file) fillCard(card, file);
    });
    cardRaf = pending.length ? requestAnimationFrame(pump) : 0;
  };
  state.cardObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      pending.push(entry.target);
      state.cardObserver.unobserve(entry.target);
    }
    if (!cardRaf && pending.length) cardRaf = requestAnimationFrame(pump);
  }, { root: $('main'), rootMargin: '280px 0px' });
  grid.querySelectorAll('.card.placeholder').forEach((card) => state.cardObserver.observe(card));
}

function syncPathInput() {
  const input = $('pathInput');
  if (input && document.activeElement !== input) input.value = state.root || '';
}
function readFolderFilterMap() {
  try { return JSON.parse(localStorage.getItem('tv2-folder-filters') || '{}'); } catch { return {}; }
}
function normalizeFolderFilter(value) {
  return ['all', 'video', 'audio', 'image'].includes(value) ? value : 'all';
}
function loadFolderFilter(folder) {
  if (!folder) return 'all';
  const map = readFolderFilterMap();
  return normalizeFolderFilter(map[folder] || 'all');
}
function saveFolderFilter(folder, filter) {
  if (!folder) return;
  const map = readFolderFilterMap();
  const next = normalizeFolderFilter(filter);
  if (next === 'all') delete map[folder];
  else map[folder] = next;
  localStorage.setItem('tv2-folder-filters', JSON.stringify(map));
}
function applyFolderFilter(folder) {
  state.filter = loadFolderFilter(folder);
  syncSortButtons();
}
async function selectFolder(dir, opts = {}) {
  if (!opts.keepPlayer) closePlayer();
  if (!opts.preserveShuffle) resetShuffleCycle();
  const keepScroll = opts.preserveScroll ? ($('main')?.scrollTop || 0) : null;
  state.folder = dir;
  applyFolderFilter(dir);
  syncPathInput();
  localStorage.setItem('tv2-folder', dir);
  const node = findNode(state.tree, dir);
  state.folderInfo = node || { name: dir.split(/[/\\]/).pop(), path: dir, hasThumb: false };
  state.selected.clear();
  revealFolder(dir);
  $('welcome').hidden = true;
  $('browseBody').hidden = false;
  syncWorkspace();
  renderSide();
  renderCrumbs();
  renderFolderHead();
  const seq = ++state.listSeq;
  $('grid').innerHTML = '<div class="empty">正在列出文件…</div>';
  const [data, prefs] = await Promise.all([
    api('/api/files?' + qs({ path: dir })),
    loadCardPrefs(dir),
    loadFolderHistory(dir)
  ]);
  if (seq !== state.listSeq) return;
  state.files = (data.files || []).map((file) => {
    const kind = fileKind(file);
    return kind && file.type !== kind ? { ...file, type: kind } : file;
  });
  state.folderInfo = { name: data.name || state.folderInfo.name, path: dir, hasThumb: !!data.hasThumb };
  state.thumbTime = Number(prefs.thumbTime ?? 1);
  applyCardPrefs(prefs);
  if ($('thumbSlider')) {
    $('thumbSlider').value = state.thumbTime;
    if ($('thumbLabel')) $('thumbLabel').textContent = state.thumbTime + 's';
  }
  renderFolderHead();
  renderGrid();
  if (keepScroll != null) {
    const main = $('main');
    if (main) {
      main.scrollTop = keepScroll;
      requestAnimationFrame(() => { main.scrollTop = keepScroll; });
    }
  }
}

function fileByPath(filePath) {
  return state.files.find((file) => file.path === filePath);
}

function cuePlayback(video, time) {
  const at = Math.max(0, Number(time) || 0);
  const go = () => {
    const start = () => video.play().catch(() => {});
    if (at <= 0.05) { start(); return; }
    const seeked = () => { video.removeEventListener('seeked', seeked); start(); };
    video.addEventListener('seeked', seeked);
    try { video.currentTime = at; } catch { video.removeEventListener('seeked', seeked); start(); return; }
    if (Math.abs((video.currentTime || 0) - at) < 0.2) { video.removeEventListener('seeked', seeked); start(); }
  };
  if (video.readyState >= 1) go();
  else video.addEventListener('loadedmetadata', go, { once: true });
}
async function openFile(file, time) {
  if (!file) return;
  if (playsAsAudio(file)) {
    await openAudio(file, time);
    return;
  }
  const mini = $('miniAudio');
  if (mini && !mini.paused) { mini.pause(); syncMiniPlayButton(); }
  releaseVideo();
  state.player = { kind: 'file', ...file };
  showPlayerPage();
  syncPinned();
  updateChrome();
  const video = $('video');
  if (file.type === 'image') {
    video.hidden = true;
    $('still').hidden = false;
    $('still').src = '/api/stream?' + qs({ path: file.path });
  } else {
    video.hidden = false;
    $('still').hidden = true;
    video.src = '/api/play?' + qs({ path: file.path });
    cuePlayback(video, time);
    loadSubtitles(file.subtitles || []);
  }
  await loadSidePanel();
  rememberHistory(file.path, file.name, Number(time) || 0);
}

function audioList() {
  if (state.view === 'local') {
    return (state.local.files || []).filter((item) => playsAsAudio(item));
  }
  const list = (state.playlist && state.playlist.length ? state.playlist : visibleFiles(state.files || []))
    .filter((item) => playsAsAudio(item));
  if (list.length) return list;
  return (state.files || []).filter((item) => playsAsAudio(item));
}
function audioCoverUrl(track, absolute = false) {
  if (!track?.path) return '';
  const rel = '/api/thumbnail?' + qs({ path: track.path, t: 'cover', _: state.coverStamp });
  return absolute ? (location.origin + rel) : rel;
}
function audioStreamUrl(track) {
  if (!track?.path) return '';
  // Videos need /api/play (remux / browser-playable). Pure audio can use cacheable stream.
  if (fileKind(track) === 'video') return '/api/play?' + qs({ path: track.path });
  return '/api/stream?' + qs({ path: track.path });
}
function syncMiniPlayButton() {
  const audio = $('miniAudio');
  const playing = !!(audio && !audio.paused && !audio.ended);
  $('miniPlayer')?.classList.toggle('is-playing', playing);
  $('audioStage')?.classList.toggle('is-playing', playing);
}
function paintAudioProgress(cur, dur) {
  const label = clock(cur) + ' / ' + (dur ? clock(dur) : '—');
  const pct = dur ? ((Math.min(cur, dur) / dur) * 100) + '%' : '0%';
  if ($('miniTime')) $('miniTime').textContent = label;
  if ($('miniFill')) $('miniFill').style.width = pct;
  if ($('audioStageTime')) $('audioStageTime').textContent = label;
  if ($('audioStageFill')) $('audioStageFill').style.width = pct;
}
function syncMiniProgress() {
  if (state.audioScrubbing) return;
  const audio = $('miniAudio');
  if (!audio) return;
  const cur = audio.currentTime || 0;
  const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
  paintAudioProgress(cur, dur);
}
function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function rgbCss(r, g, b) {
  return `rgb(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)})`;
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}
function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255
  };
}
function relativeLuma(r, g, b) {
  const toLin = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}
function clearAudioStagePalette() {
  const stage = $('audioStage');
  if (!stage) return;
  ['--stage-accent', '--stage-accent-ink', '--stage-bg', '--stage-glow'].forEach((key) => {
    stage.style.removeProperty(key);
  });
  state.audioPaletteKey = '';
}
function applyAudioStagePalette(palette) {
  const stage = $('audioStage');
  if (!stage || !palette) {
    clearAudioStagePalette();
    return;
  }
  stage.style.setProperty('--stage-accent', palette.accent);
  stage.style.setProperty('--stage-accent-ink', palette.ink);
  stage.style.setProperty('--stage-bg', palette.bg);
  stage.style.setProperty('--stage-glow', palette.glow);
}
function paletteFromImage(img) {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  let data;
  try { data = ctx.getImageData(0, 0, size, size).data; }
  catch { return null; }
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const { h, s, l } = rgbToHsl(r, g, b);
    if (l < 0.08 || l > 0.92) continue;
    sumR += r; sumG += g; sumB += b; count += 1;
    const score = s * 1.35 + (1 - Math.abs(l - 0.45)) * 0.55;
    if (score > bestScore) {
      bestScore = score;
      best = { r, g, b, h, s, l };
    }
  }
  if (!count) return null;
  const avg = { r: sumR / count, g: sumG / count, b: sumB / count };
  const avgHsl = rgbToHsl(avg.r, avg.g, avg.b);
  const accentSrc = best && best.s > 0.12 ? best : { ...avg, ...avgHsl };
  const accentRgb = hslToRgb(
    accentSrc.h,
    Math.min(0.78, Math.max(0.38, accentSrc.s * 1.15 + 0.12)),
    Math.min(0.62, Math.max(0.42, accentSrc.l * 0.55 + 0.28))
  );
  const bgRgb = hslToRgb(
    avgHsl.h,
    Math.min(0.55, avgHsl.s * 0.7 + 0.12),
    Math.min(0.18, Math.max(0.08, avgHsl.l * 0.22 + 0.06))
  );
  const ink = relativeLuma(accentRgb.r, accentRgb.g, accentRgb.b) > 0.55
    ? '#1a120c'
    : '#fff8f2';
  const glowRgb = hslToRgb(
    accentSrc.h,
    Math.min(0.7, accentSrc.s * 0.9 + 0.2),
    Math.min(0.55, Math.max(0.35, accentSrc.l * 0.5 + 0.25))
  );
  return {
    accent: rgbCss(accentRgb.r, accentRgb.g, accentRgb.b),
    ink,
    bg: rgbCss(bgRgb.r, bgRgb.g, bgRgb.b),
    glow: `color-mix(in srgb, ${rgbCss(glowRgb.r, glowRgb.g, glowRgb.b)} 42%, transparent)`
  };
}
async function refreshAudioStagePalette(track, img) {
  const key = track?.path || track?.key || '';
  const token = ++state.audioPaletteToken;
  if (!key || !img) {
    clearAudioStagePalette();
    return;
  }
  if (state.audioPaletteKey === key && $('audioStage')?.style.getPropertyValue('--stage-accent')) return;
  const run = () => {
    if (token !== state.audioPaletteToken) return;
    if ((state.audioTrack?.path || state.audioTrack?.key || '') !== key) return;
    const palette = paletteFromImage(img);
    if (!palette) {
      clearAudioStagePalette();
      return;
    }
    state.audioPaletteKey = key;
    applyAudioStagePalette(palette);
  };
  if (img.complete && img.naturalWidth) run();
  else {
    await new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
    run();
  }
}
function paintAudioCover(el, track) {
  if (!el) return;
  const art = el.querySelector('.mini-cover-art') || el;
  const src = audioCoverUrl(track);
  const showFallback = () => {
    art.innerHTML = art.classList.contains('mini-cover-art')
      ? '♪'
      : '<span aria-hidden="true">♪</span>';
    if (el.id === 'audioStageArt') clearAudioStagePalette();
  };
  if (!src) {
    showFallback();
    return;
  }
  art.innerHTML = `<img alt="" src="${esc(src)}">`;
  const img = art.querySelector('img');
  if (!img) return;
  img.onerror = showFallback;
  if (el.id === 'audioStageArt') {
    refreshAudioStagePalette(track, img).catch(() => clearAudioStagePalette());
  }
}
function syncAudioStage() {
  const stage = $('audioStage');
  const track = state.audioTrack;
  if (!stage || stage.hidden || !track) return;
  if ($('audioStageTitle')) $('audioStageTitle').textContent = track.name || '音频';
  if ($('audioStageSub')) {
    const folder = track.path ? dirname(track.path).split(/[/\\]/).pop() : (track.parent || '');
    $('audioStageSub').textContent = folder || '';
  }
  paintAudioCover($('audioStageArt'), track);
  const vol = $('audioStageVol');
  if (vol) vol.value = String(state.audioVolume);
  syncMiniPlayButton();
  syncMiniProgress();
  syncMiniLoopButton();
  syncAudioDeleteUi();
}
function syncMiniPlayer() {
  const box = $('miniPlayer');
  const track = state.audioTrack;
  if (!box) return;
  if (!track) {
    box.hidden = true;
    closeAudioStage();
    clearMediaSession();
    return;
  }
  box.hidden = false;
  if ($('miniTitle')) $('miniTitle').textContent = track.name || '音频';
  if ($('miniSub')) {
    const folder = track.path ? dirname(track.path).split(/[/\\]/).pop() : (track.parent || '');
    $('miniSub').textContent = folder || '';
  }
  paintAudioCover($('miniCover'), track);
  syncMiniPlayButton();
  syncMiniProgress();
  syncMiniLoopButton();
  syncAudioStage();
  updateMediaSession();
  document.querySelectorAll('.card[data-file], .card[data-local-file]').forEach((card) => {
    const match = !!(
      (track.path && card.dataset.file && card.dataset.file === track.path)
      || (track.key && card.dataset.localFile && card.dataset.localFile === track.key)
    );
    card.classList.toggle('now-playing', match);
  });
}
function openAudioStage() {
  if (!state.audioTrack) return;
  const stage = $('audioStage');
  if (!stage) return;
  stage.hidden = false;
  document.body.classList.add('audio-stage-open');
  syncAudioStage();
}
function closeAudioStage() {
  const stage = $('audioStage');
  if (!stage) return;
  stage.hidden = true;
  document.body.classList.remove('audio-stage-open');
  closeAudioStageMenus();
  clearAudioStagePalette();
}
function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward'].forEach((action) => {
      try { navigator.mediaSession.setActionHandler(action, null); } catch { /* unsupported */ }
    });
  } catch { /* ok */ }
}
function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.audioTrack) return;
  const track = state.audioTrack;
  const folder = track.path ? dirname(track.path).split(/[/\\]/).pop() : (track.parent || '');
  const art = audioCoverUrl(track, true);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.name || '音频',
      artist: folder || 'Tricks Video',
      album: folder || '',
      artwork: art ? [
        { src: art, sizes: '512x512', type: 'image/jpeg' },
        { src: art, sizes: '256x256', type: 'image/jpeg' }
      ] : []
    });
  } catch { /* MediaMetadata unavailable */ }
  const bind = (action, handler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* ok */ }
  };
  bind('play', () => { const a = $('miniAudio'); if (a) a.play().catch(() => {}); });
  bind('pause', () => { const a = $('miniAudio'); if (a) a.pause(); });
  bind('previoustrack', () => playAudioRelative(-1));
  bind('nexttrack', () => playAudioRelative(1));
  bind('seekto', (details) => {
    const a = $('miniAudio');
    if (!a || details?.seekTime == null) return;
    try { a.currentTime = details.seekTime; } catch { /* ok */ }
  });
  bind('seekbackward', (details) => {
    const a = $('miniAudio');
    if (!a) return;
    try { a.currentTime = Math.max(0, a.currentTime - (details?.seekOffset || 10)); } catch { /* ok */ }
  });
  bind('seekforward', (details) => {
    const a = $('miniAudio');
    if (!a) return;
    try { a.currentTime = Math.min(a.duration || a.currentTime + 10, a.currentTime + (details?.seekOffset || 10)); } catch { /* ok */ }
  });
  const audio = $('miniAudio');
  if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime || 0, audio.duration)
      });
    } catch { /* ok */ }
  }
}
function prefetchAudioCache(track) {
  if (!track?.path) return;
  const key = track.path;
  if (state.audioCacheKey === key && state.audioCacheBlob) return;
  const token = ++state.audioPrefetchToken;
  const url = audioStreamUrl(track);
  fetch(url, { cache: 'force-cache', credentials: 'same-origin' })
    .then((res) => (res.ok ? res.blob() : Promise.reject()))
    .then((blob) => {
      if (token !== state.audioPrefetchToken) return;
      if (state.audioTrack?.path !== key) return;
      state.audioCacheBlob = blob;
      state.audioCacheKey = key;
    })
    .catch(() => {
      // Fallback: fill cache from network once (still shared with audio element via HTTP cache).
      if (token !== state.audioPrefetchToken) return;
      fetch(url, { cache: 'default', credentials: 'same-origin' })
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          if (!blob || token !== state.audioPrefetchToken) return;
          if (state.audioTrack?.path !== key) return;
          state.audioCacheBlob = blob;
          state.audioCacheKey = key;
        })
        .catch(() => {});
    });
}
async function downloadAudioCached() {
  const track = state.audioTrack;
  if (!track) return toast('没有正在播放的歌曲');
  try {
    let blob = null;
    if (state.audioBlobUrl && (track.kind === 'local' || track.handle)) {
      blob = await fetch(state.audioBlobUrl).then((r) => r.blob());
    } else if (state.audioCacheBlob && state.audioCacheKey === track.path) {
      blob = state.audioCacheBlob;
    } else if (track.path) {
      toast('正在从缓存取文件…');
      const url = audioStreamUrl(track);
      let res = await fetch(url, { cache: 'force-cache', credentials: 'same-origin' });
      if (!res.ok) res = await fetch(url, { cache: 'default', credentials: 'same-origin' });
      if (!res.ok) throw new Error('下载失败');
      blob = await res.blob();
      state.audioCacheBlob = blob;
      state.audioCacheKey = track.path;
    }
    if (!blob) throw new Error('没有可下载的数据');
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = track.name || 'audio';
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
    toast('已开始下载');
  } catch (err) {
    toast(err.message || '下载失败');
  }
}
function dropFileFromLists(filePath) {
  state.files = (state.files || []).filter((file) => file.path !== filePath);
  if (state.playlist?.length) state.playlist = state.playlist.filter((file) => file.path !== filePath);
  state.selected.delete(filePath);
}
async function softRemoveFile(filePath) {
  const main = $('main');
  const scroll = main?.scrollTop || 0;
  dropFileFromLists(filePath);
  if (state.audioTrack?.path === filePath) {
    const nextList = audioList();
    if (nextList.length) await openAudio(nextList[0]).catch(() => closeMiniPlayer());
    else closeMiniPlayer();
  }
  renderGrid();
  if (main) {
    main.scrollTop = scroll;
    requestAnimationFrame(() => { main.scrollTop = scroll; });
  }
  if (state.root) {
    api('/api/tree?' + qs({ path: state.root })).then((tree) => {
      state.tree = tree;
      renderSide();
    }).catch(() => {});
  }
}
function isCurrentAudioPendingDelete() {
  const pending = state.audioPendingDelete;
  const track = state.audioTrack;
  return !!(pending?.path && track?.path && pending.path === track.path);
}
function syncAudioDeleteUi() {
  const marked = isCurrentAudioPendingDelete();
  const btn = $('audioStageDeleteBtn');
  const stateEl = $('audioStageDeletedState');
  const badge = $('audioStageDeletedBadge');
  if (btn) btn.hidden = marked;
  if (stateEl) stateEl.hidden = !marked;
  if (badge) badge.hidden = !marked;
  $('audioStage')?.classList.toggle('is-pending-delete', marked);
}
function markAudioPendingDelete() {
  const track = state.audioTrack;
  if (!track?.path) return toast('当前没有可删除的文件');
  if (track.kind === 'local' || track.handle) return toast('本地文件暂不支持删除');
  state.audioPendingDelete = { path: track.path, name: track.name || '音频' };
  syncAudioDeleteUi();
  toast('已标记删除，切到下一首后才会真正删除');
}
function undoAudioPendingDelete() {
  if (!state.audioPendingDelete) return;
  state.audioPendingDelete = null;
  syncAudioDeleteUi();
  toast('已撤销删除');
}
async function commitAudioPendingDelete(keepPath) {
  const pending = state.audioPendingDelete;
  if (!pending?.path) return;
  if (keepPath && pending.path === keepPath) return;
  state.audioPendingDelete = null;
  syncAudioDeleteUi();
  const name = pending.name || pending.path.split(/[/\\]/).pop() || '文件';
  try {
    await api('/api/file/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pending.path })
    });
    dropFileFromLists(pending.path);
    renderGrid();
    if (state.root) {
      api('/api/tree?' + qs({ path: state.root })).then((tree) => {
        state.tree = tree;
        renderSide();
      }).catch(() => {});
    }
    toast(`已删除 ${name}`);
  } catch (err) {
    toast(err.message || '删除失败');
  }
}
async function openAudioDetail() {
  const track = state.audioTrack;
  if (!track) return;
  const audio = $('miniAudio');
  const time = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  if (audio && !audio.paused) audio.pause();
  syncMiniPlayButton();
  if (track.kind === 'local' || track.handle) {
    // Detail page needs its own blob URL; keep mini blob for resume if user comes back.
    releaseVideo();
    const blob = await track.handle.getFile();
    state.blobUrl = URL.createObjectURL(blob);
    state.player = { kind: 'local', ...track };
    showPlayerPage();
    updateChrome();
    const video = $('video');
    video.hidden = false;
    $('still').hidden = true;
    video.src = state.blobUrl;
    cuePlayback(video, time);
    await loadSidePanel();
    return;
  }
  // Open detail without routing back into mini player.
  releaseVideo();
  state.player = { kind: 'file', ...track };
  showPlayerPage();
  syncPinned();
  updateChrome();
  const video = $('video');
  video.hidden = false;
  $('still').hidden = true;
  video.src = audioStreamUrl(track) || ('/api/play?' + qs({ path: track.path }));
  cuePlayback(video, time);
  loadSubtitles(track.subtitles || []);
  await loadSidePanel();
  rememberHistory(track.path, track.name, time);
}
function clearAudioBlob() {
  if (state.audioBlobUrl) {
    URL.revokeObjectURL(state.audioBlobUrl);
    state.audioBlobUrl = '';
  }
}
function closeMiniPlayer() {
  const audio = $('miniAudio');
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    try { audio.load(); } catch { /* ok */ }
  }
  clearAudioBlob();
  state.audioTrack = null;
  state.audioCacheBlob = null;
  state.audioCacheKey = '';
  state.audioPrefetchToken += 1;
  closeAudioStage();
  clearMediaSession();
  syncMiniPlayer();
  commitAudioPendingDelete(null).catch((err) => toast(err.message));
}
async function openAudio(file, time) {
  if (!file) return;
  const nextPath = file.path || file.key || '';
  await commitAudioPendingDelete(nextPath);
  const main = $('video');
  if (main && !main.paused) main.pause();
  hideHover();
  clearAudioBlob();
  state.audioCacheBlob = null;
  state.audioCacheKey = '';
  state.audioPrefetchToken += 1;
  const audio = $('miniAudio');
  if (!audio) return;
  let src = '';
  if (file.kind === 'local' || file.handle) {
    const blob = await file.handle.getFile();
    state.audioBlobUrl = URL.createObjectURL(blob);
    state.audioCacheBlob = blob;
    state.audioCacheKey = file.path || file.key || '';
    src = state.audioBlobUrl;
    state.audioTrack = { kind: 'local', ...file };
  } else {
    src = audioStreamUrl(file);
    state.audioTrack = { kind: 'file', ...file };
  }
  // miniAudio is a hidden <video>: mute video plane, keep audio (needed for MP4).
  try { audio.muted = false; } catch { /* ok */ }
  try { audio.playsInline = true; } catch { /* ok */ }
  audio.loop = !!state.audioLoop;
  audio.volume = Math.min(1, Math.max(0, state.audioVolume));
  audio.preload = 'auto';
  audio.src = src;
  try { audio.load(); } catch { /* ok */ }
  state.audioInfoPath = '';
  state.audioScrubbing = false;
  state.audioPaletteKey = '';
  state.audioPaletteToken += 1;
  const at = Number(time) || 0;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    if (at > 0.05) {
      try { audio.currentTime = at; } catch { /* ok */ }
    }
    audio.play().catch((err) => toast(err?.message || '播放失败'));
    syncMiniPlayButton();
    updateMediaSession();
  };
  if (audio.readyState >= 1) start();
  else {
    audio.addEventListener('loadedmetadata', start, { once: true });
    audio.addEventListener('error', () => {
      const err = audio.error;
      toast(err?.message || '这个文件没法当音频播');
    }, { once: true });
  }
  audio.addEventListener('canplay', () => prefetchAudioCache(state.audioTrack), { once: true });
  syncMiniPlayer();
  syncAudioDeleteUi();
  if ($('audioStageInfoMenu') && !$('audioStageInfoMenu').hidden) {
    loadAudioStageInfo(true).catch(() => {});
  }
  if (file.path) rememberHistory(file.path, file.name, Number(time) || 0);
}
function syncMiniLoopButton() {
  const on = !!state.audioLoop;
  ['miniLoop', 'audioStageLoop'].forEach((id) => {
    const btn = $(id);
    if (!btn) return;
    btn.classList.toggle('on', on);
    btn.title = on ? '单曲循环：开' : '单曲循环：关';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const audio = $('miniAudio');
  if (audio) audio.loop = on;
}
function toggleMiniLoop() {
  state.audioLoop = !state.audioLoop;
  localStorage.setItem('tv2-audio-loop', state.audioLoop ? '1' : '0');
  syncMiniLoopButton();
  toast(state.audioLoop ? '单曲循环已开' : '单曲循环已关');
}
function toggleMiniPlay() {
  const audio = $('miniAudio');
  if (!audio || !state.audioTrack) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
  syncMiniPlayButton();
}
function playAudioRelative(step) {
  const list = audioList();
  const track = state.audioTrack;
  if (!track || !list.length) return;
  const key = track.path || track.key;
  const index = list.findIndex((item) => (item.path || item.key) === key);
  const next = list[(index + step + list.length) % list.length];
  if (next) openAudio(next).catch((err) => toast(err.message));
}
function seekAudioRatio(ratio, { commit = true } = {}) {
  const audio = $('miniAudio');
  if (!audio) return;
  const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
  if (!dur) return;
  const next = Math.min(1, Math.max(0, ratio)) * dur;
  paintAudioProgress(next, dur);
  if (!commit) return next;
  // Avoid tiny no-op seeks that still glitch the decoder.
  if (Math.abs((audio.currentTime || 0) - next) < 0.04) return next;
  try { audio.currentTime = next; } catch { /* ok */ }
  return next;
}
function seekAudioFromEvent(event, scrubEl, opts = {}) {
  const track = scrubEl || event.currentTarget;
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const clientX = event.clientX ?? event.touches?.[0]?.clientX;
  if (clientX == null) return;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return seekAudioRatio(ratio, opts);
}
function finishAudioScrub(el, event) {
  if (!state.audioScrubbing) return;
  state.audioScrubbing = false;
  el?.classList.remove('is-dragging');
  seekAudioFromEvent(event, el, { commit: true });
  const audio = $('miniAudio');
  const resume = state.audioScrubResume;
  state.audioScrubResume = false;
  updateMediaSession();
  if (!resume || !audio) {
    syncMiniPlayButton();
    return;
  }
  const play = () => {
    audio.play().catch(() => {});
    syncMiniPlayButton();
    updateMediaSession();
  };
  if (audio.seeking) audio.addEventListener('seeked', play, { once: true });
  else play();
}
function bindAudioScrub(el) {
  if (!el || el.dataset.scrubBound) return;
  el.dataset.scrubBound = '1';
  const onMove = (event) => {
    if (!state.audioScrubbing) return;
    // Paint only while dragging — commit once on release to avoid double-play glitch.
    seekAudioFromEvent(event, el, { commit: false });
  };
  const onUp = (event) => {
    if (!state.audioScrubbing) return;
    finishAudioScrub(el, event);
    try { el.releasePointerCapture?.(event.pointerId); } catch { /* ok */ }
  };
  el.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    const audio = $('miniAudio');
    state.audioScrubResume = !!(audio && !audio.paused && !audio.ended);
    if (state.audioScrubResume) {
      audio.pause();
      syncMiniPlayButton();
    }
    state.audioScrubbing = true;
    el.classList.add('is-dragging');
    try { el.setPointerCapture(event.pointerId); } catch { /* ok */ }
    seekAudioFromEvent(event, el, { commit: false });
  });
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('click', (event) => event.preventDefault());
}
function closeAudioInfoMenu() {
  const menu = $('audioStageInfoMenu');
  const btn = $('audioStageInfoBtn');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
function closeAudioStageMenus() {
  const volMenu = $('audioStageVolMenu');
  const volBtn = $('audioStageVolBtn');
  if (volMenu) volMenu.hidden = true;
  if (volBtn) volBtn.setAttribute('aria-expanded', 'false');
  closeAudioInfoMenu();
}
async function compressCurrentAudio(quality) {
  const track = state.audioTrack;
  if (!track?.path || track.kind === 'local' || track.handle) {
    toast('本地文件暂不支持压缩');
    return;
  }
  closeAudioStageMenus();
  try {
    const data = await startConvert('/api/convert/audio?' + qs({ path: track.path, quality: quality || '192k' }));
    const name = String(data.output || '').split(/[/\\]/).pop() || '完成';
    const sizeLabel = data.size != null ? formatSize(data.size) : '';
    toast(sizeLabel ? `压缩完成：${name}（${sizeLabel}）` : `压缩完成：${name}`);
    if (state.view === 'browse') await refreshBrowse().catch(() => {});
    const next = fileByPath(data.output);
    if (next && (await confirmAction('要播放压缩后的文件吗？', {
      ok: '播放',
      cancel: '不用',
      body: `<p class="confirm-path">${esc(name)}${sizeLabel ? ` · ${esc(sizeLabel)}` : ''}</p>`
    }))) {
      await openAudio(next);
    }
  } catch (err) {
    toast(err.message || '压缩失败');
  }
}
function renderAudioInfoBody(info, extra = {}) {
  const body = $('audioStageInfoBody');
  if (!body) return;
  if (!info) {
    body.innerHTML = `<div class="sub">${esc(extra.error || '暂无信息')}</div>`;
    return;
  }
  const bits = [
    infoRow('名称', info.name),
    infoRow('大小', info.size != null ? formatSize(info.size) : ''),
    infoRow('时长', info.duration ? formatDurationLong(info.duration) : ''),
    infoRow('格式', info.formatName || info.container || info.ext),
    infoRow('编码', info.audioCodec || info.audioCodecTag),
    infoRow('采样', info.sampleRate ? (info.sampleRate + ' Hz') : ''),
    infoRow('声道', info.channels ? (info.channels + (info.channelLayout ? `（${info.channelLayout}）` : '')) : ''),
    infoRow('码率', formatBitrate(info.audioBitrate || info.bitrate)),
    infoRow('路径', info.path)
  ].filter(Boolean);
  body.innerHTML = bits.length
    ? `<div class="info-grid">${bits.join('')}</div>`
    : '<div class="sub">没有可显示的元信息</div>';
}
async function loadAudioStageInfo(force = false) {
  const track = state.audioTrack;
  const body = $('audioStageInfoBody');
  if (!body) return;
  if (!track?.path) {
    renderAudioInfoBody(null, { error: '当前没有音频' });
    return;
  }
  if (!force && state.audioInfoPath === track.path && body.querySelector('.info-grid')) return;
  body.innerHTML = '<div class="sub">读取中…</div>';
  state.audioInfoPath = track.path;
  try {
    const info = await api('/api/file-info?' + qs({ path: track.path }));
    if (state.audioTrack?.path !== track.path) return;
    renderAudioInfoBody(info);
  } catch (err) {
    if (state.audioTrack?.path !== track.path) return;
    renderAudioInfoBody({
      name: track.name,
      path: track.path,
      size: track.size,
      type: 'audio',
      ext: track.ext
    }, { error: err.message });
    if (err?.message) toast(err.message);
  }
}
async function toggleAudioInfoMenu() {
  const menu = $('audioStageInfoMenu');
  const btn = $('audioStageInfoBtn');
  if (!menu || !btn) return;
  const open = menu.hidden;
  if (open) {
    closeAudioStageMenus();
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    await loadAudioStageInfo();
  } else {
    closeAudioInfoMenu();
  }
}
function vttSeconds(stamp) {
  const clean = String(stamp || '').trim().split(/\s+/)[0].replace(',', '.');
  const bits = clean.split(':');
  let seconds = parseFloat(bits.pop());
  if (bits.length) seconds += parseInt(bits.pop(), 10) * 60;
  if (bits.length) seconds += parseInt(bits.pop(), 10) * 3600;
  return Number.isFinite(seconds) ? seconds : 0;
}
function parseVtt(text) {
  const cues = [];
  const body = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
  for (const block of body.split(/\n{2,}/)) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const index = lines.findIndex((line) => line.includes('-->'));
    if (index < 0) continue;
    const [start, end] = lines[index].split('-->');
    const caption = lines.slice(index + 1).join('\n').replace(/<[^>]+>/g, '');
    if (!caption) continue;
    cues.push({ start: vttSeconds(start), end: vttSeconds(end), text: caption });
  }
  return cues;
}
async function loadSubtitles(list) {
  state.subs = list || [];
  state.cues = [];
  const select = $('subSelect');
  if (select) {
    select.hidden = state.subs.length < 2;
    select.innerHTML = state.subs.map((sub, index) => `<option value="${index}">${esc(sub.name)}</option>`).join('');
  }
  if (!state.subs.length) return;
  await loadSubtitleFile(state.subs[0]);
}
async function loadSubtitleFile(sub) {
  if (!sub) return;
  try {
    const text = await fetch('/api/subtitle?' + qs({ path: sub.path })).then((response) => response.text());
    state.cues = parseVtt(text);
    showCue($('video').currentTime || 0);
  } catch { state.cues = []; }
}
function showCue(time) {
  const overlay = $('subOverlay');
  if (!overlay) return;
  const cue = state.cues.find((item) => time >= item.start && time <= item.end);
  overlay.textContent = cue ? cue.text : '';
}
const CARD_DEFAULTS = { size: 280, ratio: 56, ui: 'out', fit: 'contain', thumbTime: 1 };
function normalizeCardPrefs(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    size: Math.min(560, Math.max(160, Number(src.size) || CARD_DEFAULTS.size)),
    ratio: Math.min(200, Math.max(50, Number(src.ratio) || CARD_DEFAULTS.ratio)),
    ui: src.ui === 'in' ? 'in' : 'out',
    fit: src.fit === 'cover' || src.fit === 'fit' ? 'cover' : 'contain',
    thumbTime: Math.min(180, Math.max(0, Number(src.thumbTime ?? src.time) || CARD_DEFAULTS.thumbTime)),
    source: src.source || '',
    from: src.from || ''
  };
}
function readLegacyCardPrefs(folder) {
  try {
    const map = JSON.parse(localStorage.getItem('tv2-card-prefs') || '{}');
    if (folder && map[folder]) return normalizeCardPrefs(map[folder]);
    if (map['*']) return normalizeCardPrefs(map['*']);
    const size = Number(localStorage.getItem('tv2-card-size'));
    const ratio = Number(localStorage.getItem('tv2-card-ratio'));
    if (size || ratio) return normalizeCardPrefs({ size, ratio });
  } catch { /* ignore */ }
  return null;
}
function clearLegacyCardPrefs() {
  localStorage.removeItem('tv2-card-prefs');
  localStorage.removeItem('tv2-card-size');
  localStorage.removeItem('tv2-card-ratio');
}
function readLocalCardPrefsMap() {
  try { return JSON.parse(localStorage.getItem('tv2-card-prefs') || '{}'); } catch { return {}; }
}
function saveLocalCardPrefs(folder, prefs) {
  if (!folder) return;
  const map = readLocalCardPrefsMap();
  map[folder] = {
    size: prefs.size,
    ratio: prefs.ratio,
    ui: prefs.ui,
    fit: prefs.fit,
    thumbTime: prefs.thumbTime
  };
  localStorage.setItem('tv2-card-prefs', JSON.stringify(map));
}
function readCardPrefs() {
  return normalizeCardPrefs(state.cardPrefs || CARD_DEFAULTS);
}
function snapshotCardPrefs() {
  const current = readCardPrefs();
  return { size: current.size, ratio: current.ratio, ui: current.ui, fit: current.fit, thumbTime: current.thumbTime };
}
async function loadCardPrefs(folder) {
  if (!folder) {
    state.cardPrefs = { ...CARD_DEFAULTS };
    return state.cardPrefs;
  }
  // Clean mode: never write .tv2-card.json; prefs live in this browser only.
  if (noSidecars()) {
    const local = readLegacyCardPrefs(folder);
    if (local) {
      state.cardPrefs = normalizeCardPrefs({ ...local, source: 'local', from: folder });
      state.thumbTime = state.cardPrefs.thumbTime;
      return state.cardPrefs;
    }
    const remote = normalizeCardPrefs(await api('/api/card-prefs?' + qs({ path: folder })).catch(() => CARD_DEFAULTS));
    state.cardPrefs = remote;
    state.thumbTime = remote.thumbTime;
    return remote;
  }
  let prefs = normalizeCardPrefs(await api('/api/card-prefs?' + qs({ path: folder })).catch(() => CARD_DEFAULTS));
  if (prefs.source === 'default' || prefs.source === 'legacy') {
    const legacy = readLegacyCardPrefs(folder);
    if (legacy) {
      prefs = await api('/api/card-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folder, ...legacy, thumbTime: prefs.thumbTime || legacy.thumbTime })
      }).then((data) => normalizeCardPrefs(data.prefs || legacy)).catch(() => legacy);
      clearLegacyCardPrefs();
    } else if (prefs.source === 'legacy') {
      await api('/api/card-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folder, ...prefs })
      }).catch(() => {});
    }
  }
  state.cardPrefs = prefs;
  return prefs;
}
async function writeCardPrefs(partial, folder = state.folder) {
  if (!folder) return toast('先打开一个文件夹');
  const next = normalizeCardPrefs({ ...readCardPrefs(), ...partial, thumbTime: partial.thumbTime ?? state.thumbTime });
  state.cardPrefs = next;
  state.thumbTime = next.thumbTime;
  applyCardPrefs(next);
  if (noSidecars()) {
    saveLocalCardPrefs(folder, next);
    return;
  }
  try {
    const data = await api('/api/card-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folder, ...next })
    });
    state.cardPrefs = normalizeCardPrefs(data.prefs || next);
  } catch (err) { toast(err.message); }
}
async function applyCardPrefsToSubfolders() {
  const base = state.folder;
  if (!base) return toast('先打开一个文件夹');
  if (noSidecars()) return toast('已开启「禁止导出拉屎」，不会写入子文件夹的 .tv2-card.json');
  const prefs = snapshotCardPrefs();
  try {
    const data = await api('/api/card-prefs/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: base, ...prefs })
    });
    state.cardPrefs = normalizeCardPrefs(data.prefs || prefs);
    applyCardPrefs(state.cardPrefs);
    toast('已写入全部子文件夹（' + (data.count || 0) + ' 个 .tv2-card.json）');
  } catch (err) { toast(err.message); }
}
async function applyCardPrefsToAll() {
  const base = state.root || state.folder;
  if (!base) return toast('先打开资料库');
  if (noSidecars()) return toast('已开启「禁止导出拉屎」，不会写入资料库的 .tv2-card.json');
  const prefs = snapshotCardPrefs();
  try {
    const data = await api('/api/card-prefs/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: base, ...prefs })
    });
    state.cardPrefs = normalizeCardPrefs(data.prefs || prefs);
    applyCardPrefs(state.cardPrefs);
    toast('已写入资料库全部文件夹（' + (data.count || 0) + ' 个 .tv2-card.json）');
  } catch (err) { toast(err.message); }
}
function refreshCovers() {
  state.coverStamp = Date.now();
  renderGrid();
  renderFolderHead();
  toast('封面已刷新');
}
function cardRatioLabel(heightPct) {
  const h = Number(heightPct) || 56;
  if (h <= 58) return '16:9';
  if (h <= 72) return '3:2';
  if (h <= 85) return '4:3';
  if (h <= 110) return '1:1';
  if (h <= 145) return '3:4';
  if (h <= 185) return '9:16';
  return '9:19';
}
function applyCardSize(px) {
  const size = Math.min(560, Math.max(160, Number(px) || 280));
  document.documentElement.style.setProperty('--card-min', size + 'px');
  if ($('cardSize')) $('cardSize').value = size;
  if ($('cardSizeLabel')) $('cardSizeLabel').textContent = size + 'px';
}
function applyCardRatio(heightPct) {
  const h = Math.min(200, Math.max(50, Number(heightPct) || 56));
  document.documentElement.style.setProperty('--card-ratio', `100 / ${h}`);
  if ($('cardRatio')) $('cardRatio').value = h;
  if ($('cardRatioLabel')) $('cardRatioLabel').textContent = cardRatioLabel(h);
}
function applyCardUi(ui) {
  const mode = ui === 'in' ? 'in' : 'out';
  document.documentElement.dataset.cardUi = mode;
  if ($('cardUiSeg')) {
    $('cardUiSeg').querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.ui === mode);
    });
  }
}
function applyCardFit(fit) {
  const mode = fit === 'cover' || fit === 'fit' ? 'cover' : 'contain';
  document.documentElement.dataset.cardFit = mode;
  if ($('cardFitSeg')) {
    $('cardFitSeg').querySelectorAll('button').forEach((btn) => {
      const value = btn.dataset.fit === 'fit' ? 'cover' : btn.dataset.fit;
      btn.classList.toggle('active', value === mode);
    });
  }
}
function applyCardPrefs(prefs = readCardPrefs()) {
  applyCardSize(prefs.size);
  applyCardRatio(prefs.ratio);
  applyCardUi(prefs.ui);
  applyCardFit(prefs.fit);
}
function renderCardPrefs() {
  const prefs = readCardPrefs();
  const pop = $('cardPrefsPop');
  pop.innerHTML = `
    <div class="help-title">当前文件夹卡片</div>
    <div class="card-prefs-row">
      <span>封面秒数</span>
      <label class="slider">
        <input id="thumbSlider" type="range" min="0" max="180" value="${state.thumbTime}">
        <span id="thumbLabel">${state.thumbTime}s</span>
      </label>
    </div>
    <div class="card-prefs-row">
      <span>卡片大小</span>
      <label class="slider">
        <input id="cardSize" type="range" min="160" max="560" value="${prefs.size}">
        <span id="cardSizeLabel">${prefs.size}px</span>
      </label>
    </div>
    <div class="card-prefs-row">
      <span>卡片比例</span>
      <label class="slider">
        <input id="cardRatio" type="range" min="50" max="200" value="${prefs.ratio}">
        <span id="cardRatioLabel">${cardRatioLabel(prefs.ratio)}</span>
      </label>
    </div>
    <div class="help-title">文字位置</div>
    <div class="seg" id="cardUiSeg" style="margin: 4px 8px 10px;">
      <button type="button" data-ui="out" class="${prefs.ui !== 'in' ? 'active' : ''}">图片外</button>
      <button type="button" data-ui="in" class="${prefs.ui === 'in' ? 'active' : ''}">图片内</button>
    </div>
    <div class="help-title">图片显示</div>
    <div class="seg" id="cardFitSeg" style="margin: 4px 8px 10px;">
      <button type="button" data-fit="contain" class="${(prefs.fit || 'contain') !== 'cover' && prefs.fit !== 'fit' ? 'active' : ''}">Contain</button>
      <button type="button" data-fit="fit" class="${prefs.fit === 'cover' || prefs.fit === 'fit' ? 'active' : ''}">Fit</button>
    </div>
    <div class="card-prefs-actions">
      <button class="text-btn" id="cardPrefsRefreshCovers" type="button">刷新封面</button>
      <button class="solid-btn" id="cardPrefsApplySubs" type="button">应用到全部子文件夹</button>
      <button class="text-btn" id="cardPrefsApplyAll" type="button">应用到资料库全部</button>
    </div>
    <div class="sub" style="margin: 4px 8px 2px;">${noSidecars()
      ? '已开启「禁止导出拉屎」：设置只保存在本浏览器，不写 .tv2-card.json'
      : '设置保存在文件夹下的 .tv2-card.json'}</div>
  `;
  $('thumbSlider').oninput = () => {
    state.thumbTime = Number($('thumbSlider').value);
    $('thumbLabel').textContent = state.thumbTime + 's';
    clearTimeout(state._thumbTimer);
    state._thumbTimer = setTimeout(() => {
      writeCardPrefs({ thumbTime: state.thumbTime }).then(() => {
        state.coverStamp = Date.now();
        renderGrid();
      });
    }, 400);
  };
  $('cardSize').oninput = () => {
    const size = Number($('cardSize').value);
    applyCardSize(size);
    clearTimeout(state._cardSizeTimer);
    state._cardSizeTimer = setTimeout(() => writeCardPrefs({ size }), 250);
  };
  $('cardRatio').oninput = () => {
    const ratio = Number($('cardRatio').value);
    applyCardRatio(ratio);
    clearTimeout(state._cardRatioTimer);
    state._cardRatioTimer = setTimeout(() => writeCardPrefs({ ratio }), 250);
  };
  $('cardUiSeg').onclick = (event) => {
    const button = event.target.closest('[data-ui]');
    if (!button) return;
    writeCardPrefs({ ui: button.dataset.ui });
  };
  $('cardFitSeg').onclick = (event) => {
    const button = event.target.closest('[data-fit]');
    if (!button) return;
    writeCardPrefs({ fit: button.dataset.fit === 'fit' ? 'cover' : 'contain' });
  };
  $('cardPrefsRefreshCovers').onclick = () => refreshCovers();
  $('cardPrefsApplySubs').onclick = () => applyCardPrefsToSubfolders();
  $('cardPrefsApplyAll').onclick = () => applyCardPrefsToAll();
}
let previewToken = 0;
let previewBlob = '';
let hoverCard = null;
let hoverPath = '';
let hoverTimer = 0;
let hoverHideTimer = 0;
let scrubDrag = false;
let previewMoved = false;
let boxDrag = null;
function stickyPreview() {
  return previewMode() === 'key' && !previewHolding;
}
function previewOpen() {
  const box = $('hoverPreview');
  return !!(box && !box.hidden && box.classList.contains('show'));
}
function syncHoverSound() {
  const video = $('hoverVideo');
  const on = localStorage.getItem('tv2-preview-sound') === '1';
  video.muted = !on;
  $('hoverSound').textContent = on ? '声音开 M' : '声音关 M';
  $('hoverSound').title = '按 M 切换静音';
  if ($('hoverContinue')) $('hoverContinue').title = '按 O 打开视频';
}
function previewMode() {
  const mode = localStorage.getItem('tv2-preview-mode');
  if (mode === 'hover' || mode === 'key') return mode;
  if (mode === 'click' || mode === 'hold' || mode === 'space' || mode === 'ctrl') return 'key';
  return 'key';
}
function previewHotkey() {
  try {
    const raw = JSON.parse(localStorage.getItem('tv2-preview-hotkey') || '');
    if (raw && (raw.code || raw.key)) return raw;
  } catch { /* use defaults */ }
  const old = localStorage.getItem('tv2-preview-mode');
  if (old === 'ctrl') return { code: 'ControlLeft', key: 'Control' };
  return { code: 'Space', key: ' ' };
}
function previewHotkeyLabel(hotkey = previewHotkey()) {
  const code = hotkey.code || '';
  const key = hotkey.key || '';
  if (code === 'Space' || key === ' ') return '空格';
  if (key === 'Control' || code.startsWith('Control')) return 'Ctrl';
  if (key === 'Meta' || code.startsWith('Meta')) return 'Meta';
  if (key === 'Alt' || code.startsWith('Alt')) return 'Alt';
  if (key === 'Shift' || code.startsWith('Shift')) return 'Shift';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowRight') return '→';
  if (key === 'Escape') return 'Esc';
  if (/^F\d+$/i.test(key)) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  return key || code || '未设置';
}
function matchesPreviewHotkey(event) {
  const hot = previewHotkey();
  const key = hot.key || '';
  const code = hot.code || '';
  if (key === 'Control' || code.startsWith('Control')) return event.key === 'Control' || String(event.code || '').startsWith('Control');
  if (key === 'Meta' || code.startsWith('Meta')) return event.key === 'Meta' || String(event.code || '').startsWith('Meta');
  if (key === 'Alt' || code.startsWith('Alt')) return event.key === 'Alt' || String(event.code || '').startsWith('Alt');
  if (key === 'Shift' || code.startsWith('Shift')) return event.key === 'Shift' || String(event.code || '').startsWith('Shift');
  if (code && event.code === code) return true;
  if (key && event.key === key) return true;
  return false;
}
function togglePreviewHotkey() {
  if ($('player').hidden === false) return false;
  if (previewOpen()) {
    hideHover();
    return true;
  }
  if (!pointerCard) return false;
  scheduleHover(pointerCard, { force: true });
  return true;
}
let capturingHotkey = false;
let previewHoldTimer = 0;
let previewHolding = false;
let previewKeyDownAt = 0;
function stopHoverVideo() {
  const video = $('hoverVideo');
  video.pause();
  video.onloadedmetadata = null;
  video.ontimeupdate = null;
  video.onplaying = null;
  video.removeAttribute('src');
  video.dataset.src = '';
  try { video.load(); } catch { /* ok */ }
  if (previewBlob) { URL.revokeObjectURL(previewBlob); previewBlob = ''; }
  hoverPath = '';
  if ($('hoverFill')) $('hoverFill').style.width = '0';
  if ($('hoverBuf')) $('hoverBuf').style.width = '0';
  if ($('hoverHint')) { $('hoverHint').hidden = true; $('hoverHint').innerHTML = ''; }
}
function hideHover() {
  clearTimeout(hoverTimer);
  clearTimeout(hoverHideTimer);
  clearTimeout(previewHoldTimer);
  hoverCard = null;
  scrubDrag = false;
  previewHolding = false;
  previewMoved = false;
  boxDrag = null;
  previewToken += 1;
  const box = $('hoverPreview');
  box.classList.remove('show', 'hint-only', 'dragging');
  box.hidden = true;
  stopHoverVideo();
}
function closePreviewNow() { hideHover(); }
function placeHover(card, size) {
  const box = $('hoverPreview');
  const rect = card.getBoundingClientRect();
  const gap = 10;
  const margin = 10;
  const spaceRight = Math.max(0, window.innerWidth - rect.right - gap - margin);
  const spaceLeft = Math.max(0, rect.left - gap - margin);
  const placeRight = spaceRight >= spaceLeft;
  const maxW = Math.max(96, Math.floor(placeRight ? spaceRight : spaceLeft));
  const maxH = Math.max(72, window.innerHeight - margin * 2);
  let w = size.w;
  let h = size.h;
  if (size.fit) {
    const scale = Math.min(1, maxW / w, maxH / h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  } else {
    w = Math.min(w, maxW);
  }
  box.style.width = w + 'px';
  box.style.height = size.fit ? h + 'px' : 'auto';
  if (!previewMoved) {
    let top = rect.top + (rect.height - h) / 2;
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - margin - h));
    const left = placeRight ? rect.right + gap : rect.left - gap - w;
    box.style.left = Math.round(Math.max(margin, left)) + 'px';
    box.style.top = Math.round(top) + 'px';
  }
}
function revealHover(card, size) {
  const box = $('hoverPreview');
  placeHover(card, size);
  box.hidden = false;
  box.classList.toggle('movable', stickyPreview());
  requestAnimationFrame(() => {
    if (hoverCard === card) box.classList.add('show');
  });
}
function syncHoverBar() {
  const video = $('hoverVideo');
  const dur = video.duration;
  if (!dur || !isFinite(dur) || scrubDrag) return;
  $('hoverFill').style.width = ((video.currentTime / dur) * 100) + '%';
  let end = 0;
  for (let i = 0; i < video.buffered.length; i++) end = Math.max(end, video.buffered.end(i));
  $('hoverBuf').style.width = ((end / dur) * 100) + '%';
}
function scrubAt(event) {
  const video = $('hoverVideo');
  const dur = video.duration;
  if (!dur || !isFinite(dur)) return;
  const rect = $('hoverScrub').getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1)));
  const t = ratio * dur;
  $('hoverFill').style.width = (ratio * 100) + '%';
  try { video.currentTime = t; } catch { /* not ready */ }
}
function showHoverHint(card, title, detail) {
  const box = $('hoverPreview');
  stopHoverVideo();
  box.classList.add('hint-only');
  $('hoverHint').hidden = false;
  $('hoverHint').innerHTML = `${esc(title)}<small>${esc(detail || '')}</small>`;
  revealHover(card, { w: 210, h: 88, fit: false });
}
function showHover(card, media) {
  const box = $('hoverPreview');
  const video = $('hoverVideo');
  box.classList.remove('hint-only');
  $('hoverHint').hidden = true;
  $('hoverHint').innerHTML = '';
  hoverPath = media.path || '';
  $('hoverFill').style.width = '0';
  $('hoverBuf').style.width = '0';
  syncHoverSound();
  video.loop = true;
  video.playbackRate = 1;
  const ready = () => {
    if (hoverCard !== card || video.dataset.src !== media.src) return;
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    revealHover(card, { w: vw, h: vh, fit: true });
  };
  video.ontimeupdate = syncHoverBar;
  video.onloadedmetadata = ready;
  if (video.dataset.src !== media.src) {
    video.dataset.src = media.src;
    video.src = media.src;
  } else if (video.videoWidth) ready();
  video.play().catch(() => {});
}
function fileExt(name) {
  const match = String(name || '').match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}
function hoverMedia(card) {
  if (card.dataset.file) {
    const file = fileByPath(card.dataset.file);
    if (!file || fileKind(file) === 'image' || fileKind(file) === 'audio') return null;
    if (fileExt(file.name) === 'mkv') return { blocked: 'mkv', name: file.name };
    return { src: '/api/play?' + qs({ path: file.path }), path: file.path, name: file.name };
  }
  if (card.dataset.trick) {
    const trick = state.tricks.find((item) => item.id === card.dataset.trick);
    if (!trick || !trick.videoPath || trick.mediaType === 'gif') return null;
    if (fileExt(trick.name || trick.videoPath) === 'mkv') return { blocked: 'mkv', name: trick.name };
    return { src: trick.videoPath, path: '', name: trick.name };
  }
  return null;
}
function previewClock() {
  return $('hoverVideo').currentTime || 0;
}
async function continueFromPreview(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const card = hoverCard;
  if (!card || $('hoverPreview').classList.contains('hint-only')) return;
  const time = previewClock();
  if (card.dataset.file) {
    const file = fileByPath(card.dataset.file);
    if (file) openFile(file, time).catch((err) => toast(err.message));
  } else if (card.dataset.trick) {
    const trick = state.tricks.find((item) => item.id === card.dataset.trick);
    if (trick) openTrick(trick, time);
  } else if (card.dataset.localFile) {
    const file = (state.local.files || []).find((item) => item.key === card.dataset.localFile);
    if (file) openLocalFile(file, time).catch((err) => toast(err.message));
  }
}
function scheduleHover(card, event) {
  const forced = !!(event && event.force);
  const mode = previewMode();
  if (mode === 'hover') {
    /* open on hover */
  } else if (!forced) return;
  if (hoverCard === card && previewOpen()) return;
  hoverCard = card;
  clearTimeout(hoverTimer);
  clearTimeout(hoverHideTimer);
  const token = ++previewToken;
  hoverTimer = setTimeout(async () => {
    if (hoverCard !== card) return;
    let media = hoverMedia(card);
    if (!media && card.dataset.localFile) {
      const file = (state.local.files || []).find((item) => item.key === card.dataset.localFile);
      if (file && file.type !== 'image') {
        if (fileExt(file.name) === 'mkv') media = { blocked: 'mkv', name: file.name };
        else {
          const blob = await file.handle.getFile();
          media = { src: URL.createObjectURL(blob), path: '', name: file.name };
        }
      }
    }
    if (hoverCard !== card || token !== previewToken) {
      if (media && media.src && String(media.src).startsWith('blob:')) URL.revokeObjectURL(media.src);
      return;
    }
    if (!media) { hideHover(); return; }
    if (media.blocked === 'mkv') {
      showHoverHint(card, 'MKV 悬停无效果', '浏览器没法直接预览 MKV，点进播放页看。');
      return;
    }
    if (String(media.src).startsWith('blob:')) {
      if (previewBlob) URL.revokeObjectURL(previewBlob);
      previewBlob = media.src;
    }
    showHover(card, media);
  }, forced ? 0 : 140);
}
let pointerCard = null;
function bindHover(root) {
  root.addEventListener('mouseover', (event) => {
    const card = event.target.closest('[data-file], [data-trick], [data-local-file]');
    if (!card || !root.contains(card)) return;
    if (event.target.closest('.card-tag')) return;
    pointerCard = card;
    scheduleHover(card, event);
  });
  root.addEventListener('mouseout', (event) => {
    if (scrubDrag) return;
    const card = event.target.closest('[data-file], [data-trick], [data-local-file]');
    if (!card) return;
    const next = event.relatedTarget;
    if (next && (card.contains(next) || $('hoverPreview').contains(next))) return;
    if (pointerCard === card) pointerCard = null;
    if (previewMode() === 'key' && !previewHolding) return;
    clearTimeout(hoverTimer);
    hoverHideTimer = setTimeout(() => {
      if ($('hoverPreview').matches(':hover')) return;
      if (hoverCard === card && card.matches(':hover')) return;
      if (previewMode() === 'key' && !previewHolding) return;
      hideHover();
    }, 160);
  });
}
function bindRightHold(target) {
  const video = $('video');
  let timer = 0;
  let holding = false;
  let suppressMenu = false;
  let previous = 1;
  const indicator = $('speedIndicator');
  target.addEventListener('mousedown', (event) => {
    if (event.button !== 2 || event.target.closest('button, select, a')) return;
    previous = video.playbackRate || 1;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      holding = true;
      suppressMenu = true;
      video.playbackRate = 2;
      if (video.paused) video.play().catch(() => {});
      $('rateBtn').textContent = '2x';
      indicator.hidden = false;
      indicator.textContent = '2x 倍速';
    }, 180);
  });
  const end = (event) => {
    if (event && event.button != null && event.button !== 2) return;
    clearTimeout(timer);
    timer = 0;
    if (!holding) return;
    holding = false;
    suppressMenu = true;
    video.playbackRate = previous;
    $('rateBtn').textContent = previous >= 2 ? '2x' : '1x';
    $('rateBtn').classList.toggle('on', previous >= 2);
    indicator.hidden = true;
  };
  window.addEventListener('mouseup', end);
  target.addEventListener('contextmenu', (event) => {
    if (suppressMenu) {
      event.preventDefault();
      suppressMenu = false;
    }
  });
}
function openListItem(item, time) {
  if (!item) return;
  if (item.videoPath || item.kind === 'trick' || state.view === 'library' && item.id && !item.path) openTrick(item, time);
  else if (state.view === 'local' || item.handle) openLocalFile(item, time);
  else openFile(item, time);
}
function playRelative(step) {
  const list = currentList();
  if (!state.player || !list.length) return;
  const key = itemKey(state.player);
  const index = list.findIndex((item) => itemKey(item) === key);
  if (step < 0 && state.shuffle && state.shuffleBack.length) {
    openListItem(state.shuffleBack.pop());
    return;
  }
  let next;
  if (step > 0 && state.shuffle && list.length > 1) {
    if (!(state.shuffleSeen instanceof Set)) state.shuffleSeen = new Set();
    if (key) state.shuffleSeen.add(key);
    let pool = list.filter((item) => {
      const k = itemKey(item);
      return k && k !== key && !state.shuffleSeen.has(k);
    });
    // Finish the whole folder once before any repeats.
    if (!pool.length) {
      state.shuffleSeen = new Set(key ? [key] : []);
      pool = list.filter((item) => {
        const k = itemKey(item);
        return k && k !== key;
      });
    }
    next = pool[Math.floor(Math.random() * pool.length)] || list[(index + 1 + list.length) % list.length];
    if (index >= 0) state.shuffleBack.push(list[index]);
    if (state.shuffleBack.length > list.length) state.shuffleBack = state.shuffleBack.slice(-list.length);
  } else {
    next = list[(index + step + list.length) % list.length];
  }
  openListItem(next);
}

function infoRow(label, value) {
  if (value == null || value === '' || value === '—') return '';
  return `<div class="info-row"><span>${esc(label)}</span><b title="${esc(String(value))}">${esc(String(value))}</b></div>`;
}
function renderInfoBody(info, extra = {}) {
  const body = $('infoBody');
  if (!body) return;
  if (!info) {
    body.innerHTML = `<div class="sub">${esc(extra.error || '暂无信息')}</div>`;
    return;
  }
  const res = (info.width && info.height) ? `${info.width} × ${info.height}` : '';
  const bits = [
    infoRow('名称', info.name),
    infoRow('路径', info.path),
    infoRow('类型', info.type === 'image' ? '图片' : (info.type === 'audio' ? '音频' : (info.type === 'video' ? '视频' : (info.ext || '')))),
    infoRow('大小', info.size != null ? formatSize(info.size) : ''),
    infoRow('时长', info.duration ? formatDurationLong(info.duration) : ''),
    infoRow('分辨率', res),
    infoRow('帧率', info.fps ? (info.fps + ' fps') : ''),
    infoRow('总码率', formatBitrate(info.bitrate)),
    infoRow('容器', info.formatName || info.container),
    infoRow('视频编码', info.videoCodec || info.videoCodecTag),
    infoRow('像素格式', info.pixFmt),
    infoRow('音频编码', info.audioCodec || info.audioCodecTag),
    infoRow('音频采样', info.sampleRate ? (info.sampleRate + ' Hz') : ''),
    infoRow('声道', info.channels ? (info.channels + (info.channelLayout ? `（${info.channelLayout}）` : '')) : ''),
    infoRow('音频码率', formatBitrate(info.audioBitrate)),
    infoRow('流数量', info.streamCount || ''),
    infoRow('创建时间', formatInfoTime(info.birthtime)),
    infoRow('修改时间', formatInfoTime(info.mtime))
  ].filter(Boolean);
  body.innerHTML = bits.length
    ? `<div class="info-grid">${bits.join('')}</div>`
    : '<div class="sub">没有可显示的元信息</div>';
}
async function loadVideoInfo() {
  const body = $('infoBody');
  const player = state.player;
  if (!body) return;
  if (!player) {
    renderInfoBody(null, { error: '当前没有打开的视频' });
    return;
  }
  body.innerHTML = '<div class="sub">读取中…</div>';
  if (player.kind === 'file' && player.path) {
    try {
      const info = await api('/api/file-info?' + qs({ path: player.path }));
      renderInfoBody(info);
    } catch (err) {
      // Fallback to list metadata + HTML video element.
      const file = state.files.find((row) => row.path === player.path);
      const vid = $('video');
      renderInfoBody({
        name: player.name,
        path: player.path,
        type: player.type || file?.type || 'video',
        size: file?.size,
        birthtime: file?.birthtime,
        duration: vid?.duration || 0,
        width: vid?.videoWidth || 0,
        height: vid?.videoHeight || 0
      });
      if (err?.message) toast(err.message);
    }
    return;
  }
  if (player.kind === 'trick') {
    const vid = $('video');
    renderInfoBody({
      name: player.name,
      path: player.path || '',
      type: 'video',
      size: player.fileSize,
      duration: vid?.duration || 0,
      width: vid?.videoWidth || 0,
      height: vid?.videoHeight || 0
    });
    return;
  }
  const vid = $('video');
  renderInfoBody({
    name: player.name,
    path: player.path || player.key || '',
    type: player.type || 'video',
    duration: vid?.duration || 0,
    width: vid?.videoWidth || 0,
    height: vid?.videoHeight || 0
  });
}
async function toggleInfoSection() {
  const section = $('infoSection');
  if (!section) return;
  const show = !section.classList.contains('show');
  section.classList.toggle('show', show);
  if (show) await loadVideoInfo();
}

async function loadSidePanel() {
  const player = state.player;
  if (!player) return;
  if ($('infoSection')?.classList.contains('show')) loadVideoInfo();
  if (player.kind === 'file') {
    const notes = await api('/api/notes?' + qs({ path: player.path })).catch(() => ({ text: '' }));
    $('notes').value = notes.text || '';
    state.clips = await api('/api/clips?' + qs({ path: player.path })).catch(() => []);
  } else if (player.kind === 'trick') {
    $('notes').value = player.notes || '';
    state.clips = player.clips || [];
  } else {
    $('notes').value = localNote(player.key);
    state.clips = localClips(player.key);
  }
  renderClips();
}

function renderClips() {
  if (state.loopClipId && !state.clips.some((clip) => clip.id === state.loopClipId)) {
    state.loopClipId = null;
  }
  $('clipList').innerHTML = state.clips.map((clip) => `
    <div class="clip-item${state.loopClipId === clip.id ? ' on' : ''}">
      <button class="text-btn" type="button" data-jump="${clip.id}" title="点击循环此片段，再点取消">${esc(clip.name)} · ${clock(clip.startTime)}-${clock(clip.endTime)}</button>
      <span>
        ${state.player?.kind === 'local' ? '' : `<a href="${state.player.kind === 'trick' ? `/api/tricks/${state.player.id}/clips/${clip.id}/export` : `/api/clips/${clip.id}/export`}">导出</a>`}
        <button class="text-btn" type="button" data-delclip="${clip.id}">删除</button>
      </span>
    </div>
  `).join('') || '<div class="sub">用 A / B 标一段，再保存。也可直接改 A/B 时间。</div>';
}

async function saveNotes() {
  const player = state.player;
  if (!player) return;
  const text = $('notes').value;
  try {
    if (player.kind === 'file') {
      await api('/api/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: player.path, text }) });
      const file = state.files.find((row) => row.path === player.path);
      if (file) { file.note = text; file.hasNote = !!text.trim(); }
    } else if (player.kind === 'trick') {
      await api('/api/tricks/' + player.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: text }) });
      const trick = state.tricks.find((row) => row.id === player.id);
      if (trick) trick.notes = text;
    } else await writeLocalNote(player, text);
  } catch (err) { toast(err.message); }
}

async function saveClip() {
  commitMarkInput('a');
  commitMarkInput('b');
  if (state.markA == null || state.markB == null) return toast('先标起点和终点，或手动输入时间');
  const startTime = Math.min(state.markA, state.markB);
  const endTime = Math.max(state.markA, state.markB);
  if (endTime - startTime < 0.05) return toast('终点要晚于起点');
  const name = await askText('片段名称', '片段 ' + (state.clips.length + 1));
  if (!name) return;
  const player = state.player;
  try {
    if (player.kind === 'file') {
      await api('/api/clips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: player.path, name, startTime, endTime }) });
    } else if (player.kind === 'trick') {
      await api(`/api/tricks/${player.id}/clips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, startTime, endTime }) });
      const fresh = await api('/api/tricks');
      const trick = fresh.find((item) => item.id === player.id);
      if (trick) player.clips = trick.clips;
    } else {
      const rows = localClips(player.key);
      rows.push({ id: crypto.randomUUID(), name, startTime, endTime });
      localStorage.setItem('tv2-local-clips', JSON.stringify({ ...JSON.parse(localStorage.getItem('tv2-local-clips') || '{}'), [player.key]: rows }));
    }
    await loadSidePanel();
    toast('片段已记下');
  } catch (err) { toast(err.message); }
}

async function renamePath(filePath, isDir) {
  const current = filePath.split(/[/\\]/).pop();
  const name = await askText(isDir ? '文件夹新名称' : '文件新名称', current);
  if (!name || name === current) return null;
  const data = await api(isDir ? '/api/folder/rename' : '/api/file/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, name })
  });
  return data.path;
}

async function deletePath(filePath, isDir, opts = {}) {
  const label = isDir ? '删除这个文件夹？里面的内容也会一起消失。' : '删除这个文件？';
  if (!(await confirmBox(label))) return false;
  const playing = !!(state.player && (state.player.path === filePath || (isDir && underPath(state.player.path, filePath))));
  if (playing && opts.continueNext) releaseVideo();
  else if (playing) closePlayer();
  else releaseVideo();
  await api(isDir ? '/api/folder/delete' : '/api/file/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath })
  });
  return true;
}
async function deleteCurrentAndContinue() {
  const player = state.player;
  if (!player || player.kind !== 'file') return false;
  const list = currentList().slice();
  const key = itemKey(player);
  const index = list.findIndex((item) => itemKey(item) === key);
  let target = null;
  if (list.length > 1 && index >= 0) {
    target = list[index + 1] || list[0];
    if (itemKey(target) === key) target = list.find((item) => itemKey(item) !== key) || null;
  }
  if (!(await deletePath(player.path, false, { continueNext: true }))) return false;
  await refreshBrowse();
  const fresh = currentList();
  if (!fresh.length) {
    closePlayer();
    return true;
  }
  const found = target && fresh.find((item) => itemKey(item) === itemKey(target));
  openListItem(found || fresh[Math.min(Math.max(index, 0), fresh.length - 1)]);
  return true;
}

function underPath(filePath, folder) {
  if (!filePath || !folder) return false;
  if (filePath === folder) return true;
  return filePath.startsWith(folder + '\\') || filePath.startsWith(folder + '/');
}
function followPath(oldPath, newPath) {
  const swap = (value) => {
    if (!value) return value;
    if (value === oldPath) return newPath;
    if (underPath(value, oldPath) && value !== oldPath) return newPath + value.slice(oldPath.length);
    return value;
  };
  state.root = swap(state.root);
  state.folder = swap(state.folder);
  localStorage.setItem('tv2-root', state.root || '');
  localStorage.setItem('tv2-folder', state.folder || '');
}

let snapCanvas = null;
function drawSnap() {
  const video = $('video');
  if (!video.videoWidth) return false;
  if (!snapCanvas) snapCanvas = document.createElement('canvas');
  snapCanvas.width = video.videoWidth;
  snapCanvas.height = video.videoHeight;
  snapCanvas.getContext('2d').drawImage(video, 0, 0);
  $('snapImg').src = snapCanvas.toDataURL('image/jpeg', 0.9);
  const t = video.currentTime || 0;
  const whole = Math.floor(t / 60);
  const sec = (t - whole * 60).toFixed(2).padStart(5, '0');
  $('snapMeta').textContent = video.videoWidth + '×' + video.videoHeight + ' · ' + whole + ':' + sec;
  $('snapPreview').hidden = false;
  return true;
}
function screenshot() {
  const video = $('video');
  if (!video.videoWidth) return toast('等画面出来再截');
  video.pause();
  drawSnap();
}
function stepSnap(dir) {
  const video = $('video');
  if ($('snapPreview').hidden || !video.videoWidth) return;
  video.pause();
  const dt = 1 / 30;
  const dur = Number.isFinite(video.duration) ? video.duration : Infinity;
  const next = Math.max(0, Math.min(dur, (video.currentTime || 0) + dir * dt));
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    video.removeEventListener('seeked', finish);
    drawSnap();
  };
  video.addEventListener('seeked', finish);
  try { video.currentTime = next; } catch { finish(); return; }
  if (Math.abs((video.currentTime || 0) - next) < 0.0001 && !video.seeking) finish();
  setTimeout(finish, 350);
}

function openMenu(x, y, items) {
  const menu = $('ctx');
  menu.innerHTML = items.map((item, index) => `<button type="button" data-i="${index}" class="${item.danger ? 'danger' : ''}">${esc(item.label)}</button>`).join('');
  menu.hidden = false;
  menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - items.length * 40) + 'px';
  menu.onclick = async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    menu.hidden = true;
    try { await items[Number(button.dataset.i)].run(); }
    catch (err) { toast(err.message); }
  };
}

function askText(title, value) {
  return new Promise((resolve) => {
    const modal = $('modal');
    modal.hidden = false;
    modal.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><input id="modalInput" value="${esc(value || '')}"><div class="actions"><button class="text-btn" id="modalCancel" type="button">取消</button><button class="solid-btn" id="modalOk" type="button">确定</button></div></div>`;
    const input = $('modalInput');
    input.focus();
    input.select();
    const finish = (result) => { modal.hidden = true; modal.innerHTML = ''; resolve(result); };
    $('modalCancel').onclick = () => finish(null);
    $('modalOk').onclick = () => finish(input.value.trim());
    input.onkeydown = (event) => {
      if (event.key === 'Enter') finish(input.value.trim());
      if (event.key === 'Escape') finish(null);
    };
  });
}
function confirmBox(message) {
  if (localStorage.getItem('tv2-skip-delete') === '1') return Promise.resolve(true);
  return confirmAction(message, { ok: '删除', cancel: '留下' });
}
function confirmAction(message, opts = {}) {
  const okLabel = opts.ok || '确定';
  const cancelLabel = opts.cancel || '取消';
  const body = opts.body || '';
  return new Promise((resolve) => {
    const modal = $('modal');
    modal.hidden = false;
    modal.innerHTML = `<div class="modal modal-confirm">
      <h3>${esc(message)}</h3>
      ${body ? `<div class="confirm-body">${body}</div>` : ''}
      <div class="actions">
        <button class="text-btn" id="modalCancel" type="button">${esc(cancelLabel)}</button>
        <button class="solid-btn" id="modalOk" type="button">${esc(okLabel)}</button>
      </div>
    </div>`;
    $('modalCancel').onclick = () => { modal.hidden = true; resolve(false); };
    $('modalOk').onclick = () => { modal.hidden = true; resolve(true); };
  });
}

async function createFolder() {
  if (state.view === 'local') return createLocalFolder();
  if (state.view === 'library') return createCategory();
  const parent = state.folder || state.root;
  if (!parent) return toast('先打开一个位置');
  const name = await askText('新文件夹', '');
  if (!name) return;
  await api('/api/folder/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent, name }) });
  await refreshBrowse();
  toast('文件夹好了');
}

function dragPayload(event) {
  try { return JSON.parse(event.dataTransfer.getData('text/plain') || ''); }
  catch { return null; }
}

async function onDropFolder(dest, payload) {
  if (!payload) return;
  releaseVideo();
  if (payload.kind === 'files') {
    if (payload.paths.every((filePath) => dirname(filePath) === dest)) return;
    const data = await api('/api/file/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: payload.paths, dest }) });
    if (data.errors?.length) toast(data.errors[0].error);
    else toast('已移动');
  } else if (payload.kind === 'folder') {
    const data = await api('/api/folder/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: payload.path, dest }) });
    followPath(payload.path, data.path);
    toast('文件夹已移动');
  }
  state.selected.clear();
  await refreshBrowse();
}

function rememberHistory(id, name, progress) {
  fetch('/api/play-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trickId: id, trickName: name, progress })
  }).catch(() => {});
}

async function loadHistory() {
  state.history = await api('/api/play-history').catch(() => []);
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (!Number.isFinite(min) || min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' 小时前';
  const day = Math.floor(hr / 24);
  if (day < 7) return day + ' 天前';
  return new Date(iso).toLocaleDateString();
}
function renderHistory() {
  const rows = state.history.filter((row) => row.trickId && (row.trickId.includes('\\') || row.trickId.includes('/') || /^[a-zA-Z]:/.test(row.trickId)));
  const groups = new Map();
  for (const row of rows) {
    const folder = dirname(row.trickId);
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(row);
  }
  const body = [...groups.entries()].map(([folder, items]) => `
    <div class="history-group">
      <div class="history-group-head">
        <span class="history-group-name" title="${esc(folder)}">${esc(folder.split(/[/\\]/).pop() || folder)}</span>
        <span class="history-group-count">${items.length}</span>
        <button class="text-btn" type="button" data-clear-folder="${esc(folder)}">删除</button>
        <span class="history-caret">▼</span>
      </div>
      <div class="history-group-body">
        ${items.map((row) => `
          <button class="history-card" type="button" data-id="${esc(row.trickId)}">
            <div class="thumb"><img alt="" src="/api/thumbnail?${qs({ path: row.trickId, t: 1 })}"></div>
            <div class="name">${esc(row.trickName || row.trickId.split(/[/\\]/).pop())}</div>
            <div class="sub">${(row.progress || 0) > 5 ? '看到 ' + clock(row.progress) + ' · ' : ''}${relativeTime(row.lastPlayedAt)}</div>
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');
  $('historyPop').innerHTML = `<div class="history-head">
    <strong>播放历史</strong>
    <button class="text-btn danger" id="clearHistory" type="button">清空全部</button>
  </div>${body || '<div class="empty">还没有播放记录。</div>'}`;
  $('historyPop').querySelectorAll('img').forEach((img) => { img.onerror = () => { img.remove(); }; });
  $('clearHistory').onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!(await confirmAction('清空全部播放历史？', { ok: '清空', cancel: '取消' }))) return;
    await api('/api/play-history', { method: 'DELETE' });
    state.history = [];
    renderHistory();
    toast('已清空全部历史');
  };
  $('historyPop').onclick = async (event) => {
    const head = event.target.closest('.history-group-head');
    const clearer = event.target.closest('[data-clear-folder]');
    if (clearer) {
      event.stopPropagation();
      await api('/api/play-history/folder?' + qs({ path: clearer.dataset.clearFolder }), { method: 'DELETE' });
      state.history = state.history.filter((row) => !underPath(row.trickId, clearer.dataset.clearFolder));
      renderHistory();
      return;
    }
    if (head && !event.target.closest('button')) head.parentElement.classList.toggle('collapsed');
    const card = event.target.closest('[data-id]');
    if (card) openHistory(card.dataset.id);
  };
}

async function openHistory(id) {
  $('historyPop').hidden = true;
  if (id.includes('\\') || id.includes('/') || /^[a-zA-Z]:/.test(id)) {
    const folder = dirname(id);
    const inside = state.root && (id === state.root || underPath(id, state.root));
    if (!inside) {
      state.root = folder;
      state.folder = folder;
      localStorage.setItem('tv2-root', folder);
      remember(folder);
    }
    setView('browse', { keep: true });
    if (!inside || !state.tree) await refreshBrowse();
    else await selectFolder(folder);
    const file = fileByPath(id);
    if (file) openFile(file);
    else toast('文件已经不在原来的地方');
    return;
  }
  setView('library');
  await loadLibrary();
  const trick = state.tricks.find((item) => item.id === id);
  if (trick) openTrick(trick);
}

function renderHelp() {
  $('helpPop').innerHTML = `
    <div class="help-title">主题</div>
    ${themeMarkup()}
    <div class="help-title">预览</div>
    <div class="preview-row">
      <div class="seg" id="previewMode">
        <button type="button" data-preview="hover" class="${previewMode() === 'hover' ? 'active' : ''}">悬停</button>
        <button type="button" data-preview="key" class="${previewMode() === 'key' ? 'active' : ''}">快捷键</button>
      </div>
      <button type="button" id="previewHotkeyBtn" class="hotkey-btn" title="点一下再按新键">${esc(previewHotkeyLabel())}</button>
    </div>
    <div class="help-title">设置</div>
    <label class="check"><input type="checkbox" id="skipDelete" ${localStorage.getItem('tv2-skip-delete') === '1' ? 'checked' : ''}> 删除时不再询问</label>
    <label class="check"><input type="checkbox" id="noSidecars" ${noSidecars() ? 'checked' : ''}> 禁止导出拉屎（不写点开头文件）</label>
    ${noSidecars() ? sidecarLossHtml() : '<div class="sub" style="padding: 0 8px 6px;">勾选后不在媒体文件夹生成 .tv2-card.json / .TThumb.PNG，并提示会少哪些能力。</div>'}
    <button class="menu-item" id="excludeBtn" type="button">这个文件夹不记播放历史</button>
    <div class="help-title">快捷键</div>
    <div class="help-keys">
      <kbd>↑ ↓</kbd><span>上一个 / 下一个</span>
      <kbd>← →</kbd><span>后退 / 前进 5 秒</span>
      <kbd>${esc(previewHotkeyLabel())}</kbd><span>短按开关预览，长按按住预览</span>
      <kbd>右键</kbd><span>长按二倍速，松开恢复</span>
      <kbd>F</kbd><span>全屏</span>
      <kbd>R</kbd><span>重命名</span>
      <kbd>Del</kbd><span>删除</span>
      <kbd>A B</kbd><span>片段起点 / 终点</span>
      <kbd>S</kbd><span>截图</span>
      <kbd>D</kbd><span>下载</span>
      <kbd>P</kbd><span>显示或藏起控件</span>
      <kbd>M</kbd><span>预览声音开/关</span>
      <kbd>O</kbd><span>从预览打开视频</span>
      <kbd>Esc</kbd><span>关闭预览 / 返回</span>
    </div>
  `;
  $('helpPop').querySelectorAll('[data-mode]').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      applyTheme(button.dataset.mode, document.documentElement.getAttribute('data-accent') || 'ember');
    };
  });
  $('helpPop').querySelectorAll('[data-accent]').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      applyTheme(document.documentElement.getAttribute('data-mode') || 'dark', button.dataset.accent);
    };
  });
  $('previewMode').onclick = (event) => {
    const button = event.target.closest('[data-preview]');
    if (!button) return;
    event.stopPropagation();
    localStorage.setItem('tv2-preview-mode', button.dataset.preview);
    $('previewMode').querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    capturingHotkey = false;
    clearTimeout(previewHoldTimer);
    previewHolding = false;
    const hotBtn = $('previewHotkeyBtn');
    if (hotBtn) { hotBtn.textContent = previewHotkeyLabel(); hotBtn.classList.remove('listening'); }
    hideHover();
  };
  const hotBtn = $('previewHotkeyBtn');
  if (hotBtn) {
    hotBtn.onclick = (event) => {
      event.stopPropagation();
      capturingHotkey = true;
      hotBtn.textContent = '按下新键…';
      hotBtn.classList.add('listening');
    };
  }
  $('skipDelete').onchange = () => localStorage.setItem('tv2-skip-delete', $('skipDelete').checked ? '1' : '0');
  $('noSidecars').onchange = () => {
    localStorage.setItem('tv2-no-sidecars', $('noSidecars').checked ? '1' : '0');
    renderHelp();
    if ($('cardPrefsPop') && !$('cardPrefsPop').hidden) renderCardPrefs();
    toast($('noSidecars').checked ? '已禁止向文件夹写入点开头文件' : '已允许写入点开头附属文件');
  };
  $('excludeBtn').onclick = async () => {
    if (!state.folder) return;
    await api('/api/history-exclude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: state.folder, action: 'add' }) });
    toast('这个文件夹不再写入历史');
  };
}

function appendConvertLog(line, kind = '') {
  const log = $('convertLog');
  if (!log) return;
  const row = document.createElement('div');
  row.className = 'convert-log-line' + (kind ? ' is-' + kind : '');
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  row.textContent = `[${time}] ${line}`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}
function setConvertCommand(command) {
  if (!command) return;
  state.convertCommand = command;
  const box = $('convertCmd');
  if (box) box.textContent = command;
  const dockCmd = $('dockCmd');
  if (dockCmd) dockCmd.textContent = command;
}
function updateConvertProgress(data) {
  const overall = data.overall != null
    ? data.overall
    : (data.percent != null ? data.percent : null);
  const filePct = data.percent != null ? data.percent : null;
  if (overall != null) {
    if ($('convertBar')) $('convertBar').style.width = overall + '%';
    if ($('convertPct')) $('convertPct').textContent = Math.round(overall) + '%';
    if ($('dockBar')) $('dockBar').style.width = overall + '%';
    if ($('dockPct')) $('dockPct').textContent = Math.round(overall) + '%';
  }
  const parts = [];
  if (data.index && data.total) parts.push(`${data.index}/${data.total}`);
  if (data.name || data.file) parts.push(data.name || data.file);
  if (filePct != null && data.total > 1) parts.push(`当前 ${Math.round(filePct)}%`);
  if (data.ok != null || data.fail != null) parts.push(`成功 ${data.ok || 0} · 失败 ${data.fail || 0}`);
  const meta = parts.join(' · ');
  if ($('convertMeta')) $('convertMeta').textContent = meta;
  if ($('dockText')) $('dockText').textContent = meta || data.msg || data.type || '';
  if (data.command) setConvertCommand(data.command);
}
async function startConvert(url) {
  const inConvert = state.view === 'convert';
  const progress = $('convertProgress');
  if (progress && inConvert) {
    progress.hidden = false;
    if ($('convertStatus')) $('convertStatus').textContent = '正在转换…';
    if ($('convertBar')) $('convertBar').style.width = '0%';
    if ($('convertPct')) $('convertPct').textContent = '0%';
    if ($('convertMeta')) $('convertMeta').textContent = '';
    if ($('convertLog')) $('convertLog').innerHTML = '';
    if ($('convertCmd')) $('convertCmd').textContent = state.convertCommand || '';
  }
  $('dock').hidden = false;
  $('dock').innerHTML = `
    <div class="dock-head"><strong id="dockTitle">正在转换</strong><span id="dockPct">0%</span></div>
    <div class="bar"><span id="dockBar"></span></div>
    <div id="dockText" class="sub"></div>
    <pre id="dockCmd" class="dock-cmd" hidden></pre>
    <div class="dock-actions">
      <button class="text-btn" id="dockCopy" type="button">复制命令</button>
      <button class="text-btn" id="dockClose" type="button">关闭</button>
    </div>`;
  $('dockClose').onclick = () => { $('dock').hidden = true; };
  $('dockCopy').onclick = async () => {
    const cmd = state.convertCommand || ($('dockCmd')?.textContent || '');
    if (!cmd) return toast('还没有命令');
    try {
      await navigator.clipboard.writeText(cmd);
      toast('命令已复制');
    } catch { toast('复制失败'); }
  };
  await new Promise((resolve, reject) => {
    const source = new EventSource(url);
    let finished = false;
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      updateConvertProgress(data);
      if (data.type === 'start') {
        if ($('convertStatus')) $('convertStatus').textContent = '正在转换…';
        if ($('dockTitle')) $('dockTitle').textContent = '正在转换';
        if (data.command) {
          setConvertCommand(data.command);
          if ($('dockCmd')) { $('dockCmd').hidden = false; $('dockCmd').textContent = data.command; }
        }
        appendConvertLog(
          data.total > 1
            ? `开始：共 ${data.total} 个文件` + (data.path ? ` · ${data.path}` : '')
            : `开始：${data.file || data.path || ''}`,
          'start'
        );
        if (data.note) appendConvertLog(data.note);
      } else if (data.type === 'file') {
        appendConvertLog(`(${data.index}/${data.total}) 开始 ${data.name || data.path || ''}`);
      } else if (data.type === 'file-done') {
        appendConvertLog(`完成 ${data.name}`, 'ok');
      } else if (data.type === 'file-skip') {
        appendConvertLog(`跳过 ${data.name}`, 'skip');
      } else if (data.type === 'file-error') {
        appendConvertLog(`失败 ${data.name}${data.msg ? ' · ' + data.msg : ''}`, 'err');
      } else if (data.type === 'progress') {
        // bar only
      } else if (data.type === 'done') {
        const summary = data.total
          ? `全部完成：${data.total} 个` + (data.ok != null ? `（成功 ${data.ok} / 失败 ${data.fail || 0}）` : '')
          : `完成${data.output ? ' · ' + data.output : ''}`;
        appendConvertLog(summary, 'ok');
        if ($('convertStatus')) $('convertStatus').textContent = '已完成';
        if ($('dockTitle')) $('dockTitle').textContent = '已完成';
        updateConvertProgress({ ...data, overall: 100 });
      } else if (data.type === 'error') {
        appendConvertLog(data.msg || '失败', 'err');
        if ($('convertStatus')) $('convertStatus').textContent = '失败';
        if ($('dockTitle')) $('dockTitle').textContent = '失败';
      }
      if (data.type === 'done' || data.type === 'error') {
        finished = true;
        source.close();
        if (data.type === 'error') reject(new Error(data.msg || '失败'));
        else resolve(data);
      }
    };
    source.onerror = () => {
      if (finished) return;
      source.close();
      reject(new Error('连接中断'));
    };
  });
}

function playerMore() {
  const player = state.player;
  if (!player) return;
  const rect = $('playerMenuBtn').getBoundingClientRect();
  const items = [];
  if (player.kind === 'file') {
    items.push({
      label: '下载视频',
      run: () => {
        const link = document.createElement('a');
        link.href = '/api/stream?' + qs({ path: player.path, download: '1' });
        link.download = player.name;
        link.click();
      }
    });
    ['copy', '1080p', '720p', '480p'].forEach((quality) => items.push({
      label: '转换 ' + quality,
      run: () => startConvert('/api/convert/file?' + qs({ path: player.path, quality }))
    }));
    items.push({
      label: '重命名',
      run: async () => {
        releaseVideo();
        const next = await renamePath(player.path, false);
        if (!next) return;
        await refreshBrowse();
        const file = fileByPath(next);
        if (file) openFile(file);
      }
    });
    items.push({
      label: '删除',
      danger: true,
      run: () => deleteCurrentAndContinue()
    });
  }
  openMenu(rect.left, rect.bottom + 6, items);
}

async function loadLibrary() {
  state.cats = await api('/api/categories');
  state.tricks = await api('/api/tricks' + (state.category ? '?' + qs({ category: state.category }) : ''));
  renderLibrarySide();
  const words = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tricks = state.tricks.filter((trick) => matchesQuery([trick.name, trick.notes], words));
  state.trickPlaylist = tricks;
  if (previewOpen()) closePreviewNow();
  $('trickGrid').innerHTML = tricks.map((trick) => {
    const note = noteMarkHtml({ hasNote: !!(trick.notes || '').trim(), notes: trick.notes });
    const bits = [esc(formatSize(trick.fileSize))];
    const sub = [bits.join(' · '), note].filter(Boolean).join(note ? ' · ' : '');
    return `
    <button class="card" type="button" data-trick="${trick.id}">
      <div class="thumb">${trick.thumbnail ? `<img src="${esc(trick.thumbnail)}" alt="">` : ''}<span class="badge">${trick.mediaType === 'gif' ? 'GIF' : '视频'}</span></div>
      <div class="meta"><div class="name">${esc(trick.name)}</div><div class="sub">${sub}</div></div>
    </button>`;
  }).join('') || '<div class="empty">收藏库还是空的。上传一段就行。</div>';
  $('trickGrid').querySelectorAll('[data-trick]').forEach((card) => {
    card.onclick = () => openTrick(state.tricks.find((trick) => trick.id === card.dataset.trick));
  });
}
function renderLibrarySide() {
  $('sideBody').innerHTML = `<button class="tree-row ${state.category ? '' : 'active'}" type="button" data-cat="">全部</button>` +
    state.cats.map((cat) => `<button class="tree-row ${state.category === cat.id ? 'active' : ''}" type="button" data-cat="${cat.id}">${esc(cat.name)}</button>`).join('');
}
async function createCategory() {
  const name = await askText('新分类', '');
  if (!name) return;
  await api('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  await loadLibrary();
}
function openTrick(trick, time) {
  if (!trick) return;
  releaseVideo();
  state.player = { kind: 'trick', ...trick, name: trick.name };
  showPlayerPage();
  updateChrome();
  const video = $('video');
  video.hidden = false;
  $('still').hidden = true;
  video.src = trick.videoPath;
  cuePlayback(video, time);
  loadSidePanel();
  rememberHistory(trick.id, trick.name, Number(time) || 0);
}

function localKey(parent, name) { return parent ? parent + '/' + name : name; }
function localNote(key) { return (JSON.parse(localStorage.getItem('tv2-local-notes') || '{}'))[key] || ''; }
function localClips(key) { return (JSON.parse(localStorage.getItem('tv2-local-clips') || '{}'))[key] || []; }
async function writeLocalNote(player, text) {
  const parent = state.local.map.get(player.parent);
  if (parent) {
    const noteName = player.name + '.notes.txt';
    if (!text.trim()) {
      try { await parent.removeEntry(noteName); } catch { /* none */ }
    } else {
      const handle = await parent.getFileHandle(noteName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    }
  }
  const all = JSON.parse(localStorage.getItem('tv2-local-notes') || '{}');
  all[player.key] = text;
  localStorage.setItem('tv2-local-notes', JSON.stringify(all));
}

async function saveLocalHandle(handle) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('tv2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(handle, 'local-root');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function loadLocalHandle() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('tv2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve) => {
    const tx = db.transaction('kv', 'readonly');
    const request = tx.objectStore('kv').get('local-root');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

async function bootLocal() {
  if (state.local.root) return renderLocal();
  if (!window.showDirectoryPicker) {
    $('localGate').hidden = false;
    $('localBody').hidden = true;
    $('localGate').innerHTML = '<h1>本机模式</h1><p class="lede">需要 Chrome 或 Edge，并且用 localhost 打开。文件由浏览器直接读写，服务器不会占着它们。</p>';
    $('sideBody').innerHTML = '';
    return;
  }
  const saved = await loadLocalHandle().catch(() => null);
  if (saved) {
    const perm = await saved.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt');
    if (perm === 'granted') {
      state.local.root = saved;
      await renderLocal();
      return;
    }
  }
  $('localGate').hidden = false;
  $('localBody').hidden = true;
  $('localGate').innerHTML = '<h1>本机文件夹</h1><p class="lede">选一个文件夹后，可以在浏览器里直接新建、改名、移动和删除。播放结束或进行这些操作之前，会先放开文件。</p><button class="solid-btn" id="pickLocal" type="button">选择文件夹</button>';
  $('pickLocal').onclick = pickLocal;
  $('sideBody').innerHTML = '';
}
async function pickLocal() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('需要读写权限');
  state.local.root = handle;
  state.local.folder = handle.name;
  await saveLocalHandle(handle);
  await renderLocal();
}
async function walkLocal(handle, key, parent) {
  state.local.map.set(key, handle);
  const folders = [];
  for await (const [name, child] of handle.entries()) {
    if (child.kind === 'directory' && name !== '.TThumb.PNG') {
      folders.push(await walkLocal(child, key + '/' + name, key));
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return { name: handle.name, key, parent, folders };
}
async function renderLocal() {
  if (!state.local.root) return bootLocal();
  state.local.map = new Map();
  state.local.tree = await walkLocal(state.local.root, state.local.root.name, '');
  if (!state.local.folder || !state.local.map.has(state.local.folder)) state.local.folder = state.local.tree.key;
  $('localGate').hidden = true;
  $('localBody').hidden = false;
  renderLocalSide();
  await renderLocalGrid();
}
function renderLocalNodes(nodes, depth) {
  return (nodes || []).map((node) => {
    const kids = node.folders || [];
    const open = !state.localExpanded || state.localExpanded.has(node.key) || depth === 0;
    return `<div class="tree-node">
      <div class="tree-row ${depth === 0 ? 'root' : ''} ${node.key === state.local.folder ? 'active' : ''}" data-local="${esc(node.key)}" data-local-drop="${esc(node.key)}">
        <button type="button" class="tree-toggle ${kids.length ? (open ? 'open' : '') : 'leaf'}" data-local-toggle="${esc(node.key)}" aria-label="展开"></button>
        <span class="tree-name">${esc(node.name)}</span>
      </div>
      ${kids.length && open ? `<div class="tree-kids">${renderLocalNodes(kids, depth + 1)}</div>` : ''}
    </div>`;
  }).join('');
}
function renderLocalSide() {
  if (!state.local.tree) return;
  $('sideBody').innerHTML = renderLocalNodes([state.local.tree], 0);
}
async function collectLocalFiles(handle, key) {
  const files = [];
  for await (const [name, child] of handle.entries()) {
    if (name === '.TThumb.PNG' || name.endsWith('.notes.txt')) continue;
    if (child.kind === 'directory') files.push(...await collectLocalFiles(child, key + '/' + name));
    else if (isMediaName(name)) files.push({ name, key: key + '/' + name, handle: child, parent: key, type: mediaType(name) });
  }
  return files;
}
async function renderLocalGrid() {
  if (previewOpen()) closePreviewNow();
  const handle = state.local.map.get(state.local.folder);
  if (!handle) return;
  const files = await collectLocalFiles(handle, state.local.folder);
  files.forEach((file) => {
    const note = localNote(file.key);
    file.note = note;
    file.hasNote = !!String(note || '').trim();
  });
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  const words = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  state.local.files = files.filter((file) => (state.filter === 'all' || fileKind(file) === state.filter) && matchesQuery([file.name, file.note], words));
  $('localCrumbs').textContent = state.local.folder;
  $('localGrid').innerHTML = state.local.files.map((file) => {
    const where = file.parent !== state.local.folder ? file.parent.split('/').pop() : '';
    const bits = [where ? esc(where) : ''].filter(Boolean);
    const note = noteMarkHtml(file);
    const sub = [bits.join(' · '), note].filter(Boolean).join(bits.length && note ? ' · ' : '');
    return `<button class="card" type="button" draggable="true" data-local-file="${esc(file.key)}"><div class="thumb"><span class="badge">${esc(file.name.split('.').pop().toUpperCase())}</span></div><div class="meta"><div class="name">${esc(file.name)}</div><div class="sub">${sub}</div></div></button>`;
  }).join('') || '<div class="empty">这里没有媒体文件。</div>';
}
async function openLocalFile(file, time) {
  if (playsAsAudio(file)) {
    await openAudio({ kind: 'local', ...file, type: fileKind(file) === 'video' ? 'video' : 'audio' }, time);
    return;
  }
  releaseVideo();
  const blob = await file.handle.getFile();
  state.blobUrl = URL.createObjectURL(blob);
  state.player = { kind: 'local', ...file };
  showPlayerPage();
  updateChrome();
  const video = $('video');
  if (file.type === 'image') {
    video.hidden = true;
    $('still').hidden = false;
    $('still').src = state.blobUrl;
  } else {
    video.hidden = false;
    $('still').hidden = true;
    video.src = state.blobUrl;
    cuePlayback(video, time);
  }
  await loadSidePanel();
}
async function createLocalFolder() {
  const parent = state.local.map.get(state.local.folder);
  if (!parent) return;
  const name = await askText('新文件夹', '');
  if (!name) return;
  releaseVideo();
  await parent.getDirectoryHandle(name, { create: true });
  await renderLocal();
}
async function mutateLocal(file, run) {
  releaseVideo();
  const parent = state.local.map.get(file.parent);
  await run(parent);
  closePlayer();
  await renderLocal();
}
async function renameLocal(file) {
  const name = await askText('新名称', file.name);
  if (!name || name === file.name) return;
  await mutateLocal(file, async (parent) => {
    const blob = await file.handle.getFile();
    const created = await parent.getFileHandle(name, { create: true });
    const writable = await created.createWritable();
    await writable.write(blob);
    await writable.close();
    await parent.removeEntry(file.name);
  });
}
async function deleteLocal(file) {
  if (!(await confirmBox('删除这个文件？'))) return;
  await mutateLocal(file, (parent) => parent.removeEntry(file.name));
}

function renderConvert() {
  const tab = state.convertTab;
  state.convertPick = '';
  state.convertCommand = '';
  const encoder = `<label class="field"><span>编码器</span>
    <select id="convEncoder">
      <option value="x265" selected>x265</option>
      <option value="x264">x264</option>
    </select>
  </label>`;
  const base = `<label class="field"><span>从哪个文件夹里找</span><input id="convBase" placeholder="D:\\Videos" value="${esc(state.root)}"></label>`;
  const pick = `<div class="conv-pick" id="convPickBox" hidden>
    <div class="conv-pick-label">已选择</div>
    <div class="conv-pick-path" id="convPickPath"></div>
    <div class="conv-subs" id="convSubs" hidden></div>
  </div>`;
  const preview = `<div class="convert-cmd-wrap" id="convPreviewWrap" hidden>
    <div class="convert-cmd-top">
      <span>完整命令（可复制到其他机器）</span>
      <button class="text-btn" id="convCopyPreview" type="button">复制命令</button>
    </div>
    <pre id="convPreviewCmd" class="convert-cmd"></pre>
    <p class="convert-note" id="convPreviewNote"></p>
  </div>`;
  const forms = {
    extract: base + `<label class="field"><span>视频文件名里的词</span><input id="convQ" placeholder="输入后点搜索"></label><div id="convHits" class="results"></div>${pick}<button class="solid-btn" id="convRun" type="button">提取字幕</button>`,
    merge: base + `<label class="field"><span>视频完整路径</span><input id="convVideo"></label><label class="field"><span>字幕完整路径</span><input id="convSub"></label><button class="solid-btn" id="convRun" type="button">合并进 MP4</button>`,
    single: base + encoder + `<label class="field"><span>视频文件名里的词（含 MP4）</span><input id="convQ" placeholder="搜到后点选文件"></label><div id="convHits" class="results"></div>${pick}${preview}<button class="solid-btn" id="convRun" type="button">确认并转换</button>`,
    folder: base + encoder + `<label class="field"><span>文件夹名里的词</span><input id="convQ" placeholder="搜到后点选；有子文件夹可继续进入"></label><div id="convHits" class="results"></div>${pick}${preview}<button class="solid-btn" id="convRun" type="button">确认并转换文件夹</button>`,
    batch: base + encoder + `<label class="field"><span>这一轮最多几个，0 表示全部</span><input id="convLimit" value="0"></label>${preview}<button class="solid-btn" id="convRun" type="button">确认并批量转换 MKV</button>`
  };
  $('convertForm').innerHTML = forms[tab];
  const progress = $('convertProgress');
  if (progress) progress.hidden = true;
  if ($('convertLog')) $('convertLog').innerHTML = '';
  if ($('convertCmd')) $('convertCmd').textContent = '';

  const renderSubfolders = (kids, parentPath) => {
    const box = $('convSubs');
    if (!box) return;
    if (!kids?.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = `
      <div class="conv-subs-label">子文件夹（点选可转换该子目录）</div>
      <div class="conv-subs-list">
        ${kids.map((kid) => `<button type="button" class="conv-sub-btn" data-path="${esc(kid.path)}">${esc(kid.name)}</button>`).join('')}
      </div>`;
    box.querySelectorAll('[data-path]').forEach((button) => {
      button.onclick = () => setPick(button.dataset.path);
    });
    if (parentPath) box.dataset.parent = parentPath;
  };

  const loadSubfolders = async (fullPath) => {
    if (tab !== 'folder' || !fullPath) {
      renderSubfolders([]);
      return;
    }
    const kids = await api('/api/convert/children?' + qs({ path: fullPath })).catch(() => []);
    renderSubfolders(kids, fullPath);
  };

  const setPick = (fullPath, children) => {
    state.convertPick = fullPath || '';
    const box = $('convPickBox');
    if (!box) return;
    if (!fullPath) {
      box.hidden = true;
      renderSubfolders([]);
      return;
    }
    box.hidden = false;
    $('convPickPath').textContent = fullPath;
    if (tab === 'folder') {
      if (Array.isArray(children)) renderSubfolders(children, fullPath);
      else loadSubfolders(fullPath);
    }
    refreshPreview();
  };

  const refreshPreview = async () => {
    if (!['single', 'folder', 'batch'].includes(tab)) return;
    const encoderVal = $('convEncoder')?.value || 'x265';
    const basePath = $('convBase')?.value.trim() || '';
    let target = '';
    let mode = tab;
    if (tab === 'single') target = state.convertPick;
    else if (tab === 'folder') target = state.convertPick || basePath;
    else target = basePath;
    const wrap = $('convPreviewWrap');
    if (!wrap) return;
    if (!target) {
      wrap.hidden = true;
      return;
    }
    try {
      const params = { mode, path: target, encoder: encoderVal };
      if (tab === 'batch') params.limit = $('convLimit')?.value || '0';
      const data = await api('/api/convert/preview?' + qs(params));
      state.convertPreview = data;
      state.convertCommand = data.command || '';
      wrap.hidden = false;
      $('convPreviewCmd').textContent = data.command || '';
      const bits = [];
      if (data.path) bits.push(`路径：${data.path}`);
      if (data.output) bits.push(`输出：${data.output}`);
      if (data.total != null) bits.push(`数量：${data.total}`);
      if (data.skipped) bits.push(`已跳过：${data.skipped}`);
      if (data.note) bits.push(data.note);
      if (data.files?.length) {
        const list = data.files.slice(0, 8).join('\n');
        bits.push('文件：\n' + list + (data.more ? `\n…另有 ${data.more} 个` : ''));
      }
      $('convPreviewNote').textContent = bits.join('\n');
    } catch (err) {
      wrap.hidden = false;
      $('convPreviewCmd').textContent = '';
      $('convPreviewNote').textContent = err.message;
      state.convertPreview = null;
    }
  };

  const searchBox = $('convQ');
  if (searchBox) {
    let timer;
    const bindHits = (hits) => {
      if (tab === 'folder') {
        $('convHits').innerHTML = hits.map((hit) => {
          const kids = hit.children || [];
          const kidHtml = kids.length
            ? `<div class="conv-hit-kids">
                ${kids.slice(0, 24).map((kid) => `<button type="button" class="conv-sub-btn" data-path="${esc(kid.path)}" data-child="1">${esc(kid.name)}</button>`).join('')}
                ${kids.length > 24 ? `<span class="conv-hit-more">+${kids.length - 24}</span>` : ''}
              </div>`
            : '';
          return `<div class="conv-hit ${kids.length ? 'has-kids' : ''}">
            <button type="button" class="conv-hit-main" data-path="${esc(hit.path)}">${esc(hit.path)}</button>
            ${kidHtml}
          </div>`;
        }).join('') || '<div class="empty-inline">没有匹配结果</div>';
      } else {
        $('convHits').innerHTML = hits.map((hit) => `<button type="button" data-path="${esc(hit.path)}">${esc(hit.path)}</button>`).join('')
          || '<div class="empty-inline">没有匹配结果</div>';
      }
      $('convHits').querySelectorAll('[data-path]').forEach((button) => {
        button.onclick = (event) => {
          event.stopPropagation();
          const fullPath = button.dataset.path;
          const hit = hits.find((item) => item.path === fullPath);
          setPick(fullPath, hit?.children);
          searchBox.value = fullPath.split(/[/\\]/).pop();
          $('convHits').querySelectorAll('.conv-hit').forEach((row) => {
            const match = [...row.querySelectorAll('[data-path]')].some((el) => el.dataset.path === fullPath);
            row.classList.toggle('on', match);
          });
          $('convHits').querySelectorAll('[data-path]').forEach((item) => {
            item.classList.toggle('on', item.dataset.path === fullPath);
          });
        };
      });
    };
    searchBox.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const type = tab === 'folder' ? 'folder' : 'file';
        const hits = await api('/api/convert/search?' + qs({ q: searchBox.value, basePath: $('convBase').value, type })).catch(() => []);
        bindHits(hits);
      }, 250);
    };
  }
  if ($('convEncoder')) $('convEncoder').onchange = () => refreshPreview();
  if ($('convBase')) $('convBase').onchange = () => refreshPreview();
  if ($('convLimit')) $('convLimit').onchange = () => refreshPreview();
  if ($('convCopyPreview')) {
    $('convCopyPreview').onclick = async () => {
      const cmd = state.convertCommand || $('convPreviewCmd')?.textContent || '';
      if (!cmd) return toast('还没有命令');
      try {
        await navigator.clipboard.writeText(cmd);
        toast('命令已复制');
      } catch { toast('复制失败'); }
    };
  }
  if ($('convertCopyCmd')) {
    $('convertCopyCmd').onclick = async () => {
      const cmd = state.convertCommand || $('convertCmd')?.textContent || '';
      if (!cmd) return toast('还没有命令');
      try {
        await navigator.clipboard.writeText(cmd);
        toast('命令已复制');
      } catch { toast('复制失败'); }
    };
  }
  if (tab === 'batch' || tab === 'folder') refreshPreview();

  $('convRun').onclick = async () => {
    try {
      const basePath = $('convBase')?.value.trim();
      const encoderVal = $('convEncoder')?.value || 'x265';
      if (tab === 'extract') {
        if (!state.convertPick) return toast('先搜索并点选一个视频');
        const ok = await confirmAction('确认提取字幕？', {
          ok: '开始提取',
          body: `<p class="confirm-path">${esc(state.convertPick)}</p>`
        });
        if (!ok) return;
        await startConvert('/api/convert/extract-sub?' + qs({ path: state.convertPick }));
      } else if (tab === 'merge') {
        const video = $('convVideo').value.trim();
        const sub = $('convSub').value.trim();
        if (!video || !sub) return toast('视频和字幕路径都要填');
        const ok = await confirmAction('确认合并字幕到视频？', {
          ok: '开始合并',
          body: `<p class="confirm-path">视频：${esc(video)}</p><p class="confirm-path">字幕：${esc(sub)}</p>`
        });
        if (!ok) return;
        await startConvert('/api/convert/merge-sub?' + qs({ video, sub }));
      } else if (tab === 'single' || tab === 'folder' || tab === 'batch') {
        const target = tab === 'single'
          ? state.convertPick
          : (tab === 'folder' ? (state.convertPick || basePath) : basePath);
        if (!target) return toast(tab === 'single' ? '先搜索并点选一个视频' : '先填写或选择文件夹');
        await refreshPreview();
        const preview = state.convertPreview;
        if (!preview) return toast('无法确认路径，请检查后再试');
        if (!preview.total && tab !== 'single') return toast(preview.note || '没有可转换的文件');
        const fileList = (preview.files || []).slice(0, 12).map((name) => `<li>${esc(name)}</li>`).join('');
        const more = preview.more ? `<li>…另有 ${preview.more} 个</li>` : '';
        const ok = await confirmAction(tab === 'single' ? '确认转换这个视频？' : '确认转换这个文件夹？', {
          ok: '开始转换',
          body: `
            <p class="confirm-path">${esc(preview.path)}</p>
            ${preview.output ? `<p class="confirm-sub">输出：${esc(preview.output)}</p>` : ''}
            <p class="confirm-sub">共 ${preview.total || 0} 个文件 · 编码器 ${esc(preview.encoder || encoderVal)}</p>
            ${preview.note ? `<p class="confirm-sub">${esc(preview.note)}</p>` : ''}
            ${fileList ? `<ul class="confirm-files">${fileList}${more}</ul>` : ''}
            <div class="convert-cmd-wrap confirm-cmd">
              <div class="convert-cmd-top"><span>将执行的命令</span></div>
              <pre class="convert-cmd">${esc(preview.command || '')}</pre>
            </div>`
        });
        if (!ok) return;
        state.convertCommand = preview.command || '';
        if (tab === 'single') await startConvert('/api/convert/single?' + qs({ path: target, encoder: encoderVal }));
        else if (tab === 'folder') await startConvert('/api/convert/folder?' + qs({ path: target, encoder: encoderVal }));
        else await startConvert('/api/convert/batch?' + qs({ path: target, encoder: encoderVal, limit: $('convLimit').value || '0' }));
      }
      toast('完成');
    } catch (err) { toast(err.message); }
  };
}

async function loadLinks() {
  state.links = await api('/api/resource-links');
  if (!Array.isArray(state.links)) state.links = [];
  renderLinks();
}
function scheduleLinkSave() {
  clearTimeout(scheduleLinkSave.timer);
  scheduleLinkSave.timer = setTimeout(() => {
    api('/api/resource-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.links) }).catch((err) => toast(err.message));
  }, 300);
}
function renderLinks() {
  $('linksSheet').innerHTML = `<h2 class="panel-title">资源</h2>` + state.links.map((cat, ci) => `
    <div class="link-card">
      <input class="title" data-ci="${ci}" value="${esc(cat.title || '')}">
      ${(cat.links || []).map((link, li) => `<div class="link-row"><a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.name)}</a><button class="text-btn" type="button" data-cut="${ci}:${li}">删除</button></div>`).join('')}
      <button class="text-btn" type="button" data-addlink="${ci}">加链接</button>
      <button class="text-btn" type="button" data-cutcat="${ci}">删除分类</button>
    </div>
  `).join('') + '<button class="text-btn" id="addCat" type="button">加一个分类</button>';
  $('addCat').onclick = () => { state.links.push({ title: '新分类', links: [] }); renderLinks(); scheduleLinkSave(); };
  $('linksSheet').oninput = (event) => {
    if (!event.target.dataset.ci) return;
    state.links[Number(event.target.dataset.ci)].title = event.target.value;
    scheduleLinkSave();
  };
  $('linksSheet').onclick = async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.addlink != null) {
      const name = await askText('链接名称', '');
      if (!name) return;
      let url = await askText('网址', 'https://');
      if (!url) return;
      if (!/^https?:/i.test(url)) url = 'https://' + url;
      state.links[Number(button.dataset.addlink)].links.push({ name, url });
      renderLinks();
      scheduleLinkSave();
    }
    if (button.dataset.cut) {
      const [ci, li] = button.dataset.cut.split(':').map(Number);
      state.links[ci].links.splice(li, 1);
      renderLinks();
      scheduleLinkSave();
    }
    if (button.dataset.cutcat != null) {
      state.links.splice(Number(button.dataset.cutcat), 1);
      renderLinks();
      scheduleLinkSave();
    }
  };
}

function syncSortButtons() {
  document.querySelectorAll('#sortSeg button').forEach((button) => button.classList.toggle('active', button.dataset.sort === state.sort));
  document.querySelectorAll('#filterSeg button').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.filter));
  if ($('repeatBtn')) $('repeatBtn').classList.toggle('on', state.repeat === 'one');
  if ($('shuffleBtn')) $('shuffleBtn').classList.toggle('on', state.shuffle);
}

function currentStreamUrl() {
  if (!state.player || state.player.kind !== 'file') return '';
  return location.origin + '/api/stream?' + qs({ path: state.player.path });
}
function syncPinned() {
  const pin = localStorage.getItem('tv2-pinned-player') || '';
  const button = $('streamPinned');
  const labels = { mpv: 'MPV', iina: 'IINA', vlc: 'VLC', potplayer: 'PotPlayer' };
  if (!pin || state.player?.kind !== 'file') button.hidden = true;
  else {
    button.hidden = false;
    button.textContent = labels[pin] || pin;
  }
  document.querySelectorAll('[data-pin]').forEach((el) => {
    const on = el.dataset.pin === pin;
    el.textContent = on ? '取消' : '钉住';
    el.title = on ? '取消钉住' : '钉在顶栏';
  });
}
function launchProtocol(player, streamUrl) {
  if (player === 'mpv') {
    const b64 = btoa(unescape(encodeURIComponent(streamUrl))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    location.assign('mpv-handler://play/' + b64);
    return;
  }
  if (player === 'iina') { location.assign('iina://weblink?url=' + encodeURIComponent(streamUrl)); return; }
  if (player === 'vlc') { location.assign('vlc://' + streamUrl); return; }
  if (player === 'potplayer') location.assign('potplayer://' + streamUrl);
}
async function openStreamPlayer(player) {
  const streamUrl = currentStreamUrl();
  if (!streamUrl) return;
  $('streamDrop').hidden = true;
  const here = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (here) {
    try {
      await api('/api/open-player', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: state.player.path, player }) });
      toast('已用播放器打开');
      return;
    } catch { /* 远程协议接着试 */ }
  }
  try { launchProtocol(player, streamUrl); toast('正在唤起播放器'); }
  catch { toast('没能唤起播放器'); }
}
function bindVideoResize() {
  const handle = $('videoResizeHandle');
  const box = $('detailVideoBox');
  if (!handle || handle.dataset.bound) return;
  handle.dataset.bound = '1';
  handle.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startH = box.offsetHeight;
    const minH = window.matchMedia('(max-width: 900px)').matches ? 140 : 200;
    const onMove = (ev) => {
      const next = Math.max(minH, Math.min(Math.round(window.innerHeight * 0.85), startH + ev.clientY - startY));
      box.style.height = next + 'px';
    };
    const onUp = (ev) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      localStorage.setItem('tv2-video-height', box.offsetHeight);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}
function isMobileLayout() {
  return window.matchMedia('(max-width: 900px)').matches;
}
function closeMobileNav() {
  $('app').classList.remove('nav-open');
  const tip = $('navBackdrop');
  if (tip) tip.setAttribute('aria-hidden', 'true');
}
function syncMobileNavA11y() {
  const open = $('app').classList.contains('nav-open');
  const tip = $('navBackdrop');
  if (tip) tip.setAttribute('aria-hidden', open ? 'false' : 'true');
}
function bindMobileNavGestures() {
  const app = $('app');
  const edge = 28;
  let startX = 0;
  let startY = 0;
  let mode = '';
  document.addEventListener('touchstart', (event) => {
    if (!isMobileLayout() || event.touches.length !== 1) return;
    if (!$('douyinOverlay').hidden) return;
    const t = event.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    if (app.classList.contains('nav-open')) {
      const side = $('side');
      const onSide = side && t.clientX <= side.getBoundingClientRect().right;
      mode = onSide ? 'close' : '';
      return;
    }
    mode = startX <= edge ? 'open' : '';
  }, { passive: true });
  document.addEventListener('touchend', (event) => {
    if (!mode || !isMobileLayout()) { mode = ''; return; }
    const t = event.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const current = mode;
    mode = '';
    if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.1) return;
    if (current === 'open' && dx > 0) {
      app.classList.add('nav-open');
      syncMobileNavA11y();
    }
    if (current === 'close' && dx < 0) closeMobileNav();
  }, { passive: true });
}
function bindTransport() {
  const video = $('video');
  const rate = $('rateBtn');
  const sync = () => {
    const fast = video.playbackRate >= 2;
    rate.textContent = fast ? '2x' : '1x';
    rate.classList.toggle('on', fast);
  };
  rate.onclick = () => {
    video.playbackRate = video.playbackRate >= 2 ? 1 : 2;
    if (video.paused) video.play().catch(() => {});
    sync();
  };
  video.addEventListener('ratechange', sync);
}
let douyinItems = [];
let douyinIndex = 0;
let douyinLock = false;
let douyinStepLock = false;
let douyinScrollTimer = 0;
let douyinUnlockTimer = 0;
let douyinOnScroll = null;
let douyinOnScrollEnd = null;
let douyinOnWheel = null;
const douyinWarmKeys = new Set();
const douyinWarmAbort = new Map();

function douyinMediaUrl(item) {
  if (!item) return '';
  if (item.videoPath) return item.videoPath;
  if (item.path) return '/api/play?' + qs({ path: item.path });
  return '';
}
function douyinItemKey(item) {
  if (!item) return '';
  return item.path || item.videoPath || item.id || item.key || '';
}
function clearDouyinVideo(vid) {
  if (!vid) return;
  vid.pause();
  vid.muted = true;
  vid.removeAttribute('src');
  vid.removeAttribute('data-src');
  vid.removeAttribute('data-role');
  try { vid.load(); } catch { /* ok */ }
}
/** Only the visible page may have sound; mute everyone else immediately. */
function silenceDouyinExcept(keepVid) {
  const feed = $('douyinFeed');
  if (!feed) return;
  feed.querySelectorAll('video').forEach((vid) => {
    if (vid === keepVid) return;
    if (!vid.muted) vid.muted = true;
  });
}
/** Tie audible video to the nearest snap page while the finger is still scrolling (keeps iOS unmute in-gesture). */
function syncDouyinAudibleFromScroll() {
  const feed = $('douyinFeed');
  if (!feed || $('douyinOverlay')?.hidden) return;
  const h = douyinPageHeight();
  if (h < 8 || !feed.children.length) return;
  const page = Math.max(0, Math.min(feed.children.length - 1, Math.round(feed.scrollTop / h)));
  for (let i = 0; i < feed.children.length; i++) {
    const vid = feed.children[i].querySelector('video');
    if (!vid?.dataset.src) continue;
    if (i === page) {
      silenceDouyinExcept(vid);
      vid.muted = false;
      if (vid.paused) vid.play().catch(() => {});
    } else if (!vid.muted) {
      vid.muted = true;
    }
  }
}
function warmDouyinItem(item) {
  if (!item?.path) return;
  const key = item.path;
  if (douyinWarmKeys.has(key)) return;
  douyinWarmKeys.add(key);
  const ctrl = new AbortController();
  douyinWarmAbort.set(key, ctrl);
  // Kick remux + cache a short head so the slot can attach without a cold start.
  fetch('/api/play?' + qs({ path: key }), {
    headers: { Range: 'bytes=0-524287' },
    signal: ctrl.signal
  }).then((res) => (res.ok || res.status === 206) ? res.arrayBuffer() : null).catch(() => {}).finally(() => {
    douyinWarmAbort.delete(key);
  });
}
function clearDouyinWarms() {
  douyinWarmAbort.forEach((ctrl) => { try { ctrl.abort(); } catch { /* ok */ } });
  douyinWarmAbort.clear();
  douyinWarmKeys.clear();
}
function bindDouyinVideo(vid, item, play) {
  const src = douyinMediaUrl(item);
  if (!src) {
    clearDouyinVideo(vid);
    return;
  }
  const same = vid.dataset.src === src;
  if (!same) {
    vid.dataset.src = src;
    vid.preload = 'auto';
    vid.setAttribute('preload', 'auto');
    vid.src = src;
    try { vid.load(); } catch { /* ok */ }
  } else {
    vid.preload = 'auto';
    vid.setAttribute('preload', 'auto');
  }
  vid.loop = true;
  vid.dataset.role = play ? 'current' : 'buffer';
  if (play) {
    silenceDouyinExcept(vid);
    vid.muted = false;
    if (!same && vid.currentTime > 0.05) {
      try { vid.currentTime = 0; } catch { /* ok */ }
    }
    vid.play().catch(() => {});
  } else {
    // Keep decoder warm: silent play-then-pause forces real media buffer on many browsers.
    vid.muted = true;
    const kick = vid.play();
    if (kick && typeof kick.then === 'function') {
      kick.then(() => {
        if (vid.dataset.role !== 'buffer' || vid.dataset.src !== src) return;
        vid.pause();
        try { if (vid.currentTime > 0.2) vid.currentTime = 0; } catch { /* ok */ }
      }).catch(() => { vid.pause(); });
    } else {
      vid.pause();
    }
  }
}
function makeDouyinSlide() {
  const slide = document.createElement('div');
  slide.className = 'douyin-slide';
  const vid = document.createElement('video');
  vid.playsInline = true;
  vid.setAttribute('playsinline', '');
  vid.setAttribute('webkit-playsinline', '');
  vid.preload = 'auto';
  vid.setAttribute('preload', 'auto');
  vid.loop = true;
  const speed = document.createElement('button');
  speed.type = 'button';
  speed.className = 'douyin-speed-btn';
  speed.textContent = '1x';
  speed.title = '1x / 2x';
  const meta = document.createElement('div');
  meta.className = 'douyin-meta';
  meta.innerHTML = '<div class="douyin-progress"><i><b></b></i></div><div class="douyin-name"></div>';
  let barRaf = 0;
  vid.addEventListener('timeupdate', () => {
    if (barRaf) return;
    barRaf = requestAnimationFrame(() => {
      barRaf = 0;
      const bar = slide.querySelector('.douyin-progress b');
      if (bar) bar.style.width = vid.duration ? ((vid.currentTime / vid.duration) * 100) + '%' : '0%';
    });
  });
  slide.append(vid, speed, meta);
  return slide;
}
function paintDouyinSlide(slide, item, play) {
  const vid = slide.querySelector('video');
  const speed = slide.querySelector('.douyin-speed-btn');
  const name = slide.querySelector('.douyin-name');
  const bar = slide.querySelector('.douyin-progress b');
  slide.classList.toggle('empty', !item);
  if (name) name.textContent = item ? (item.name || '') : '';
  if (bar && (!item || vid?.dataset.src !== douyinMediaUrl(item))) bar.style.width = '0%';
  if (speed) {
    if (!item || vid?.dataset.src !== douyinMediaUrl(item)) {
      speed.textContent = '1x';
      speed.classList.remove('on');
    }
    speed.hidden = !item;
  }
  bindDouyinVideo(vid, item, play);
}
function syncDouyinSlideMeta(slide, item) {
  const name = slide.querySelector('.douyin-name');
  const speed = slide.querySelector('.douyin-speed-btn');
  const vid = slide.querySelector('video');
  slide.classList.toggle('empty', !item);
  if (name) name.textContent = item ? (item.name || '') : '';
  if (speed) {
    const rate = vid && vid.playbackRate === 2 ? 2 : 1;
    speed.textContent = rate === 2 ? '2x' : '1x';
    speed.classList.toggle('on', rate === 2);
    speed.hidden = !item;
  }
}
function douyinPageHeight() {
  return $('douyinFeed')?.clientHeight || window.innerHeight || 1;
}
function lockDouyin(ms = 160) {
  douyinLock = true;
  clearTimeout(douyinUnlockTimer);
  douyinUnlockTimer = setTimeout(() => { douyinLock = false; }, ms);
}
function centerDouyinFeed() {
  const feed = $('douyinFeed');
  if (!feed) return;
  // Jump to middle slot; briefly disable snap so iOS doesn't fight the reset.
  lockDouyin(420);
  feed.classList.add('no-snap');
  feed.scrollTop = douyinPageHeight();
  requestAnimationFrame(() => {
    feed.scrollTop = douyinPageHeight();
    requestAnimationFrame(() => feed.classList.remove('no-snap'));
  });
}
function warmDouyinNeighbors() {
  const n = douyinItems.length;
  if (n < 2) return;
  const next = douyinItems[(douyinIndex + 1) % n];
  const prev = douyinItems[(douyinIndex - 1 + n) % n];
  const next2 = n > 2 ? douyinItems[(douyinIndex + 2) % n] : null;
  warmDouyinItem(next);
  warmDouyinItem(prev);
  if (next2 && douyinItemKey(next2) !== douyinItemKey(next)) warmDouyinItem(next2);
}
function fillDouyinWindow(index) {
  const n = douyinItems.length;
  const feed = $('douyinFeed');
  if (!feed || feed.children.length < 3 || !n) return;
  douyinIndex = ((index % n) + n) % n;
  const cur = douyinItems[douyinIndex] || null;
  const prev = n > 1 ? douyinItems[(douyinIndex - 1 + n) % n] : null;
  const next = n > 1 ? douyinItems[(douyinIndex + 1) % n] : null;
  paintDouyinSlide(feed.children[0], prev, false);
  paintDouyinSlide(feed.children[1], cur, true);
  paintDouyinSlide(feed.children[2], next, false);
  warmDouyinNeighbors();
}
function stepDouyin(dir, opts = {}) {
  const force = !!opts.force;
  // Scroll locks ignore residual fling; explicit UI (buttons) must still work.
  if ((!force && (douyinLock || douyinStepLock)) || $('douyinOverlay').hidden) return false;
  if (force && douyinStepLock) return false;
  const n = douyinItems.length;
  const feed = $('douyinFeed');
  if (n <= 1) {
    centerDouyinFeed();
    return false;
  }
  if (!feed || feed.children.length < 3) return false;
  douyinStepLock = true;
  douyinLock = false;
  clearTimeout(douyinUnlockTimer);
  if (dir > 0) {
    douyinIndex = (douyinIndex + 1) % n;
    feed.appendChild(feed.children[0]);
    const prev = douyinItems[(douyinIndex - 1 + n) % n];
    const cur = douyinItems[douyinIndex];
    const next = douyinItems[(douyinIndex + 1) % n];
    syncDouyinSlideMeta(feed.children[0], prev);
    bindDouyinVideo(feed.children[0].querySelector('video'), prev, false);
    syncDouyinSlideMeta(feed.children[1], cur);
    bindDouyinVideo(feed.children[1].querySelector('video'), cur, true);
    paintDouyinSlide(feed.children[2], next, false);
  } else {
    douyinIndex = (douyinIndex - 1 + n) % n;
    feed.insertBefore(feed.children[2], feed.children[0]);
    const prev = douyinItems[(douyinIndex - 1 + n) % n];
    const cur = douyinItems[douyinIndex];
    const next = douyinItems[(douyinIndex + 1) % n];
    paintDouyinSlide(feed.children[0], prev, false);
    syncDouyinSlideMeta(feed.children[1], cur);
    bindDouyinVideo(feed.children[1].querySelector('video'), cur, true);
    syncDouyinSlideMeta(feed.children[2], next);
    bindDouyinVideo(feed.children[2].querySelector('video'), next, false);
  }
  warmDouyinNeighbors();
  centerDouyinFeed();
  setTimeout(() => { douyinStepLock = false; }, 320);
  return true;
}
function settleDouyinScroll() {
  if (douyinLock || douyinStepLock || $('douyinOverlay').hidden) return;
  const feed = $('douyinFeed');
  const h = douyinPageHeight();
  if (!feed || h < 8) return;
  // Wait for CSS snap to finish, then recycle the 3-slot window.
  const page = Math.round(feed.scrollTop / h);
  if (page === 1) return;
  if (page <= 0) {
    if (!stepDouyin(-1)) {
      lockDouyin(220);
      feed.scrollTop = h;
    }
    return;
  }
  if (page >= 2) {
    if (!stepDouyin(1)) {
      lockDouyin(220);
      feed.scrollTop = h;
    }
  }
}
function leaveDouyin(opts = {}) {
  const feed = $('douyinFeed');
  const item = opts.sync ? douyinItems[douyinIndex] : null;
  const mid = feed?.children?.[1]?.querySelector('video');
  const time = opts.sync && mid && Number.isFinite(mid.currentTime) ? mid.currentTime : 0;

  const overlay = $('douyinOverlay');
  overlay.hidden = true;
  overlay.classList.remove('ui-hidden');
  $('douyinBtn').classList.remove('on');
  if (feed && douyinOnScroll) feed.removeEventListener('scroll', douyinOnScroll);
  if (feed && douyinOnScrollEnd) feed.removeEventListener('scrollend', douyinOnScrollEnd);
  if (feed && douyinOnWheel) feed.removeEventListener('wheel', douyinOnWheel);
  douyinOnScroll = null;
  douyinOnScrollEnd = null;
  douyinOnWheel = null;
  clearTimeout(douyinScrollTimer);
  clearTimeout(douyinUnlockTimer);
  douyinLock = false;
  douyinStepLock = false;
  douyinItems = [];
  douyinIndex = 0;
  clearDouyinWarms();
  if (feed) {
    feed.classList.remove('no-snap');
    feed.onclick = null;
  }
  requestAnimationFrame(() => {
    if (!feed) return;
    feed.querySelectorAll('video').forEach(clearDouyinVideo);
    feed.innerHTML = '';
  });
  if (item) openListItem(item, time);
}
function enterDouyin() {
  const list = currentList().filter((item) => item.type === 'video');
  if (!list.length) return toast('当前没有可播放的视频');
  const key = state.player ? (state.player.kind === 'trick' ? state.player.id : state.player.path || state.player.key) : '';
  let start = list.findIndex((item) => (item.id || item.path || item.key) === key);
  if (start < 0) start = 0;

  $('video').pause();
  $('douyinOverlay').classList.remove('ui-hidden');
  $('douyinOverlay').hidden = false;
  $('douyinBtn').classList.add('on');

  const feed = $('douyinFeed');
  if (douyinOnScroll) feed.removeEventListener('scroll', douyinOnScroll);
  if (douyinOnScrollEnd) feed.removeEventListener('scrollend', douyinOnScrollEnd);
  if (douyinOnWheel) feed.removeEventListener('wheel', douyinOnWheel);
  clearTimeout(douyinScrollTimer);
  clearTimeout(douyinUnlockTimer);
  clearDouyinWarms();
  douyinLock = false;
  douyinStepLock = false;
  feed.classList.remove('no-snap');
  feed.querySelectorAll('video').forEach(clearDouyinVideo);
  feed.innerHTML = '';
  douyinItems = list;

  // Fixed 3-slot scroller: recycle on settle so phones never hold N decoders.
  feed.append(makeDouyinSlide(), makeDouyinSlide(), makeDouyinSlide());
  feed.onclick = (event) => {
    const slide = event.target.closest('.douyin-slide');
    if (!slide || slide.classList.contains('empty')) return;
    if (event.target.closest('.douyin-speed-btn')) {
      event.stopPropagation();
      const vid = slide.querySelector('video');
      if (!vid || !vid.src) return;
      const btn = slide.querySelector('.douyin-speed-btn');
      const next = vid.playbackRate === 2 ? 1 : 2;
      vid.playbackRate = next;
      if (btn) {
        btn.textContent = next === 2 ? '2x' : '1x';
        btn.classList.toggle('on', next === 2);
      }
      if (vid.paused) vid.play().catch(() => {});
      return;
    }
    if (event.target.closest('.douyin-progress')) {
      event.stopPropagation();
      const vid = slide.querySelector('video');
      const track = slide.querySelector('.douyin-progress');
      if (!vid || !vid.duration || !track) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      vid.currentTime = ratio * vid.duration;
      return;
    }
    const rect = slide.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    if (x > 0.33 && x < 0.67) {
      const vid = slide.querySelector('video');
      if (!vid || !vid.src) return;
      if (vid.paused) vid.play().catch(() => {});
      else vid.pause();
    } else $('douyinOverlay').classList.toggle('ui-hidden');
  };
  // Wheel: one notch / gesture = exactly one video. Native snap + settle was skipping.
  douyinOnWheel = (event) => {
    if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    event.preventDefault();
    if (douyinLock || douyinStepLock) return;
    if (event.deltaY > 2) stepDouyin(1);
    else if (event.deltaY < -2) stepDouyin(-1);
  };
  let douyinAudioRaf = 0;
  douyinOnScroll = () => {
    // Switch sound with the visible page during the gesture (stops old audio + unlocks new on iOS).
    if (!douyinAudioRaf) {
      douyinAudioRaf = requestAnimationFrame(() => {
        douyinAudioRaf = 0;
        if (!douyinLock && !douyinStepLock) syncDouyinAudibleFromScroll();
      });
    }
    if (douyinLock || douyinStepLock) return;
    clearTimeout(douyinScrollTimer);
    // Backup when scrollend is missing; wait for snap to settle.
    douyinScrollTimer = setTimeout(settleDouyinScroll, 120);
  };
  douyinOnScrollEnd = () => {
    clearTimeout(douyinScrollTimer);
    if (!douyinLock && !douyinStepLock) syncDouyinAudibleFromScroll();
    settleDouyinScroll();
  };
  feed.addEventListener('wheel', douyinOnWheel, { passive: false });
  feed.addEventListener('scroll', douyinOnScroll, { passive: true });
  feed.addEventListener('scrollend', douyinOnScrollEnd);

  fillDouyinWindow(start);
  centerDouyinFeed();
}
function videoAreaFullscreen() {
  const box = $('detailVideoBox');
  return document.fullscreenElement === box || box.classList.contains('stage-fill');
}
function toggleVideoAreaFullscreen() {
  const box = $('detailVideoBox');
  if (box.classList.contains('stage-fill')) {
    box.classList.remove('stage-fill');
    return;
  }
  if (document.fullscreenElement === box) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  if (document.fullscreenElement === document.documentElement) {
    box.classList.add('stage-fill');
    return;
  }
  box.requestFullscreen().catch(() => {});
}
function wire() {
  $('menuBtn').onclick = (event) => {
    event.stopPropagation();
    const app = $('app');
    if (isMobileLayout()) {
      app.classList.toggle('nav-open');
      syncMobileNavA11y();
      syncAppTopH();
      return;
    }
    const next = !app.classList.contains('collapsed');
    app.classList.toggle('collapsed', next);
    localStorage.setItem('tv2-side-collapsed', next ? '1' : '0');
    $('menuBtn').title = next ? '展开侧栏' : '收起侧栏';
    $('menuBtn').setAttribute('aria-label', $('menuBtn').title);
  };
  $('filterToggleBtn').onclick = (event) => {
    event.stopPropagation();
    const top = document.querySelector('.top');
    if (!top || !isMobileLayout()) return;
    top.classList.toggle('filters-open');
    syncTopChrome();
    requestAnimationFrame(syncAppTopH);
  };
  if (localStorage.getItem('tv2-side-collapsed') === '1' && !isMobileLayout()) {
    $('app').classList.add('collapsed');
    $('menuBtn').title = '展开侧栏';
    $('menuBtn').setAttribute('aria-label', '展开侧栏');
  }
  $('navBackdrop').onclick = () => closeMobileNav();
  $('main').addEventListener('click', () => closeMobileNav());
  bindMobileNavGestures();
  window.addEventListener('resize', () => syncTopChrome());
  syncTopChrome();
  $('modeBtn').onclick = (event) => {
    event.stopPropagation();
    $('modeDrop').hidden = !$('modeDrop').hidden;
  };
  $('modeDrop').onclick = (event) => {
    event.stopPropagation();
    const button = event.target.closest('[data-view]');
    if (!button) return;
    $('modeDrop').hidden = true;
    setView(button.dataset.view);
  };
  $('openPath').onclick = () => openRoot($('pathInput').value.trim());
  $('pathInput').onkeydown = (event) => { if (event.key === 'Enter') openRoot($('pathInput').value.trim()); };
  $('workspaceBtn').onclick = (event) => {
    event.stopPropagation();
    toggleWorkspaceDrop();
  };
  $('workspaceList').onclick = (event) => {
    const forget = event.target.closest('[data-forget]');
    if (forget) {
      event.stopPropagation();
      removeRecent(forget.dataset.forget);
      return;
    }
    const item = event.target.closest('[data-open]');
    if (!item) return;
    event.stopPropagation();
    openRoot(item.dataset.open).catch((err) => toast(err.message));
  };
  $('workspaceAdd').onclick = (event) => {
    event.stopPropagation();
    const row = $('workspaceNew');
    row.hidden = !row.hidden;
    if (!row.hidden) {
      $('workspaceNewInput').value = '';
      $('workspaceNewInput').focus();
    }
  };
  $('workspaceNewOk').onclick = (event) => {
    event.stopPropagation();
    openRoot($('workspaceNewInput').value.trim()).catch((err) => toast(err.message));
  };
  $('workspaceNewInput').onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      openRoot($('workspaceNewInput').value.trim()).catch((err) => toast(err.message));
    }
  };
  $('workspaceDrop').addEventListener('click', (event) => event.stopPropagation());
  syncWorkspace();
  $('historyBtn').onclick = async (event) => {
    event.stopPropagation();
    await loadHistory();
    renderHistory();
    $('historyPop').hidden = !$('historyPop').hidden;
  };
  $('helpBtn').onclick = (event) => {
    event.stopPropagation();
    const pop = $('helpPop');
    if (!pop.hidden) {
      pop.hidden = true;
      return;
    }
    $('cardPrefsPop').hidden = true;
    $('historyPop').hidden = true;
    renderHelp();
    pop.hidden = false;
    const rect = $('helpBtn').getBoundingClientRect();
    pop.style.top = rect.bottom + 8 + 'px';
    pop.style.right = '18px';
    pop.style.left = 'auto';
  };
  $('cardPrefsBtn').onclick = (event) => {
    event.stopPropagation();
    const pop = $('cardPrefsPop');
    if (!pop.hidden) {
      pop.hidden = true;
      return;
    }
    $('helpPop').hidden = true;
    renderCardPrefs();
    pop.hidden = false;
    const rect = $('cardPrefsBtn').getBoundingClientRect();
    pop.style.top = rect.bottom + 8 + 'px';
    const popW = Math.min(420, window.innerWidth - 24);
    pop.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - popW - 12)) + 'px';
    pop.style.right = 'auto';
  };
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.pop') && !event.target.closest('#historyBtn') && !event.target.closest('#helpBtn') && !event.target.closest('#historyPop') && !event.target.closest('#cardPrefsBtn') && !event.target.closest('#cardPrefsPop')) {
      $('historyPop').hidden = true;
      $('helpPop').hidden = true;
      $('cardPrefsPop').hidden = true;
    }
    if (!event.target.closest('#mode')) $('modeDrop').hidden = true;
    if (!event.target.closest('#streamMenu')) $('streamDrop').hidden = true;
    if (!event.target.closest('#ctx')) $('ctx').hidden = true;
    if (!event.target.closest('#workspace')) closeWorkspaceDrop();
  });
  $('fullBtn').onclick = () => {
    // Page/browser fullscreen only (F11-like). Video uses its own control.
    if (document.fullscreenElement === document.documentElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    const enterPage = () => document.documentElement.requestFullscreen().catch(() => {});
    if (document.fullscreenElement) {
      document.exitFullscreen().then(enterPage).catch(enterPage);
      return;
    }
    enterPage();
  };
  if (window.tv2Desktop) {
    document.documentElement.classList.add('electron');
    if ($('winControls')) $('winControls').hidden = false;
    if ($('winMin')) $('winMin').onclick = () => window.tv2Desktop.minimize();
    if ($('winMax')) $('winMax').onclick = () => window.tv2Desktop.maximize();
    if ($('winClose')) $('winClose').onclick = () => window.tv2Desktop.close();
  }
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement !== document.documentElement) $('detailVideoBox').classList.remove('stage-fill');
  });
  $('browseBody').addEventListener('click', (event) => {
    const crumb = event.target.closest('[data-crumb]');
    if (!crumb) return;
    openCrumb(crumb.dataset.crumb);
  });
  $('search').oninput = () => {
    state.query = $('search').value;
    if (state.view === 'browse' && state.root) renderGrid();
    if (state.view === 'library') loadLibrary().catch(() => {});
    if (state.view === 'local' && state.local.root) renderLocalGrid().catch(() => {});
  };
  $('sideAdd').onclick = () => createFolder().catch((err) => toast(err.message));
  $('sideBody').onclick = (event) => {
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const folderPath = toggle.dataset.toggle;
      if (state.expanded.has(folderPath)) state.expanded.delete(folderPath);
      else state.expanded.add(folderPath);
      renderSide();
      return;
    }
    const localToggle = event.target.closest('[data-local-toggle]');
    if (localToggle) {
      if (!state.localExpanded) {
        state.localExpanded = new Set();
        const fill = (node) => { state.localExpanded.add(node.key); (node.folders || []).forEach(fill); };
        if (state.local.tree) fill(state.local.tree);
      }
      const key = localToggle.dataset.localToggle;
      if (state.localExpanded.has(key)) state.localExpanded.delete(key);
      else state.localExpanded.add(key);
      renderLocalSide();
      return;
    }
    const folder = event.target.closest('[data-folder]');
    if (folder) {
      closeMobileNav();
      selectFolder(folder.dataset.folder).catch((err) => toast(err.message));
    }
    const cat = event.target.closest('[data-cat]');
    if (cat && state.view === 'library') {
      closeMobileNav();
      state.category = cat.dataset.cat;
      loadLibrary().catch((err) => toast(err.message));
    }
    const localFolder = event.target.closest('[data-local]');
    if (localFolder) {
      closeMobileNav();
      state.local.folder = localFolder.dataset.local;
      renderLocalSide();
      renderLocalGrid().catch((err) => toast(err.message));
    }
  };
  $('sideBody').oncontextmenu = (event) => {
    const folder = event.target.closest('[data-folder]');
    if (!folder) return;
    event.preventDefault();
    const folderPath = folder.dataset.folder;
    openMenu(event.clientX, event.clientY, [
      { label: '新建文件夹', run: async () => { const name = await askText('新文件夹', ''); if (!name) return; await api('/api/folder/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent: folderPath, name }) }); await refreshBrowse(); } },
      { label: '重命名', run: async () => { const next = await renamePath(folderPath, true); if (next) { followPath(folderPath, next); await refreshBrowse(); } } },
      { label: '删除', danger: true, run: async () => { if (await deletePath(folderPath, true)) { if (state.folder === folderPath) state.folder = dirname(folderPath); await refreshBrowse(); } } }
    ]);
  };
  $('sideBody').addEventListener('dragstart', (event) => {
    const folder = event.target.closest('[data-folder]');
    if (!folder) return;
    event.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'folder', path: folder.dataset.folder }));
  });
  $('sideBody').addEventListener('dragover', (event) => {
    const row = event.target.closest('[data-drop], [data-local-drop]');
    if (!row) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = event.dataTransfer.types?.includes('Files') ? 'copy' : 'move';
    }
    document.querySelectorAll('.tree-row.drop').forEach((item) => item.classList.remove('drop'));
    row.classList.add('drop');
  });
  $('sideBody').addEventListener('dragleave', (event) => {
    const row = event.target.closest('[data-drop], [data-local-drop]');
    if (row) row.classList.remove('drop');
  });
  $('sideBody').addEventListener('drop', (event) => {
    const folder = event.target.closest('[data-drop]');
    document.querySelectorAll('.tree-row.drop').forEach((item) => item.classList.remove('drop'));
    if (!folder) return;
    event.preventDefault();
    const osFiles = [...(event.dataTransfer?.files || [])];
    if (osFiles.length) {
      uploadFiles(folder.dataset.drop, osFiles)
        .then(async () => {
          await refreshBrowse();
          toast('上传好了');
        })
        .catch((err) => toast(err.message));
      return;
    }
    onDropFolder(folder.dataset.drop, dragPayload(event)).catch((err) => toast(err.message));
  });
  $('sortSeg').onclick = (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    const next = button.dataset.sort;
    if (next === 'shuffle' && state.sort === 'shuffle') reshuffleGridOrder();
    else if (next === 'shuffle') reshuffleGridOrder();
    state.sort = next;
    localStorage.setItem('tv2-sort', state.sort);
    syncSortButtons();
    renderGrid();
  };
  $('folderHistoryBtn').onclick = () => {
    toggleFolderHistory().catch((err) => toast(err.message));
  };
  $('filterSeg').onclick = (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.filter = normalizeFolderFilter(button.dataset.filter);
    if (state.view === 'browse' && state.folder) saveFolderFilter(state.folder, state.filter);
    syncSortButtons();
    if (state.view === 'browse') renderGrid();
    if (state.view === 'local') renderLocalGrid().catch(() => {});
  };
  state.cardPrefs = { ...CARD_DEFAULTS };
  applyCardPrefs(CARD_DEFAULTS);
  ['grid', 'trickGrid', 'localGrid'].forEach((id) => { if ($(id)) bindHover($(id)); });
  $('hoverSound').onclick = (event) => {
    event.stopPropagation();
    localStorage.setItem('tv2-preview-sound', $('hoverVideo').muted ? '1' : '0');
    syncHoverSound();
  };
  $('hoverContinue').onclick = continueFromPreview;
  const scrub = $('hoverScrub');
  scrub.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    scrubDrag = true;
    scrub.setPointerCapture(event.pointerId);
    $('hoverVideo').pause();
    scrubAt(event);
  });
  scrub.addEventListener('pointermove', (event) => {
    if (!scrubDrag) return;
    scrubAt(event);
  });
  const finishScrub = (event) => {
    if (!scrubDrag) return;
    scrubDrag = false;
    scrubAt(event);
    if (hoverCard && !$('hoverPreview').classList.contains('hint-only')) $('hoverVideo').play().catch(() => {});
  };
  scrub.addEventListener('pointerup', finishScrub);
  scrub.addEventListener('pointercancel', finishScrub);
  scrub.addEventListener('click', (event) => event.stopPropagation());
  const previewBox = $('hoverPreview');
  previewBox.addEventListener('mouseleave', () => {
    if (scrubDrag || boxDrag) return;
    if (stickyPreview()) return;
    hideHover();
  });
  previewBox.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (!stickyPreview() || previewBox.classList.contains('hint-only')) return;
    if (event.target.closest('#hoverScrub, #hoverSound, #hoverContinue, button, a')) return;
    event.preventDefault();
    const rect = previewBox.getBoundingClientRect();
    boxDrag = {
      id: event.pointerId,
      ox: event.clientX,
      oy: event.clientY,
      left: rect.left,
      top: rect.top
    };
    previewMoved = true;
    previewBox.classList.add('dragging');
    previewBox.setPointerCapture(event.pointerId);
  });
  previewBox.addEventListener('pointermove', (event) => {
    if (!boxDrag || boxDrag.id !== event.pointerId) return;
    const margin = 8;
    const w = previewBox.offsetWidth;
    const h = previewBox.offsetHeight;
    let left = boxDrag.left + (event.clientX - boxDrag.ox);
    let top = boxDrag.top + (event.clientY - boxDrag.oy);
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - margin - w));
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - margin - h));
    previewBox.style.left = Math.round(left) + 'px';
    previewBox.style.top = Math.round(top) + 'px';
  });
  const endBoxDrag = (event) => {
    if (!boxDrag || (event.pointerId != null && boxDrag.id !== event.pointerId)) return;
    boxDrag = null;
    previewBox.classList.remove('dragging');
  };
  previewBox.addEventListener('pointerup', endBoxDrag);
  previewBox.addEventListener('pointercancel', endBoxDrag);
  window.addEventListener('keyup', (event) => {
    if (previewMode() !== 'key') return;
    if (!matchesPreviewHotkey(event)) return;
    if (event.target instanceof Element && event.target.matches('input, textarea')) return;
    if (!$('player').hidden) return;
    event.preventDefault();
    clearTimeout(previewHoldTimer);
    if (previewHolding) {
      hideHover();
      previewHolding = false;
      return;
    }
    if (Date.now() - previewKeyDownAt < 280) togglePreviewHotkey();
  });
  bindRightHold($('detailVideoBox'));
  $('uploadBtn').onclick = () => $('uploadInput').click();
  $('uploadInput').onchange = async () => {
    if (!state.folder || !$('uploadInput').files.length) return;
    const files = [...$('uploadInput').files];
    $('uploadInput').value = '';
    try {
      await uploadFiles(state.folder, files);
      await refreshBrowse();
      toast('上传好了');
    } catch (err) { toast(err.message); }
  };
  const miniAudio = $('miniAudio');
  if (miniAudio) {
    miniAudio.volume = Math.min(1, Math.max(0, state.audioVolume));
    miniAudio.addEventListener('timeupdate', () => {
      syncMiniProgress();
      if ('mediaSession' in navigator && state.audioTrack && !state.audioScrubbing) {
        try {
          if (Number.isFinite(miniAudio.duration) && miniAudio.duration > 0) {
            navigator.mediaSession.setPositionState({
              duration: miniAudio.duration,
              playbackRate: miniAudio.playbackRate || 1,
              position: Math.min(miniAudio.currentTime || 0, miniAudio.duration)
            });
          }
        } catch { /* ok */ }
      }
    });
    miniAudio.addEventListener('seeked', () => {
      if (!state.audioScrubbing) syncMiniProgress();
    });
    miniAudio.addEventListener('play', () => {
      syncMiniPlayButton();
      if ('mediaSession' in navigator) {
        try { navigator.mediaSession.playbackState = 'playing'; } catch { /* ok */ }
      }
    });
    miniAudio.addEventListener('pause', () => {
      syncMiniPlayButton();
      if ('mediaSession' in navigator) {
        try { navigator.mediaSession.playbackState = 'paused'; } catch { /* ok */ }
      }
    });
    miniAudio.addEventListener('ended', () => {
      if (state.audioLoop) {
        try { miniAudio.currentTime = 0; } catch { /* ok */ }
        miniAudio.play().catch(() => {});
        syncMiniPlayButton();
        return;
      }
      const list = audioList();
      if (list.length > 1) playAudioRelative(1);
      else syncMiniPlayButton();
    });
  }
  $('miniPlay')?.addEventListener('click', () => toggleMiniPlay());
  $('miniPrev')?.addEventListener('click', () => playAudioRelative(-1));
  $('miniNext')?.addEventListener('click', () => playAudioRelative(1));
  $('miniLoop')?.addEventListener('click', () => toggleMiniLoop());
  $('miniCover')?.addEventListener('click', () => openAudioStage());
  $('miniClose')?.addEventListener('click', () => closeMiniPlayer());
  syncMiniLoopButton();
  bindAudioScrub($('miniScrub'));
  bindAudioScrub($('audioStageScrub'));
  $('audioStageClose')?.addEventListener('click', () => closeAudioStage());
  $('audioStagePlay')?.addEventListener('click', () => toggleMiniPlay());
  $('audioStagePrev')?.addEventListener('click', () => playAudioRelative(-1));
  $('audioStageNext')?.addEventListener('click', () => playAudioRelative(1));
  $('audioStageLoop')?.addEventListener('click', () => toggleMiniLoop());
  $('audioStageDownload')?.addEventListener('click', () => {
    downloadAudioCached().catch((err) => toast(err.message));
  });
  $('audioStageVolBtn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = $('audioStageVolMenu');
    const btn = $('audioStageVolBtn');
    if (!menu || !btn) return;
    const open = menu.hidden;
    closeAudioStageMenus();
    if (open) {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    }
  });
  $('audioStageVol')?.addEventListener('input', () => {
    const vol = Number($('audioStageVol').value);
    state.audioVolume = Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 1;
    localStorage.setItem('tv2-audio-vol', String(state.audioVolume));
    if ($('miniAudio')) $('miniAudio').volume = state.audioVolume;
  });
  $('audioStageVolMenu')?.addEventListener('click', (event) => event.stopPropagation());
  $('audioStageInfoBtn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleAudioInfoMenu().catch((err) => toast(err.message));
  });
  $('audioStageInfoMenu')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const pick = event.target.closest?.('[data-audio-quality]');
    if (pick) {
      compressCurrentAudio(pick.dataset.audioQuality).catch((err) => toast(err.message));
      return;
    }
    if (event.target.closest?.('#audioStageDeleteBtn')) {
      markAudioPendingDelete();
      return;
    }
    if (event.target.closest?.('#audioStageDeleteUndo')) {
      undoAudioPendingDelete();
    }
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('.audio-vol-wrap')) return;
    if (event.target.closest?.('.audio-info-wrap')) return;
    closeAudioStageMenus();
  });
  document.addEventListener('keydown', (event) => {
    if ($('audioStage')?.hidden) return;
    if (event.target instanceof Element && event.target.matches('input, textarea')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      const anyOpen = ($('audioStageVolMenu') && !$('audioStageVolMenu').hidden)
        || ($('audioStageInfoMenu') && !$('audioStageInfoMenu').hidden);
      if (anyOpen) closeAudioStageMenus();
      else closeAudioStage();
    } else if (event.key === ' ') {
      event.preventDefault();
      toggleMiniPlay();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      playAudioRelative(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      playAudioRelative(1);
    }
  });
  $('grid').onclick = (event) => {
    const enter = event.target.closest('[data-enter]');
    if (enter) return selectFolder(enter.dataset.enter).catch((err) => toast(err.message));
    const tag = event.target.closest('.card-tag');
    if (tag) {
      const host = tag.closest('[data-file]');
      if (host) openTag(host.dataset.file, tag.dataset.tagIndex);
      return;
    }
    const card = event.target.closest('[data-file]');
    if (!card) return;
    const file = fileByPath(card.dataset.file);
    if (!file) return;
    if (event.ctrlKey || event.metaKey) {
      if (state.selected.has(file.path)) state.selected.delete(file.path);
      else state.selected.add(file.path);
      renderGrid();
      return;
    }
    openFile(file).catch((err) => toast(err.message));
  };
  $('grid').oncontextmenu = (event) => {
    const card = event.target.closest('[data-file]');
    if (!card) return;
    event.preventDefault();
    const file = fileByPath(card.dataset.file);
    const menu = [
      { label: '播放', run: () => openFile(file) },
      { label: '重命名', run: async () => {
        const next = await renamePath(file.path, false);
        if (!next) return;
        await selectFolder(state.folder, { keepPlayer: true, preserveShuffle: true, preserveScroll: true });
      } },
      { label: '删除', danger: true, run: async () => {
        if (await deletePath(file.path, false)) await softRemoveFile(file.path);
      } }
    ];
    if (fileKind(file) === 'video') {
      menu.push({ label: '转成 720p', run: () => startConvert('/api/convert/file?' + qs({ path: file.path, quality: '720p' })) });
    }
    openMenu(event.clientX, event.clientY, menu);
  };
  $('grid').addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-file]');
    if (!card) return;
    const paths = state.selected.has(card.dataset.file) ? [...state.selected] : [card.dataset.file];
    event.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'files', paths }));
  });
  $('backBtn').onclick = closePlayer;
  $('prevBtn').onclick = () => playRelative(-1);
  $('nextBtn').onclick = () => playRelative(1);
  $('repeatBtn').onclick = () => {
    state.repeat = state.repeat === 'one' ? 'all' : 'one';
    localStorage.setItem('tv2-repeat', state.repeat);
    updateChrome();
    toast(state.repeat === 'one' ? '单曲循环已开' : '单曲循环已关');
  };
  $('shuffleBtn').onclick = () => {
    state.shuffle = !state.shuffle;
    resetShuffleCycle();
    localStorage.setItem('tv2-shuffle', state.shuffle ? '1' : '0');
    updateChrome();
    toast(state.shuffle ? '随机已开（播完一轮才重复）' : '随机已关');
  };
  $('detailDelete').onclick = () => deleteCurrentAndContinue();
  $('infoBtn').onclick = () => toggleInfoSection();
  $('notesBtn').onclick = () => $('notesSection').classList.toggle('show');
  $('clipsToggleBtn').onclick = () => $('clipsSection').classList.toggle('show');
  $('shotBtn').onclick = screenshot;
  $('snapPrev').onclick = () => stepSnap(-1);
  $('snapNext').onclick = () => stepSnap(1);
  $('snapClose').onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    $('snapPreview').hidden = true;
  };
  $('snapPreview').onclick = (event) => {
    if (event.target === $('snapPreview') || event.target.closest('#snapClose')) $('snapPreview').hidden = true;
  };
  $('snapSave').onclick = () => {
    if (!snapCanvas) return;
    const link = document.createElement('a');
    link.href = snapCanvas.toDataURL('image/png');
    link.download = (state.player?.name || 'frame') + '.png';
    link.click();
  };
  $('detailTags').onclick = (event) => {
    const tag = event.target.closest('.card-tag');
    if (!tag || state.player?.kind !== 'file') return;
    openTag(state.player.path, tag.dataset.tagIndex);
  };
  $('subSelect').onchange = () => {
    const sub = state.subs[Number($('subSelect').value)];
    if (sub) loadSubtitleFile(sub);
  };
  $('downloadBtn').onclick = () => {
    if (state.player?.kind !== 'file') return;
    const link = document.createElement('a');
    link.href = '/api/stream?' + qs({ path: state.player.path, download: '1' });
    link.download = state.player.name;
    link.click();
  };
  $('detailDrag').addEventListener('dragstart', (event) => {
    if (state.player?.kind !== 'file') { event.preventDefault(); return; }
    event.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'files', paths: [state.player.path] }));
  });
  bindTransport();
  bindVideoResize();
  syncMusicModeButton();
  $('musicModeBtn')?.addEventListener('click', () => {
    toggleMusicMode().catch((err) => toast(err.message));
  });
  $('douyinBtn').onclick = () => enterDouyin();
  $('douyinClose').onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    leaveDouyin({ sync: true });
  };
  // Keep chrome above the feed so mobile taps hit ×, not “hide UI”.
  $('douyinClose').addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
  const bindDouyinNavBtn = (id, dir) => {
    const btn = $(id);
    if (!btn) return;
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      stepDouyin(dir, { force: true });
    });
    btn.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
  };
  bindDouyinNavBtn('douyinPrev', -1);
  bindDouyinNavBtn('douyinNext', 1);
  $('douyinNav')?.addEventListener('pointerdown', (event) => event.stopPropagation());
  // iOS Safari: block double-tap zoom (viewport + touch-action don't always cover it).
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 280) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener('gesturestart', (event) => event.preventDefault());
  $('playerMenuBtn').onclick = (event) => { event.stopPropagation(); playerMore(); };
  $('streamMenuBtn').onclick = (event) => {
    event.stopPropagation();
    $('streamDrop').hidden = !$('streamDrop').hidden;
  };
  $('streamCopy').onclick = async () => {
    const url = currentStreamUrl();
    try { await navigator.clipboard.writeText(url); toast('流地址已复制'); }
    catch { window.prompt('复制这个地址', url); }
    $('streamDrop').hidden = true;
  };
  $('streamOpen').onclick = () => { window.open(currentStreamUrl(), '_blank'); $('streamDrop').hidden = true; };
  $('streamDrop').onclick = (event) => {
    const player = event.target.closest('[data-player]');
    if (player) openStreamPlayer(player.dataset.player);
    const pin = event.target.closest('[data-pin]');
    if (pin) {
      if (localStorage.getItem('tv2-pinned-player') === pin.dataset.pin) {
        localStorage.removeItem('tv2-pinned-player');
        toast('已取消钉住');
      } else {
        localStorage.setItem('tv2-pinned-player', pin.dataset.pin);
        toast('已钉在旁边');
      }
      syncPinned();
    }
  };
  $('streamPinned').onclick = () => openStreamPlayer(localStorage.getItem('tv2-pinned-player'));
  $('markA').onclick = () => {
    state.markA = $('video').currentTime || 0;
    setMarkDisplay('a', state.markA);
  };
  $('markB').onclick = () => {
    state.markB = $('video').currentTime || 0;
    setMarkDisplay('b', state.markB);
  };
  const bindMarkInput = (which) => {
    const el = $(which === 'a' ? 'markAVal' : 'markBVal');
    if (!el) return;
    el.addEventListener('change', () => commitMarkInput(which));
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitMarkInput(which);
        el.blur();
      }
    });
  };
  bindMarkInput('a');
  bindMarkInput('b');
  $('saveClip').onclick = () => saveClip();
  $('clipList').onclick = async (event) => {
    if (event.target.closest('a')) return;
    const jump = event.target.closest('[data-jump]');
    if (jump) {
      const clip = state.clips.find((item) => item.id === jump.dataset.jump);
      if (clip) toggleClipLoop(clip);
      return;
    }
    const del = event.target.closest('[data-delclip]');
    if (del && state.player) {
      if (state.loopClipId === del.dataset.delclip) state.loopClipId = null;
      if (state.player.kind === 'file') await api('/api/clips/' + del.dataset.delclip, { method: 'DELETE' });
      else if (state.player.kind === 'trick') await api(`/api/tricks/${state.player.id}/clips/${del.dataset.delclip}`, { method: 'DELETE' });
      else {
        const all = JSON.parse(localStorage.getItem('tv2-local-clips') || '{}');
        all[state.player.key] = (all[state.player.key] || []).filter((clip) => clip.id !== del.dataset.delclip);
        localStorage.setItem('tv2-local-clips', JSON.stringify(all));
      }
      await loadSidePanel();
    }
  };
  let noteTimer;
  $('notes').oninput = () => { clearTimeout(noteTimer); noteTimer = setTimeout(saveNotes, 500); };
  $('video').ontimeupdate = () => {
    const video = $('video');
    $('playTimeLabel').textContent = clock(video.currentTime) + ' / ' + clock(video.duration);
    showCue(video.currentTime || 0);
    const loop = activeLoopClip();
    if (loop) {
      const end = Number(loop.endTime);
      const start = Number(loop.startTime) || 0;
      if (Number.isFinite(end) && end > start && video.currentTime >= end - 0.04) {
        try { video.currentTime = start; } catch { /* ok */ }
        if (video.paused) video.play().catch(() => {});
      }
    }
    const player = state.player;
    if (!player || player.kind === 'local') return;
    const id = player.kind === 'trick' ? player.id : player.path;
    if (state.histId === id && video.currentTime - state.histAt < 5) return;
    state.histId = id;
    state.histAt = video.currentTime;
    rememberHistory(id, player.name, video.currentTime);
  };
  $('video').onended = () => {
    const loop = activeLoopClip();
    if (loop) {
      try { $('video').currentTime = Number(loop.startTime) || 0; } catch { /* ok */ }
      $('video').play().catch(() => {});
      return;
    }
    if (state.repeat === 'one') { $('video').currentTime = 0; $('video').play().catch(() => {}); }
    else if (state.repeat === 'all') playRelative(1);
  };
  $('trickUploadBtn').onclick = () => $('trickUploadInput').click();
  $('trickUploadInput').onchange = async () => {
    const file = $('trickUploadInput').files[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    if (state.category) body.append('category', state.category);
    try {
      await api('/api/tricks', { method: 'POST', body });
      $('trickUploadInput').value = '';
      await loadLibrary();
    } catch (err) { toast(err.message); }
  };
  $('localGrid').onclick = (event) => {
    const enter = event.target.closest('[data-local-enter]');
    if (enter) { state.local.folder = enter.dataset.localEnter; renderLocalSide(); renderLocalGrid().catch((err) => toast(err.message)); }
    const card = event.target.closest('[data-local-file]');
    if (!card) return;
    const file = state.local.files.find((item) => item.key === card.dataset.localFile);
    if (file) openLocalFile(file).catch((err) => toast(err.message));
  };
  $('localReselect').onclick = () => pickLocal().catch((err) => toast(err.message));
  $('localGrid').addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-local-file]');
    if (!card) return;
    event.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'local-file', key: card.dataset.localFile }));
  });
  $('localGrid').oncontextmenu = (event) => {
    const card = event.target.closest('[data-local-file]');
    if (!card) return;
    event.preventDefault();
    const file = state.local.files.find((item) => item.key === card.dataset.localFile);
    if (!file) return;
    openMenu(event.clientX, event.clientY, [
      { label: '重命名', run: () => renameLocal(file) },
      { label: '删除', danger: true, run: () => deleteLocal(file) }
    ]);
  };
  $('sideBody').addEventListener('drop', async (event) => {
    const destEl = event.target.closest('[data-local-drop]');
    const payload = dragPayload(event);
    if (!destEl || payload?.kind !== 'local-file') return;
    event.preventDefault();
    event.stopPropagation();
    const file = state.local.files.find((item) => item.key === payload.key);
    const dest = state.local.map.get(destEl.dataset.localDrop);
    const parent = file && state.local.map.get(file.parent);
    if (!file || !dest || !parent || file.parent === destEl.dataset.localDrop) return;
    releaseVideo();
    const blob = await file.handle.getFile();
    const created = await dest.getFileHandle(file.name, { create: true });
    const writable = await created.createWritable();
    await writable.write(blob);
    await writable.close();
    await parent.removeEntry(file.name);
    closePlayer();
    await renderLocal();
    toast('已移动');
  });
  $('convertTabs').onclick = (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    state.convertTab = button.dataset.tab;
    $('convertTabs').querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    renderConvert();
  };
  $('panel-help')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy-cmd]');
    if (!button) return;
    const cmd = button.getAttribute('data-copy-cmd') || '';
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
      toast('命令已复制');
    } catch { toast('复制失败'); }
  });
  document.addEventListener('paste', async (event) => {
    if (state.view !== 'browse' || !state.folder) return;
    const image = [...(event.clipboardData?.files || [])].find((file) => file.type.startsWith('image/'));
    if (!image) return;
    if (noSidecars()) return toast('已开启「禁止导出拉屎」，不会写入 .TThumb.PNG');
    const body = new FormData();
    body.append('thumb', image);
    body.append('folderPath', state.folder);
    try {
      await api('/api/folder-thumb', { method: 'POST', body });
      state.folderInfo.hasThumb = true;
      const node = findNode(state.tree, state.folder);
      if (node) node.hasThumb = true;
      state.coverStamp += 1;
      renderFolderHead();
      renderSide();
      toast('封面已贴上');
    } catch (err) { toast(err.message); }
  });
  // Capture phase so Space is owned by the player, not native <video controls>.
  window.addEventListener('keydown', async (event) => {
    const typing = event.target instanceof Element && event.target.matches('input, textarea');
    if (capturingHotkey) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (event.key === 'Escape') {
        capturingHotkey = false;
        const btn = $('previewHotkeyBtn');
        if (btn) { btn.textContent = previewHotkeyLabel(); btn.classList.remove('listening'); }
        return;
      }
      const next = { code: event.code || '', key: event.key || '' };
      localStorage.setItem('tv2-preview-hotkey', JSON.stringify(next));
      if (previewMode() === 'hover') localStorage.setItem('tv2-preview-mode', 'key');
      capturingHotkey = false;
      const btn = $('previewHotkeyBtn');
      if (btn) { btn.textContent = previewHotkeyLabel(next); btn.classList.remove('listening'); }
      $('previewMode')?.querySelectorAll('button').forEach((item) => {
        item.classList.toggle('active', item.dataset.preview === previewMode());
      });
      toast('预览快捷键：' + previewHotkeyLabel(next));
      return;
    }
    if (event.key === 'Escape') {
      $('ctx').hidden = true;
      if (previewOpen()) { hideHover(); return; }
      if (!$('snapPreview').hidden) { $('snapPreview').hidden = true; return; }
      if (!typing && !$('player').hidden) closePlayer();
      return;
    }
    if (!typing && previewOpen()) {
      const key = event.key.toLowerCase();
      if (key === 'm') {
        event.preventDefault();
        localStorage.setItem('tv2-preview-sound', $('hoverVideo').muted ? '1' : '0');
        syncHoverSound();
        return;
      }
      if (key === 'o') {
        event.preventDefault();
        continueFromPreview();
        return;
      }
    }
    if (typing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      if (state.view === 'browse') refreshBrowse().catch((err) => toast(err.message));
      return;
    }
    if ($('player').hidden && previewMode() === 'key' && matchesPreviewHotkey(event)) {
      event.preventDefault();
      if (event.repeat) return;
      previewKeyDownAt = Date.now();
      previewHolding = false;
      clearTimeout(previewHoldTimer);
      previewHoldTimer = setTimeout(() => {
        previewHolding = true;
        if (pointerCard) scheduleHover(pointerCard, { force: true });
      }, 280);
      return;
    }
    if ($('player').hidden || !state.player) return;
    const key = event.key.toLowerCase();
    if (event.key === 'ArrowUp') { event.preventDefault(); playRelative(-1); }
    if (event.key === 'ArrowDown') { event.preventDefault(); playRelative(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); $('video').currentTime -= 5; }
    if (event.key === 'ArrowRight') { event.preventDefault(); $('video').currentTime += 5; }
    if (key === ' ' || event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const video = $('video');
      if (video.paused) video.play().catch(() => {});
      else video.pause();
      return;
    }
    if (key === 'f') {
      event.preventDefault();
      toggleVideoAreaFullscreen();
    }
    if (key === 'p') {
      $('video').controls = !$('video').controls;
      $('detailVideoBox').classList.toggle('controls-off', !$('video').controls);
    }
    if (key === 's') screenshot();
    if (key === 'd') $('downloadBtn').click();
    if (key === 'a') $('markA').click();
    if (key === 'b') $('markB').click();
    if (key === 'r' && state.player.kind === 'file') {
      const next = await renamePath(state.player.path, false);
      if (next) { await refreshBrowse(); const file = fileByPath(next); if (file) openFile(file); }
    }
    if (event.key === 'Delete' && state.player.kind === 'file') {
      event.preventDefault();
      await deleteCurrentAndContinue();
    }
  }, true);
}

async function boot() {
  applyTheme(...savedTheme());
  wire();
  syncSortButtons();
  await loadHistory();
  const hash = location.hash.replace('#', '');
  if (hash === 'library' || hash === 'local') setView('browse');
  else if (['convert', 'links', 'help'].includes(hash)) setView(hash);
  else if (state.root) await refreshBrowse();
  else await renderWelcome();
}

boot().catch((err) => toast(err.message));
