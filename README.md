# Tricks Video 2

原来的 Tricks 还在旁边那个项目里。这一版把界面重做了，文件操作也换了做法：播放时不再一直占着文件，删除、改名、新建文件夹、移动文件夹会先等正在读的那一小段结束，再动手。

## 运行

需要 Node.js 18+。缩略图和转封装需要 ffmpeg。单集 / 文件夹 / 批量转码还需要 HandBrakeCLI。

```bash
npm install
npm start
```

浏览器打开 <http://localhost:3210>。端口可以用 `PORT=6688 npm start`，或者 `node server.js 6688`。

## 打包

国内网络默认走 npmmirror（见 `.npmrc` / `scripts/china-mirrors.js`）：Electron、electron-builder、pkg 缓存不走 GitHub。

一次打出三套产物（Electron / Node EXE / 服务器 zip）：

```bash
npm run build:all
```

分开打：

```bash
npm run pack            # dist/tricks-video-2-server.zip
npm run build:exe       # dist/tricks-video-2.exe
npm run build:electron  # dist/electron/
```

部署到家里服务器（替换 `/home/kasusa/video-tricks`，端口 6688）：

```bash
npm run deploy
```

## 主题

右上角可以换五套：炉边、纸页、海湾、花雾、苔色。选择会留在这台浏览器里。

## 页面

- **资料库**：打开服务器上的文件夹，树、封面、笔记、片段、收藏、历史、上传、外部播放器、转换
- **收藏**：自己的分类和上传的视频
- **本机**：Chrome / Edge 的本地文件夹，读写都在浏览器里完成
- **转换**：提取字幕、合并字幕、单集、文件夹、批量 MKV
- **资源**：自己整理的链接

白名单仍然是 `data/whitelist.txt`，格式见 `whitelist.example.txt`。没有这个文件时，本机路径都能打开。请只在自己的电脑上使用。

收藏还是给文件名加上 `-[stared]`。

## 文件为什么还能被删掉

视频按大约 1MB 一段打开、读完、马上关掉。要删除或移动时，先暂停新的读取，停掉正在处理这个路径的 ffmpeg，等当前这一小段读完，再重试几次。所以平时播放不会把整个文件夹锁住。
