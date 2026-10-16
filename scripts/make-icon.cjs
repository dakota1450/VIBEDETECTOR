// Renders the Vibe Detector app icon (SVG -> PNG via Electron capturePage),
// then builds build/icon.icns plus resources/icon.png and resources/dragIcon.png.
// Run: ./node_modules/.bin/electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const { execFileSync } = require('child_process')

const ROOT = join(__dirname, '..')

// The mark: a radar sweeping the circle of fifths. Twelve key dots sit exactly where
// they sit on the app's key wheel (C at the top, fifths clockwise) in the app's key
// colours (hue = position × 30°); the keys under the sweep — C, G, D — are lit.
function dotsSVG() {
  let s = ''
  const cx = 512
  const cy = 512
  const r = 386
  for (let i = 0; i < 12; i++) {
    const hue = i * 30
    const ang = ((i * 30 - 90) * Math.PI) / 180
    const x = (cx + r * Math.cos(ang)).toFixed(1)
    const y = (cy + r * Math.sin(ang)).toFixed(1)
    const lit = i <= 2
    if (lit) s += `<circle cx="${x}" cy="${y}" r="62" fill="hsl(${hue} 90% 60%)" opacity="0.32" filter="url(#glow)"/>`
    s += `<circle cx="${x}" cy="${y}" r="${lit ? 33 : 26}" fill="hsl(${hue} ${lit ? 88 : 72}% ${lit ? 62 : 52}%)" opacity="${lit ? 1 : 0.8}"/>`
  }
  return s
}

const SWEEP_R = 300
const sweepEnd = [512 + SWEEP_R * Math.sin(Math.PI / 3), 512 - SWEEP_R * Math.cos(Math.PI / 3)]

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <radialGradient id="bg" cx="50%" cy="28%" r="85%">
    <stop offset="0" stop-color="#1f1f31"/><stop offset="1" stop-color="#09090f"/>
  </radialGradient>
  <linearGradient id="sw" x1="0" y1="1" x2="1" y2="0">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
    <stop offset="1" stop-color="#d9ccff" stop-opacity="0.5"/>
  </linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
</defs>
<rect width="1024" height="1024" rx="232" fill="url(#bg)"/>
<g fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="7">
  <circle cx="512" cy="512" r="296"/>
  <circle cx="512" cy="512" r="196"/>
  <circle cx="512" cy="512" r="96"/>
</g>
<path d="M512 512 L512 ${512 - SWEEP_R} A${SWEEP_R} ${SWEEP_R} 0 0 1 ${sweepEnd[0].toFixed(1)} ${sweepEnd[1].toFixed(1)} Z" fill="url(#sw)"/>
<line x1="512" y1="512" x2="512" y2="${512 - SWEEP_R}" stroke="#ffffff" stroke-opacity="0.18" stroke-width="5"/>
${dotsSVG()}
<circle cx="512" cy="512" r="40" fill="#ffffff"/>
</svg>`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`

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

  // Windows icon (multi-size .ico) and the marketing site's copies.
  try {
    const pngToIco = require('png-to-ico')
    const ico = await (pngToIco.default || pngToIco)([join(iconset, 'icon_256x256.png')])
    writeFileSync(join(buildDir, 'icon.ico'), ico)
  } catch (err) {
    console.warn('skipped .ico:', err && err.message)
  }
  execFileSync('cp', [master, join(buildDir, 'icon.png')], { stdio: 'ignore' })
  const siteAssets = join(ROOT, 'site', 'assets')
  mkdirSync(siteAssets, { recursive: true })
  execFileSync('sips', ['-z', '512', '512', master, '--out', join(siteAssets, 'icon.png')], { stdio: 'ignore' })
  writeFileSync(join(buildDir, 'icon.svg'), svg)

  console.log('icon generated: build/icon.icns, build/icon.ico, resources/icon.png, resources/dragIcon.png, site/assets/icon.png')
  app.quit()
})
