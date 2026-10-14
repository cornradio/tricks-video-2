'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tv2Desktop', {
  minimize() { ipcRenderer.send('tv2-win', 'minimize'); },
  maximize() { ipcRenderer.send('tv2-win', 'maximize'); },
  close() { ipcRenderer.send('tv2-win', 'close'); }
});
