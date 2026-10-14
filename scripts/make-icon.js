'use strict';

/** Build NSIS-safe multi-size ICO from public/favicon.png */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'favicon.png');
const OUT_DIR = path.join(ROOT, 'build');
const TMP = path.join(OUT_DIR, 'ico-tmp');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function ensurePngToIco() {
  try {
    require.resolve('png-to-ico');
  } catch {
    execSync('npm install --save-dev png-to-ico --no-fund --no-audit', {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true
    });
  }
}

function resizeWithPowerShell() {
  fs.mkdirSync(TMP, { recursive: true });
  const ps = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('${SRC.replace(/\\/g, '\\\\')}')
$sizes = @(${SIZES.join(',')})
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  $out = Join-Path '${TMP.replace(/\\/g, '\\\\')}' ("icon-$s.png")
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$src.Dispose()
Copy-Item (Join-Path '${TMP.replace(/\\/g, '\\\\')}' 'icon-256.png') '${path.join(OUT_DIR, 'icon.png').replace(/\\/g, '\\\\')}' -Force
`;
  const script = path.join(TMP, 'resize.ps1');
  fs.writeFileSync(script, ps);
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${script}"`, {
    stdio: 'inherit',
    windowsHide: true
  });
}

async function main() {
  ensurePngToIco();
  resizeWithPowerShell();
  const pngToIco = require('png-to-ico').default;
  const files = SIZES.map((s) => path.join(TMP, `icon-${s}.png`));
  for (const f of files) {
    if (!fs.existsSync(f)) throw new Error('missing ' + f);
  }
  const buf = await pngToIco(files);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buf);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('Wrote build/icon.ico (' + buf.length + ' bytes) and build/icon.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
