// Renders the Vibe Detector app icon (SVG -> PNG via Electron capturePage),
// then builds build/icon.icns plus resources/icon.png and resources/dragIcon.png.
// Run: ./node_modules/.bin/electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const { execFileSync } = require('child_process')

const ROOT = join(__dirname, '..')

function dotsSVG() {
  let s = ''
  const cx = 512
  const cy = 512
  const r = 392
  for (let i = 0; i < 12; i++) {
    const hue = ((i * 7) % 12) * 30 // circle-of-fifths hue
    const ang = ((i * 30 - 90) * Math.PI) / 180
    const x = cx + r * Math.cos(ang)
    const y = cy + r * Math.sin(ang)
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="19" fill="hsl(${hue} 85% 58%)"/>`
  }
  return s
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <radialGradient id="bg" cx="50%" cy="30%" r="85%">
    <stop offset="0" stop-color="#1d1d2e"/><stop offset="1" stop-color="#09090f"/>
  </radialGradient>
  <linearGradient id="sw" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#b79bff" stop-opacity="0"/>
    <stop offset="1" stop-color="#8b5cff" stop-opacity="0.95"/>
  </linearGradient>
</defs>
<rect width="1024" height="1024" rx="232" fill="url(#bg)"/>
<g fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="6">
  <circle cx="512" cy="512" r="300"/>
  <circle cx="512" cy="512" r="206"/>
  <circle cx="512" cy="512" r="112"/>
  <line x1="512" y1="206" x2="512" y2="818"/>
  <line x1="206" y1="512" x2="818" y2="512"/>
</g>
<path d="M512 512 L512 206 A306 306 0 0 1 728 296 Z" fill="url(#sw)"/>
${dotsSVG()}
<circle cx="512" cy="512" r="34" fill="#ffffff"/>
</svg>`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>${svg}</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    useContentSize: true,
    transparent: true,
    frame: false
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 450))
  const img = await win.webContents.capturePage()

  const buildDir = join(ROOT, 'build')
  const resDir = join(ROOT, 'resources')
  const iconset = join(buildDir, 'icon.iconset')
  mkdirSync(buildDir, { recursive: true })
  mkdirSync(resDir, { recursive: true })
  mkdirSync(iconset, { recursive: true })

  const master = join(buildDir, 'icon-1024.png')
  writeFileSync(master, img.toPNG())

  const sizes = [
    [16, '16x16'],
    [32, '16x16@2x'],
    [32, '32x32'],
    [64, '32x32@2x'],
    [128, '128x128'],
    [256, '128x128@2x'],
    [256, '256x256'],
    [512, '256x256@2x'],
    [512, '512x512'],
    [1024, '512x512@2x']
  ]
  for (const [px, name] of sizes) {
    execFileSync('sips', ['-z', String(px), String(px), master, '--out', join(iconset, `icon_${name}.png`)], {
      stdio: 'ignore'
    })
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')], { stdio: 'ignore' })
  execFileSync('sips', ['-z', '512', '512', master, '--out', join(resDir, 'icon.png')], { stdio: 'ignore' })
  execFileSync('sips', ['-z', '180', '180', master, '--out', join(resDir, 'dragIcon.png')], { stdio: 'ignore' })

  console.log('icon generated: build/icon.icns, resources/icon.png, resources/dragIcon.png')
  app.quit()
})
