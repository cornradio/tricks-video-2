# Server Deploy (for AI)

Deploy Tricks Video 2 to the homeserver, replacing the old `videos-tricks` install. Prefer non-interactive SSH/SCP with key auth (`BatchMode=yes`).

## Target

| Item | Value |
|------|-------|
| Host | `192.168.31.11` |
| User | `kasusa` |
| App dir | `/home/kasusa/video-tricks` |
| Screen name | `videotrick` |
| Port | `6688` |
| Node binary | `/home/kasusa/.nvm/versions/node/v20.20.0/bin/node` |
| Auth | SSH key (no password prompt) |

**Important:** Non-interactive SSH does **not** load nvm. Always use the absolute Node path above.

## One-shot

```bash
npm run deploy
```

Or:

```bash
node deploy.js --pack
```

## Manual

```bash
node pack.js
scp -o BatchMode=yes dist/tricks-video-2-server.zip kasusa@192.168.31.11:/home/kasusa/video-tricks/tricks-video-2-server.zip
ssh -o BatchMode=yes kasusa@192.168.31.11 '
set -e
cd /home/kasusa/video-tricks
NODE=/home/kasusa/.nvm/versions/node/v20.20.0/bin/node
screen -S videotrick -X quit 2>/dev/null || true
fuser -k 6688/tcp 2>/dev/null || true
sleep 1
unzip -o tricks-video-2-server.zip
screen -dmS videotrick "$NODE" /home/kasusa/video-tricks/server.js 6688
sleep 2
screen -ls | grep -i videotrick
curl -s -o /dev/null -w "http=%{http_code}\n" --connect-timeout 3 http://127.0.0.1:6688/
'
```

## Notes

- Do **not** run `npm install` unless dependencies changed; `node_modules` stays on the server and is not in the zip.
- Zip excludes `data/` and `uploads/` so server state is preserved.
- Tray/`systray` warnings on Linux are expected.
