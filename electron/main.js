'use strict';

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PREFERRED_PORT = Number(process.env.PORT || 3210);
const PORT_TRIES = 30;

let mainWindow = null;
let activePort = PREFERRED_PORT;
let serverStarted = false;

function resolveBase() {
  if (app.isPackaged) return path.dirname(app.getPath('exe'));
  return path.join(__dirname, '..');
}

function resolveIcon() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'public', 'favicon.png'),
    path.join(__dirname, '..', 'public', 'tray-icon.ico')
  ];
  return candidates.find((p) => fs.existsSync(p)) || undefined;
}

function probePort(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 600 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function findReusablePort(start) {
  for (let port = start; port < start + PORT_TRIES; port++) {
    if (await probePort(port)) return port;
  }
  return null;
}

async function startServer() {
  if (serverStarted) return activePort;

  const reusable = await findReusablePort(PREFERRED_PORT);
  if (reusable != null) {
    activePort = reusable;
    console.log('[electron] reuse existing server on ' + activePort);
    return activePort;
  }

  process.env.TV2_BASE = resolveBase();
  process.argv = [process.argv[0], path.join(__dirname, '..', 'server.js')];
  const server = require(path.join(__dirname, '..', 'server.js'));

  for (let port = PREFERRED_PORT; port < PREFERRED_PORT + PORT_TRIES; port++) {
    try {
      await server.listen(port);
      activePort = port;
      serverStarted = true;
      if (port !== PREFERRED_PORT) {
        console.log('[electron] port ' + PREFERRED_PORT + ' busy, using ' + port);
      }
      return activePort;
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') continue;
      throw err;
    }
  }
  throw new Error('No free port from ' + PREFERRED_PORT + ' to ' + (PREFERRED_PORT + PORT_TRIES - 1));
}

function showWindowSafe(win) {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function createWindow(port) {
  const icon = resolveIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Tricks Video 2',
    icon,
    show: true,
    center: true,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: '#1a1612',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL('http://127.0.0.1:' + port + '/');
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Fallback if page is slow: keep window visible anyway
  setTimeout(() => showWindowSafe(mainWindow), 800);

  mainWindow.webContents.on('did-finish-load', () => {
    showWindowSafe(mainWindow);
    mainWindow.webContents.executeJavaScript(`
      document.documentElement.classList.add('electron');
      const bar = document.getElementById('winControls');
      if (bar) bar.hidden = false;
    `).catch(() => {});
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[electron] load failed', code, desc);
    showWindowSafe(mainWindow);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.on('tv2-win', (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (action === 'minimize') mainWindow.minimize();
  else if (action === 'maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  } else if (action === 'close') mainWindow.close();
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindowSafe(mainWindow);
  });

  app.whenReady().then(async () => {
    if (process.platform === 'win32' && app.setAppUserModelId) {
      app.setAppUserModelId('com.tricks.video2');
    }
    try {
      const port = await startServer();
      createWindow(port);
    } catch (err) {
      dialog.showErrorBox(
        'Tricks Video 2',
        '无法启动本地服务：' + (err && err.message ? err.message : String(err))
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (!mainWindow) createWindow(activePort);
  });
}
