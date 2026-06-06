/* ============================================================================
   Vibe Detector — marketing site behavior
   Animated radar hero · interactive circle of fifths · scroll reveals ·
   animated waveforms · live download wiring (GitHub Releases API; /api/releases for local dev).
   Vanilla JS, no dependencies, works offline.
   ========================================================================== */
(function () {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const safe = (fn) => { try { fn(); } catch (e) { console.warn('[vibe]', e); } };

  /* -- Circle-of-fifths key system ----------------------------------------- */
  const ORDER = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];
  const HUE = { C: 0, G: 30, D: 60, A: 90, E: 120, B: 150, 'F#': 180, 'C#': 210, 'G#': 240, 'D#': 270, 'A#': 300, F: 330 };
  const keyColor = (note, minor) => (HUE[note] === undefined ? 'var(--key-unknown)' : `hsl(${HUE[note]} ${minor ? '58% 50%' : '82% 60%'})`);

  /* ========================================================================
     Inline icons (Lucide-style: 24px viewBox, 2px stroke, round caps).
     Kept inline so the page renders fully offline — true to the brand.
     ====================================================================== */
  const ICONS = {
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    'folder-plus': 'M4 5a2 2 0 0 1 2-2h3l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 11v6M9 14h6',
    'audio-lines': 'M2 13v-2M6 17V7M10 21V3M14 15V9M18 18V6M22 13v-2',
    'circle-dot': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
    gauge: 'M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0',
    layers: 'M12 2 2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5',
    sparkles: 'M12 2c.4 4.6 3.4 7.6 8 8-4.6.4-7.6 3.4-8 8-.4-4.6-3.4-7.6-8-8 4.6-.4 7.6-3.4 8-8zM19 3c.15 1.6 1.25 2.7 3 3-1.75.3-2.85 1.4-3 3-.15-1.6-1.25-2.7-3-3 1.75-.3 2.85-1.4 3-3z',
    'arrow-right': 'M5 12h14M13 6l6 6-6 6',
    'shield-check': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
    check: 'M20 6 9 17l-5-5',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><path d="M12 12 18.4 7.6"/>',
    'play-fill': { fill: true, p: 'M6 4.5v15l13-7.5z' },
    'mouse-pointer': { fill: true, p: 'M4.2 3.1 20 11l-7 2.1L10.4 20z' },
    apple: { fill: true, p: 'M16.37 1.43c0 1.14-.49 2.26-1.18 3.07-.74.9-1.98 1.57-2.98 1.57-.12 0-.24-.01-.3-.03-.01-.05-.04-.21-.04-.38 0-1.15.58-2.27 1.21-2.99.8-.93 2.14-1.63 3.25-1.67.03.13.04.28.04.43zm4.56 15.71c-.03.07-.46 1.58-1.52 3.12-.94 1.34-1.93 2.71-3.43 2.71-1.51 0-1.9-.88-3.63-.88-1.7 0-2.3.91-3.67.91-1.38 0-2.33-1.26-3.43-2.8-1.29-1.82-2.32-4.63-2.32-7.28 0-4.28 2.8-6.55 5.55-6.55 1.45 0 2.67.95 3.6.95.86 0 2.22-1.01 3.9-1.01.61 0 2.89.06 4.37 2.19-.13.09-2.38 1.37-2.38 4.19 0 3.26 2.85 4.42 2.96 4.45z' },
    windows: { fill: true, p: 'M3 5.7 10.2 4.65v6.55H3zM11.35 4.5 21 3.1v8.1h-9.65zM3 12.55h7.2v6.55L3 18.05zM11.35 12.55H21v8.05l-9.65-1.4z' },
  };

  function svgFor(name, size) {
    const def = ICONS[name];
    if (!def) return '';
    const filled = typeof def === 'object' && def.fill;
    const inner = typeof def === 'object' ? def.p : def;
    const body = inner.indexOf('<') === 0 ? inner : `<path d="${inner}"/>`;
    const attrs = filled
      ? 'fill="currentColor" stroke="none"'
      : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const s = size || 20;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${s}" height="${s}" ${attrs} aria-hidden="true">${body}</svg>`;
  }

  function mountIcons(root) {
    $$('i[data-icon]', root).forEach((el) => {
      const size = el.getAttribute('data-size');
      el.innerHTML = svgFor(el.getAttribute('data-icon'), size ? Number(size) : undefined);
      el.style.display = 'inline-flex';
      el.removeAttribute('data-icon');
    });
  }

  /* ========================================================================
     Reveal on scroll
     ====================================================================== */
  function initReveal() {
    const targets = $$('.reveal, [data-stagger]');
    if (REDUCED || !('IntersectionObserver' in window)) {
      targets.forEach((t) => t.classList.add('is-visible'));
      return null;
    }
    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    targets.forEach((t) => io.observe(t));
    return io;
  }

  /* ========================================================================
     Nav scroll state
     ====================================================================== */
  function initNav() {
    const nav = $('#nav');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ========================================================================
     Animated waveforms (any element with [data-wave])
     ====================================================================== */
  function seeded(seed) {
    let s = 0;
    for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s % 100000) / 100000;
    };
  }
  function buildWaves() {
    $$('[data-wave]').forEach((el, idx) => {
      const count = Number(el.getAttribute('data-count')) || 48;
      const progress = Number(el.getAttribute('data-progress')) || 0;
      const rnd = seeded((el.getAttribute('data-wave') || 'vibe') + idx);
      const played = Math.round(progress * count);
      let html = '';
      for (let i = 0; i < count; i++) {
        const env = Math.sin((i / count) * Math.PI);
        const h = Math.max(10, (0.18 + rnd() * 0.82 * (0.4 + env)) * 100);
        const delay = (rnd() * 1.2).toFixed(2);
        html += `<span class="bar${i < played ? ' played' : ''}" style="height:${h.toFixed(0)}%;animation-delay:${delay}s"></span>`;
      }
      el.innerHTML = html;
    });
  }

  /* ========================================================================
     Marquee — supported formats + key spectrum
     ====================================================================== */
  function buildMarquee() {
    const track = $('#marquee');
    if (!track) return;
    const formats = ['WAV', 'AIFF', 'FLAC', 'MP3', 'OGG', 'M4A'];
    const sep = '<span class="marquee-sep"></span>';
    let half = '';
    half += `<span class="marquee-item"><span style="color:var(--text-secondary)">Scans</span></span>${sep}`;
    formats.forEach((f) => { half += `<span class="marquee-item"><span class="fmt">${f}</span></span>${sep}`; });
    half += `<span class="marquee-item"><span style="color:var(--text-secondary)">Key = color</span></span>${sep}`;
    ORDER.forEach((n) => {
      half += `<span class="marquee-item"><span class="key-badge sm" style="--kc:${keyColor(n, false)}">${n}</span></span>`;
    });
    half += sep;
    track.innerHTML = half + half; // duplicate for seamless -50% loop
  }

  /* ========================================================================
     Circle of fifths (interactive SVG) — signature wheel
     ====================================================================== */
  function polar(cx, cy, r, deg) {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function sectorPath(cx, cy, r0, r1, a0, a1) {
    const [x0o, y0o] = polar(cx, cy, r1, a0);
    const [x1o, y1o] = polar(cx, cy, r1, a1);
    const [x1i, y1i] = polar(cx, cy, r0, a1);
    const [x0i, y0i] = polar(cx, cy, r0, a0);
    return `M ${x0o} ${y0o} A ${r1} ${r1} 0 0 1 ${x1o} ${y1o} L ${x1i} ${y1i} A ${r0} ${r0} 0 0 0 ${x0i} ${y0i} Z`;
  }
  function initWheel() {
    const stage = $('#wheelStage');
    if (!stage) return;
    const size = 380;
    const c = size / 2;
    const rOuter = size * 0.485, rMid = size * 0.345, rInner = size * 0.205, hole = size * 0.205;
    const seg = 30;
    let selected = 'A';

    const SVGNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Circle of fifths key selector');

    const make = (tag, attrs) => {
      const el = document.createElementNS(SVGNS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    };

    const parts = []; // { major:path, minor:path, note }
    ORDER.forEach((note, i) => {
      const a0 = i * seg - seg / 2, a1 = i * seg + seg / 2;
      const hue = HUE[note];
      const g = make('g', { class: 'cof-sector' });

      const maj = make('path', { d: sectorPath(c, c, rMid, rOuter, a0, a1), fill: `hsl(${hue} 82% 60%)`, stroke: 'var(--ink-950)', 'stroke-width': '2' });
      const min = make('path', { d: sectorPath(c, c, rInner, rMid, a0, a1), fill: `hsl(${hue} 58% 50%)`, stroke: 'var(--ink-950)', 'stroke-width': '2' });
      maj.style.cursor = 'pointer'; min.style.cursor = 'pointer';
      maj.addEventListener('click', () => setSel(selected === note ? null : note));
      min.addEventListener('click', () => setSel(selected === note + 'm' ? null : note + 'm'));

      const [lxM, lyM] = polar(c, c, (rMid + rOuter) / 2, i * seg);
      const [lxm, lym] = polar(c, c, (rInner + rMid) / 2, i * seg);
      const tM = make('text', { x: lxM, y: lyM, fill: '#0b0b11', 'font-family': 'var(--font-sans)', 'font-size': size * 0.044, 'font-weight': '700', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none' });
      tM.textContent = note;
      const tm = make('text', { x: lxm, y: lym, fill: 'rgba(255,255,255,0.92)', 'font-family': 'var(--font-sans)', 'font-size': size * 0.036, 'font-weight': '600', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none' });
      tm.textContent = note + 'm';

      g.appendChild(maj); g.appendChild(min); g.appendChild(tM); g.appendChild(tm);
      svg.appendChild(g);
      parts.push({ maj, min, note });
    });

    const center = make('circle', { cx: c, cy: c, r: hole, fill: 'var(--ink-950)', stroke: 'var(--border-soft)', 'stroke-width': '1' });
    svg.appendChild(center);
    const cTop = make('text', { x: c, y: c - size * 0.022, fill: 'var(--text-secondary)', 'font-family': 'var(--font-sans)', 'font-size': size * 0.05, 'font-weight': '700', 'letter-spacing': '0.08em', 'text-anchor': 'middle' });
    const cBot = make('text', { x: c, y: c + size * 0.05, fill: 'var(--text-faint)', 'font-family': 'var(--font-sans)', 'font-size': size * 0.034, 'text-anchor': 'middle' });
    svg.appendChild(cTop); svg.appendChild(cBot);
    const clearHit = make('circle', { cx: c, cy: c, r: hole, fill: 'transparent' });
    clearHit.style.cursor = 'pointer';
    clearHit.addEventListener('click', () => setSel(null));
    svg.appendChild(clearHit);

    stage.appendChild(svg);

    const readout = $('#wheelReadout');
    const keysWrap = $('#wheelKeys');
    const chipKeys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Am', 'Em', 'F#m'];
    if (keysWrap) {
      keysWrap.innerHTML = chipKeys
        .map((k) => {
          const minor = /m$/.test(k);
          const note = minor ? k.slice(0, -1) : k;
          return `<span class="key-badge sm clickable" data-key="${k}" style="--kc:${keyColor(note, minor)}">${k}</span>`;
        })
        .join('');
      $$('.key-badge[data-key]', keysWrap).forEach((b) => b.addEventListener('click', () => setSel(b.getAttribute('data-key'))));
    }

    function setSel(key) {
      selected = key;
      const note = key ? (/m$/.test(key) ? key.slice(0, -1) : key) : null;
      const minor = key ? /m$/.test(key) : false;
      parts.forEach((p) => {
        const isMajSel = note === p.note && !minor;
        const isMinSel = note === p.note && minor;
        p.maj.setAttribute('opacity', key && !isMajSel ? 0.3 : 0.92);
        p.min.setAttribute('opacity', key && !isMinSel ? 0.3 : 0.92);
      });
      cTop.textContent = key ? key.toUpperCase() : 'KEY';
      cBot.textContent = key ? 'tap to clear' : 'detector';
      clearHit.style.display = key ? '' : 'none';
      if (readout) readout.textContent = key || 'all keys';
    }
    setSel(selected);
  }

  /* ========================================================================
     BPM count-up (when in view)
     ====================================================================== */
  function initCounters() {
    const els = $$('[data-bpm-count]');
    if (!els.length) return;
    const run = (el) => {
      const target = Number(el.getAttribute('data-bpm-count')) || 0;
      if (REDUCED) { el.textContent = target; return; }
      const dur = 1100, t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(target * eased);
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if (!('IntersectionObserver' in window)) { els.forEach(run); return; }
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach((e) => { if (e.isIntersecting) { run(e.target); obs.unobserve(e.target); } });
    }, { threshold: 0.6 });
    els.forEach((el) => io.observe(el));
  }

  /* ========================================================================
     Screenshot 3D tilt
     ====================================================================== */
  function initTilt() {
    const stage = $('.showcase-stage');
    const shot = $('#shot');
    if (!stage || !shot || REDUCED || window.matchMedia('(pointer: coarse)').matches) return;
    const base = 'perspective(1600px) rotateX(2deg)';
    shot.style.transform = base;
    stage.addEventListener('mousemove', (e) => {
      const r = stage.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      shot.style.transform = `perspective(1600px) rotateX(${(2 - py * 6).toFixed(2)}deg) rotateY(${(px * 7).toFixed(2)}deg)`;
    });
    stage.addEventListener('mouseleave', () => { shot.style.transform = base; });
  }

  /* ========================================================================
     Animated radar — the hero header
     ====================================================================== */
  function initRadar() {
    const canvas = $('#radar');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const detectText = $('#heroDetectText');
    // aligned to ORDER so each line's key matches the swept dot's color
    const READOUTS = ['C · 140 BPM · Kick', 'G · 174 BPM · Lead', 'D · 132 BPM · Arp', 'A · 124 BPM · Stab',
      'E · 100 BPM · Pluck', 'B · 150 BPM · Chord', 'F# · 128 BPM · Loop', 'C# · 160 BPM · Hat',
      'G# · 85 BPM · Keys', 'D# · 120 BPM · 808', 'A# · 96 BPM · Bass', 'F · 95 BPM · Sub'];

    let cssW = 0, cssH = 0, dpr = 1;
    function resize() {
      const r = canvas.getBoundingClientRect();
      cssW = r.width || 600; cssH = r.height || 600;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    const dots = ORDER.map((note, i) => ({ note, hue: HUE[note], deg: i * 30, ping: -1 }));
    const TWO = Math.PI * 2;
    const norm = (a) => ((a % TWO) + TWO) % TWO;

    let sweep = -Math.PI / 2; // start at top
    let last = norm(sweep);
    const SPEED = TWO / 5000; // one rotation / 5s
    let started = 0;

    function draw(now) {
      const cx = cssW / 2, cy = cssH / 2;
      const maxR = Math.min(cssW, cssH) * 0.46;
      ctx.clearRect(0, 0, cssW, cssH);

      // concentric rings
      const breathe = REDUCED ? 1 : 0.85 + 0.15 * Math.sin(now / 1400);
      for (let k = 1; k <= 4; k++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (maxR * k) / 4, 0, TWO);
        ctx.strokeStyle = `rgba(255,255,255,${0.05 * breathe})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // crosshairs
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR);
      ctx.stroke();

      // sweep wedge (conic gradient trailing the leading edge)
      if (typeof ctx.createConicGradient === 'function') {
        const trail = (70 * Math.PI) / 180;
        const fLead = trail / TWO;
        const g = ctx.createConicGradient(sweep - trail, cx, cy);
        g.addColorStop(0, 'rgba(139,92,255,0)');
        g.addColorStop(Math.max(0.0001, fLead * 0.55), 'rgba(139,92,255,0.10)');
        g.addColorStop(fLead, 'rgba(168,132,255,0.42)');
        g.addColorStop(Math.min(0.9999, fLead + 0.004), 'rgba(168,132,255,0)');
        g.addColorStop(1, 'rgba(139,92,255,0)');
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, maxR, 0, TWO);
        ctx.clip();
        ctx.fillStyle = g;
        ctx.fillRect(cx - maxR, cy - maxR, maxR * 2, maxR * 2);
        ctx.restore();
      }
      // crisp leading scan line
      ctx.save();
      ctx.strokeStyle = 'rgba(168,132,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(139,92,255,0.8)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + maxR * Math.cos(sweep), cy + maxR * Math.sin(sweep));
      ctx.stroke();
      ctx.restore();

      // pitch-class dots
      const dotR = maxR * 0.985;
      dots.forEach((d) => {
        const ang = ((d.deg - 90) * Math.PI) / 180;
        const x = cx + dotR * Math.cos(ang), y = cy + dotR * Math.sin(ang);
        const col = `hsl(${d.hue} 82% 60%)`;
        let flare = 0;
        if (d.ping >= 0) {
          const age = (now - d.ping) / 1100;
          if (age >= 1) d.ping = -1; else {
            flare = 1 - age;
            // expanding ping ring
            ctx.beginPath();
            ctx.arc(x, y, 4 + age * 22, 0, TWO);
            ctx.strokeStyle = `hsla(${d.hue} 82% 65% / ${0.5 * (1 - age)})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
        ctx.beginPath();
        ctx.arc(x, y, 3 + flare * 3.2, 0, TWO);
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 8 + flare * 18;
        ctx.globalAlpha = 0.55 + flare * 0.45;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      });

      // center dot
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, TWO);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(168,132,255,0.9)';
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    function step(now) {
      if (!started) started = now;
      const dt = Math.min(now - (step._last || now), 50);
      step._last = now;
      sweep += SPEED * dt;
      const cur = norm(sweep);

      // fire pings for dots the leading edge crossed this frame
      dots.forEach((d) => {
        const dAng = norm(((d.deg - 90) * Math.PI) / 180);
        const crossed = last <= cur ? dAng > last && dAng <= cur : dAng > last || dAng <= cur;
        if (crossed && d.ping < 0) {
          d.ping = now;
          if (detectText) detectText.innerHTML = 'Detected <b class="hd-key" style="color:hsl(' + d.hue + ' 82% 66%)">' + READOUTS[d.deg / 30] + '</b>';
        }
      });
      last = cur;

      draw(now);
      requestAnimationFrame(step);
    }

    if (REDUCED) {
      sweep = -Math.PI / 4;
      draw(0);
      if (detectText) detectText.textContent = 'F# · 128 BPM · Loop';
    } else {
      requestAnimationFrame(step);
    }
  }

  /* ========================================================================
     Downloads — GitHub Releases API on Pages; /api/releases (dist/) for local dev
     ====================================================================== */
  const FALLBACK = {
    version: '0.4.0',
    platforms: [
      { os: 'mac', label: 'macOS', note: 'Apple Silicon & Intel · .dmg', ext: 'dmg', sizeLabel: '204 MB', file: 'Vibe Detector-0.4.0-universal.dmg' },
      { os: 'mac', label: 'macOS', note: 'Apple Silicon & Intel · .zip', ext: 'zip', sizeLabel: '197 MB', file: 'Vibe Detector-0.4.0-universal.zip' },
      { os: 'win', label: 'Windows', note: 'Windows 10+ · 64-bit .zip', ext: 'zip', sizeLabel: '134 MB', file: 'Vibe Detector-0.4.0-x64.zip' },
    ],
  };

  function detectOS() {
    const p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase();
    if (/mac|iphone|ipad|ipod/.test(p)) return 'mac';
    if (/win/.test(p)) return 'win';
    return 'other';
  }

  // Where published installers live. On a *.github.io Pages site the owner/repo
  // are derived from the URL automatically; a custom domain can override with
  // <meta name="gh-repo" content="owner/repo">.
  function githubRepo() {
    const meta = document.querySelector('meta[name="gh-repo"]');
    if (meta && /^[^/\s]+\/[^/\s]+$/.test((meta.content || '').trim())) {
      const [owner, repo] = meta.content.trim().split('/');
      return { owner, repo };
    }
    const m = /^([a-z0-9-]+)\.github\.io$/i.exec(window.location.hostname);
    if (!m) return null;
    const seg = window.location.pathname.split('/').filter(Boolean)[0];
    return { owner: m[1], repo: seg || window.location.hostname };
  }
  const GH = githubRepo();

  function hrefFor(plat) {
    if (plat.url) return plat.url; // direct asset URL (GitHub Releases API or local server)
    if (GH) return `https://github.com/${GH.owner}/${GH.repo}/releases/latest`; // API unavailable → releases page
    const base = window.location.protocol === 'file:' ? '../dist/' : 'downloads/';
    return base + encodeURIComponent(plat.file);
  }

  // Map the latest GitHub Release's assets into the same shape /api/releases returns.
  // GitHub sanitizes spaces in asset names to dots, so accept "Vibe Detector" or "Vibe.Detector".
  const ASSET_RE = /^Vibe[ .]Detector-(\d+\.\d+\.\d+)-(universal|x64|arm64)\.(dmg|zip)$/;
  const fmtMB = (n) => `${(n / 1048576).toFixed(n >= 100 * 1048576 ? 0 : 1)} MB`;

  async function fetchGithubReleases(gh) {
    const res = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const rel = await res.json();
    const assets = (rel.assets || [])
      .map((a) => {
        const m = ASSET_RE.exec(a.name);
        return m ? { file: a.name, version: m[1], arch: m[2], ext: m[3], size: a.size, url: a.browser_download_url } : null;
      })
      .filter(Boolean);
    if (!assets.length) return null;
    const mk = (a, os, label, note) =>
      a && { os, label, note, ext: a.ext, arch: a.arch, file: a.file, url: a.url, size: a.size, sizeLabel: fmtMB(a.size) };
    const platforms = [
      mk(assets.find((a) => a.ext === 'dmg' && a.arch === 'universal'), 'mac', 'macOS', 'Apple Silicon & Intel · .dmg'),
      mk(assets.find((a) => a.ext === 'zip' && (a.arch === 'universal' || a.arch === 'arm64')), 'mac', 'macOS', 'Apple Silicon & Intel · .zip'),
      mk(assets.find((a) => a.ext === 'zip' && a.arch === 'x64'), 'win', 'Windows', 'Windows 10+ · 64-bit .zip'),
    ].filter(Boolean);
    if (!platforms.length) return null;
    const version = (rel.tag_name || '').replace(/^v/, '') || assets[0].version;
    return { version, platforms };
  }

  function renderDownloads(data) {
    const wrap = $('#dlCards');
    if (!wrap) return;
    const os = detectOS();
    // recommend the first platform matching the user's OS (dmg before zip for mac)
    let recIndex = data.platforms.findIndex((p) => p.os === os);
    if (recIndex < 0) recIndex = 0;

    wrap.innerHTML = data.platforms
      .map((p, i) => {
        const rec = i === recIndex;
        const icon = p.os === 'win' ? 'windows' : 'apple';
        return `
        <div class="dl-card${rec ? ' is-recommended' : ''}">
          ${rec ? '<span class="rec-tag">Recommended</span>' : ''}
          <div class="dl-os">
            <span class="os-icon"><i data-icon="${icon}"></i></span>
            <div>
              <div class="os-name">${p.label}</div>
              <div class="os-note">${p.note}</div>
            </div>
          </div>
          <div class="dl-meta">.${p.ext}<span class="sep"></span>${p.sizeLabel}<span class="sep"></span>v${data.version}</div>
          <a class="btn ${rec ? 'btn-primary' : 'btn-secondary'}" href="${hrefFor(p)}" download>
            <i data-icon="download"></i> Download
          </a>
        </div>`;
      })
      .join('');

    mountIcons(wrap);
    wrap.classList.add('is-visible'); // it may already be below the fold

    // reflect the real version across the page
    const meta = $('#heroMeta');
    if (meta) meta.textContent = `Free · v${data.version} · macOS 12+ / Windows 10+`;
  }

  async function initDownloads() {
    let data = null;
    if (GH) {
      // Hosted on GitHub Pages → pull the latest published release directly.
      try { data = await fetchGithubReleases(GH); } catch (e) { /* rate-limited / offline — fall back */ }
    } else if (window.location.protocol !== 'file:') {
      // Local dev via `npm run site` → the Node server scans dist/.
      try {
        const res = await fetch('/api/releases', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.platforms) && json.platforms.length) data = json;
        }
      } catch (e) { /* offline / opened without the server — fall back */ }
    }
    renderDownloads(data || FALLBACK);
  }

  /* ========================================================================
     Boot
     ====================================================================== */
  function boot() {
    safe(() => mountIcons(document));
    safe(buildWaves);
    safe(buildMarquee);
    safe(initNav);
    safe(initWheel);
    safe(initCounters);
    safe(initTilt);
    safe(initRadar);
    safe(initReveal);
    safe(initDownloads);
    // icons inside JS-built widgets (wheel chips etc. use no icons; downloads re-mount themselves)
    safe(() => mountIcons(document));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
