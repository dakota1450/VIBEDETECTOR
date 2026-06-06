#!/usr/bin/env node
/**
 * Vibe Detector — marketing site server (zero dependencies).
 *
 * - Serves the static marketing page from `site/` at `/`.
 * - Streams the real installers from `dist/` at `/downloads/<file>`
 *   (HTTP Range support so the ~200 MB downloads are resumable).
 * - Exposes `/api/releases` — scanned live from `dist/` so the page always
 *   advertises whatever build currently exists (run `npm run dist` to refresh).
 *
 * Usage:  npm run site            (defaults to http://localhost:4178)
 *         PORT=8080 npm run site
 */
import { createServer } from 'node:http';
import { createReadStream, statSync, promises as fs } from 'node:fs';
import { extname, join, normalize, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_DIR = join(ROOT, 'site');
const DIST_DIR = join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 4178;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.dmg': 'application/x-apple-diskimage',
  '.zip': 'application/zip',
};

// Installer artifacts produced by electron-builder: "Vibe Detector-<ver>-<arch>.<ext>"
const ARTIFACT_RE = /^Vibe Detector-(\d+\.\d+\.\d+)-(universal|x64|arm64)\.(dmg|zip)$/;

const cmpVersion = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes >= 100 * 1048576 ? 0 : 1)} MB`;

async function scanReleases() {
  let entries = [];
  try {
    entries = await fs.readdir(DIST_DIR);
  } catch {
    return null;
  }
  const assets = [];
  for (const name of entries) {
    const m = ARTIFACT_RE.exec(name);
    if (!m) continue;
    let size = 0;
    try {
      size = statSync(join(DIST_DIR, name)).size;
    } catch {
      continue;
    }
    assets.push({ file: name, version: m[1], arch: m[2], ext: m[3], size, sizeLabel: mb(size) });
  }
  if (!assets.length) return null;

  const version = assets.map((a) => a.version).sort(cmpVersion).at(-1);
  const latest = assets.filter((a) => a.version === version);
  const pick = (pred) => latest.find(pred) || null;
  const toPlatform = (a, label, os, note) =>
    a && {
      os,
      label,
      note,
      file: a.file,
      url: `/downloads/${encodeURIComponent(a.file)}`,
      ext: a.ext,
      arch: a.arch,
      size: a.size,
      sizeLabel: a.sizeLabel,
    };

  const platforms = [
    toPlatform(pick((a) => a.ext === 'dmg' && a.arch === 'universal'), 'macOS', 'mac', 'Apple Silicon & Intel · .dmg'),
    toPlatform(pick((a) => a.ext === 'zip' && (a.arch === 'universal' || a.arch === 'arm64')), 'macOS', 'mac', 'Apple Silicon & Intel · .zip'),
    toPlatform(pick((a) => a.ext === 'zip' && a.arch === 'x64'), 'Windows', 'win', 'Windows 10+ · 64-bit .zip'),
  ].filter(Boolean);

  return { version, platforms };
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, headers);
  res.end(body);
};

// Resolve a request path under `base`, refusing anything that escapes it.
function safeJoin(base, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const p = normalize(join(base, decoded));
  if (p !== base && !p.startsWith(base + sep)) return null;
  return p;
}

function serveFile(req, res, filePath, { download = false } = {}) {
  let st;
  try {
    st = statSync(filePath);
  } catch {
    return send(res, 404, 'Not found');
  }
  if (st.isDirectory()) return send(res, 404, 'Not found');

  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type };
  if (download) {
    headers['Content-Disposition'] = `attachment; filename="${basename(filePath)}"`;
    headers['Accept-Ranges'] = 'bytes';
  }

  // Range requests — keeps big installer downloads resumable.
  const range = download && req.headers.range;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= st.size) end = st.size - 1;
    if (start > end) return send(res, 416, '', { 'Content-Range': `bytes */${st.size}` });
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(filePath, { start, end }).pipe(res);
  }

  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const pathname = (req.url || '/').split('?')[0];

  if (pathname === '/api/releases') {
    const releases = await scanReleases();
    return send(
      res,
      releases ? 200 : 404,
      JSON.stringify(releases || { error: 'No installers found in dist/. Run `npm run dist`.' }),
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    );
  }

  if (pathname.startsWith('/downloads/')) {
    const filePath = safeJoin(DIST_DIR, pathname.slice('/downloads'.length));
    if (!filePath) return send(res, 400, 'Bad request');
    return serveFile(req, res, filePath, { download: true });
  }

  const filePath = safeJoin(SITE_DIR, pathname === '/' ? '/index.html' : pathname);
  if (!filePath) return send(res, 400, 'Bad request');
  serveFile(req, res, filePath);
});

server.listen(PORT, async () => {
  const releases = await scanReleases();
  const line = '─'.repeat(56);
  console.log(`\n  ${line}`);
  console.log('   🛰  Vibe Detector — marketing site');
  console.log(`  ${line}`);
  console.log(`   Local      http://localhost:${PORT}/`);
  if (releases) {
    console.log(`   Release    v${releases.version}`);
    for (const p of releases.platforms) {
      console.log(`     • ${`${p.label} ${p.ext}`.padEnd(14)} ${p.sizeLabel.padStart(9)}   ${p.file}`);
    }
  } else {
    console.log('   Release    none found in dist/ — run `npm run dist` first');
  }
  console.log(`  ${line}`);
  console.log('   Ctrl-C to stop\n');
});
