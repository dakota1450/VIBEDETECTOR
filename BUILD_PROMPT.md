# Build Prompt — "Vibe Detector"

> Paste this entire document into a capable coding agent (Claude Code, Cursor, etc.) as the build brief. It is self-contained.

---

## Current app baseline

The current packaged release is **0.4.0**. The app is implemented as an Electron + React + TypeScript
desktop app with a pure-TypeScript detection pipeline. Key detection is the product edge: filenames
and metadata are still trusted first, but the audio fallback now includes chroma/key-profile analysis
for loops/chords, pitch-class analysis for tuned drums, 808s, bass hits, and melodic one-shots,
multi-section chroma sampling for longer material, and structured diagnostics explaining detector
and store merge decisions. Existing libraries are rechecked through an `analysisVersion` gate when
the algorithm improves, waveform peaks are backfilled through a `waveformVersion` gate, and manual
overrides always win.

0.4.0 also adds cached real row waveforms, a review queue for low-confidence/unknown/failed analysis
items, batch correction for selected sounds, visible retryable analysis failures, and a bundled
`npm run benchmark:key` harness for filename key detection.

## 1. Mission

Build a **local desktop application for music producers called "Vibe Detector"** that scans a producer's sample folders, automatically detects the **musical key** and **tempo (BPM)** of every sound and whether each sound is a **drum/one-shot** or a **melodic sample**, and presents everything in a fast, modern, color-coded library where the producer can **filter by key, tempo, and type, preview sounds instantly, and drag them straight into their DAW** (Ableton, FL Studio, Logic, etc.).

It must run **entirely locally and offline** — no audio ever leaves the user's machine.

## 2. Who it's for

Producers (heavily hip-hop / beatmaking) who have accumulated thousands of samples spread across messy folders and drum kits. They waste time hunting for "a sample in F minor" or "the right kick." Vibe Detector turns that chaotic pile into an instantly searchable, key-aware, type-aware instrument.

## 3. Core concept & branding ("the play")

The name is the feature: the app **"detects the vibe"** of each sound. Lean into that, tastefully:

- A signature **scanning/detector animation** (radar sweep + spectrum/equalizer pulse) plays while the library is being analyzed — "DETECTING VIBE…".
- **"Bold & colorful" = key-as-color.** Map the 12 pitch classes around the **circle of fifths** to a 12-hue color wheel. Major vs. minor = brightness/saturation variants of the same hue. Every sample's key badge, waveform tint, and grid accent uses its key color. The result: the whole library is **visually organized by key at a glance**, and the color wheel becomes the app's iconic UI element.
- Tone: confident, energetic, modern. Dark canvas so the key colors pop. Clean typography, generous spacing — bold and vibrant, never cluttered or kitschy.
- Suggested taglines (pick one for the splash/empty state): *"Know the vibe of every sound." / "Every sample, in key."*

## 4. Platform & tech stack

**Target:** macOS first (Apple Silicon + Intel). Keep the codebase cross-platform-friendly so Windows can follow later, but only build/test macOS now.

**Framework: Electron.** This is a hard requirement driver — Electron's `webContents.startDrag()` is the reliable, proven way to initiate a **native OS file drag from the app into a DAW**. (A pure browser app cannot do this; do not propose one.)

Current stack:

- **Electron** + **electron-vite** (fast HMR, clean main/preload/renderer split).
- **React + TypeScript** for the renderer UI.
- **Vite** + **Tailwind CSS** for styling.
- **Zustand** for renderer state.
- A pure-JS JSON store (atomic, debounced writes) in the main process. The repository boundary is
  intentionally small so SQLite can replace it later without changing callers. Do not introduce a
  native SQLite dependency until the cached-waveform and diagnostics data model is stable and a
  packaged smoke test plan is ready.
- **music-metadata** for reading embedded tags (key/BPM/format info).
- **fft.js** plus pure TypeScript DSP for audio **key detection** and **tempo/BPM detection**:
  chroma + Krumhansl-Schmuckler profiles for musical key, YIN-style pitch-class detection for tuned
  one-shots/drums, onset autocorrelation for BPM, and spectral features for drum refinement. Run it
  in a renderer Web Worker so scanning never blocks the UI.
- **wavesurfer.js (v7)** for the player plus cached decoded peak buckets for row waveforms.
- **chokidar** for watching source folders for changes.
- **@tanstack/react-virtual** for virtualized lists/grids (libraries can be huge).
- **electron-builder** for packaging a signed/notarized `.dmg`.

Keep main-process (Node/native, filesystem, DB, drag) and renderer (UI) responsibilities cleanly separated, communicating over typed IPC via a `contextBridge` preload. Never expose Node directly to the renderer.

## 5. Feature specification

### 5.1 Sources & ingestion
- User adds one or more **folders** as "Sources." Support adding a single folder, multiple folders at once, and nested folder trees. (Optional grouping concept: name a set of folders as a "Crate.")
- On add, **recursively scan** for audio files: `.wav .aif .aiff .flac .mp3 .ogg .m4a`. Ignore everything else.
- Persist sources so they reload on app launch. Allow removing a source (removes its sounds from the index but never touches files on disk).
- **Watch** sources with chokidar: new/changed/deleted files update the index incrementally. Never re-analyze an unchanged file — key off `path + size + mtime` (or a quick hash).

### 5.2 Scan & analysis pipeline
For each discovered file, in a background queue with a worker pool (respect CPU count), produce:
1. **Metadata**: duration, sample rate, channels, bit depth, format, file size (via music-metadata / decode header).
2. **Key** (see 5.3).
3. **Type + subtype** (see 5.4).
4. **Tempo (BPM)** — a first-class attribute (see 5.3), not just for loops.
5. **Waveform peaks** (downsampled, cached to DB/disk so the player and thumbnails are instant later).

Requirements:
- Show **live progress**: files found, analyzed, remaining, with the "DETECTING VIBE…" animation. App stays fully responsive and browsable during scanning.
- Analysis is **resumable** and incremental — closing/reopening mid-scan continues where it left off.
- Gracefully skip and flag corrupt/unreadable files; never crash the whole scan over one bad file.

### 5.3 Key & tempo (BPM) detection — filename/metadata first, audio analysis fallback
Resolve each sound's key to a canonical record: `{ tonic: "C".."B" (use sharps canonically, store enharmonic flat alias), mode: "major" | "minor" | null, confidence: 0..1, source: "filename" | "metadata" | "analysis" | "manual" }`.

Resolution order:
1. **Filename parse (preferred when present).** Robustly match common notations anywhere in the filename, case-insensitive, tolerant of separators:
   - `Cmaj`, `C maj`, `Cmajor`, `Cmin`, `Cm`, `C#min`, `Dbm`, `F#`, `Bb`, `Gmaj7` (strip chord extensions for keyfinding), `A minor`, `Am`, `F#m`.
   - **Camelot wheel** notation: `8A`, `11B`, `5A` → map to key (A = minor, B = major).
   - Accept both sharps and flats; normalize (e.g., `Db` ↔ `C#`). Avoid false positives like the `C` in "Clap" or a stray `A`/`B` — require a key-shaped token (note + optional accidental + optional mode word), and weight matches that sit next to BPM/musical context.
2. **Embedded metadata** (`key`/`initial key` tags via music-metadata) if no reliable filename key.
3. **Audio analysis fallback** (when 1 and 2 fail, or confidence is low): use chroma + Krumhansl-style
   key profiles for loops/chords and pitch-class detection for tuned drums, 808s, bass hits, melodic
   one-shots, and other single-pitch material. Return tonic + mode only when the mode is supportable;
   tuned one-shots can return a tonic with `mode: null`.
4. If still indeterminate (atonal/percussive/noisy), set key to **Unknown** with low confidence rather than guessing.

The user can **manually override** a key from the UI; a manual key always wins and is preserved across rescans.

**Tempo (BPM)** is a first-class attribute and follows the same filename-first philosophy. Resolve each sound to `{ bpm: number | null, confidence: 0..1, source: "filename" | "metadata" | "analysis" | "manual" }`:
1. **Filename parse first.** Match common tempo tokens anywhere in the name, tolerant of separators: `140bpm`, `140 BPM`, `_140_`, `90bpm`, `[174]`. Require a plausible range (~40–300) and avoid grabbing unrelated numbers (sample rates like `44100`/`48k`, bit depths, years/dates, key or Camelot tokens).
2. **Embedded metadata** (`bpm` / `tempo` tags via music-metadata) when no filename tempo.
3. **Audio analysis fallback** (when 1 and 2 fail): estimate tempo from an onset-energy envelope and
   autocorrelation, then store a confidence.
4. **Non-rhythmic content / single one-shots** (a lone kick, a sustained pad) → leave tempo empty rather than inventing one. Detect and normalize **half/double-time** estimates into a sensible range while keeping the alternate available (70 ↔ 140).

Manual BPM overrides always win and persist across rescans.

### 5.4 Sound classification — drums vs. melodic (+ subtypes)
Classify each sound as **Drum/One-shot** or **Melodic sample**, using a combination of signals (don't rely on any single one):
- **Filename + folder keywords**: drum → `kick, snare, clap, hat, hihat, hi-hat, openhat, perc, 808, tom, rim, ride, crash, cymbal, shaker, snap, fx, foley`; melodic → `melody, sample, loop, chord, key, piano, guitar, synth, pad, bell, vox, flute, string, brass, winds, mallet`. Folder names (e.g., a "Drum Kit" / "Kicks" folder) are strong hints.
- **Duration**: drum one-shots are typically short (≲ 1.5s) with a sharp transient and fast decay.
- **Spectral/harmonic features**: drums tend to be broadband/noisy with low harmonicity and no stable pitch; melodic content has a detectable pitch/strong tonal structure. A confident key/pitch from 5.3 is itself evidence of "melodic."

For drums, also assign a **subtype** when possible: `kick, snare, clap, hihat (closed/open), perc, 808, tom, cymbal, fx`. Use keywords plus spectral centroid (kick = low centroid, hat/cymbal = high centroid) to disambiguate. Melodic subtype labels include `loop, one_shot, stab, chord, arp, pad, pluck, lead, bass, guitar, piano, synth, keys, strings, brass, winds, mallet, vocal, fx`. Loops (longer, rhythmic, possibly with detectable BPM) can be tagged `loop`.

The user can manually re-classify any sound; the override persists.

### 5.5 Library browsing, filtering & search
- **Filter by key**: the signature **circle-of-fifths color wheel** — click a key segment to filter; support multi-select and a "major/minor" toggle. Also a compact key-grid alternative.
- **Review filters**: expose low-confidence keys, unknown/keyless melodic sounds, queued analysis, and failed analysis as a cleanup workflow. Failed analysis must be visible and retryable.
- **Filter by type**: All / Melodic / Drums, and drill into drum subtypes (Kicks, Snares, Hats, 808s, Perc, FX…).
- **Filter by tempo (BPM):** a range slider with quick presets (e.g. <90, 90–110, 110–140, 140+) and **half/double-time matching** (a 140 BPM search also surfaces 70 BPM material). Toggle to show only sounds that have a detected tempo.
- **Filter by** **duration**, **format**, **source/crate**, **favorites**.
- **Text search** across filename/path, debounced, instant against the SQLite index.
- Combine filters freely (e.g., "Melodic + F minor + this crate"). Show active filters as removable chips and a result count.
- **Sort** by name, key, date added, duration, BPM.

### 5.6 Audio preview / playback
- **Click a sound to preview instantly** (Web Audio API). Selecting a new sound stops the previous one.
- **Spacebar** toggles play/pause on the focused sound; arrow keys move selection (auto-preview on move is a toggle-able "audition" mode producers love).
- Persistent **player bar** at the bottom: waveform with scrub/seek, play/pause, **loop toggle**, volume, and the now-playing name + its colored key badge.
- Low-latency; no audible gap when rapidly auditioning many sounds.

### 5.7 Drag-and-drop into a DAW (critical)
- Each sound is **draggable**; dragging it out of the window drops the **actual audio file** into the target DAW or Finder.
- Implementation: in the renderer, on `dragstart` call `event.preventDefault()` and send the file path over IPC to the main process, which calls `event.sender.startDrag({ file: absolutePath, icon: dragImage })`. Provide a small drag icon (e.g., a colored key chip).
- Support **multi-select drag** (drag several files at once) via `files: string[]` where supported.
- Verify the dropped file imports correctly into at least one DAW and into Finder.

### 5.8 Editing, favorites & tags
- **Favorite/star** sounds; quick "Favorites" filter.
- **Manual overrides** for key and type/subtype (persisted, survive rescans).
- **Batch correction** for selected sounds: set/clear key, mark selected sounds as melodic/drum, and favorite selected sounds without opening each detail panel.
- Optional free-form **tags** and a notes field per sound.
- "Reveal in Finder" action. Never move/rename/delete the user's files unless they explicitly ask.

## 6. UI / UX & visual design

**Direction: bold & colorful, modern, dark-canvas, key-as-color, with a tasteful "detector" motif.**

- **Color system:** define the 12 pitch-class hues around the circle of fifths once, in a theme module; derive major (brighter/saturated) and minor (deeper) variants. Reuse everywhere a key appears (badges, waveform tint, wheel, grid accents). Unknown = neutral gray. This is the product's visual signature — make it precise and consistent.
- **Layout (3-pane):**
  - **Left sidebar:** Sources/Crates list + "Add Folder"; filter stack (Type, the **key color wheel**, BPM, favorites); search at top.
  - **Center:** virtualized results grid/list. Each item is a card/row showing name, **colored key badge**, a **tempo (BPM) badge**, type/subtype icon, duration, a **mini waveform** (tinted to its key color), a play button, and a drag handle. Hover = quick preview affordance.
  - **Bottom:** persistent player bar (5.6).
  - **Top bar:** global search, scan status + the "DETECTING VIBE…" animation, view toggles (grid/list), sort.
- **Signature components:**
  - **Circle-of-fifths color wheel** — interactive filter + the brand centerpiece. Animated, satisfying to click.
  - **Scan/detector animation** — radar sweep + spectrum pulse during analysis. Reusable as a loading state.
  - **Vibe meter** flourish (optional) — a small animated readout that "reads" the selected sound's key/energy.
- **Empty state / onboarding:** friendly "Add a folder to detect the vibe of your sounds" with the wheel and a big call to action.
- **Motion:** quick, springy, purposeful (Framer Motion). Never block interaction. Respect "reduce motion."
- **Accessibility:** keyboard-first navigation (audition workflow), focus states, sufficient contrast, don't rely on color alone (always pair key color with its text label).

## 7. Data model (SQLite, illustrative)

```
sources(id, path, label, added_at)

sounds(
  id, source_id, path UNIQUE, filename,
  size, mtime, hash,
  duration, sample_rate, channels, bit_depth, format,
  key_tonic, key_mode, key_confidence, key_source,   -- key_source: filename|metadata|analysis|manual
  type, subtype, type_source,                          -- type: drum|melodic|unknown
  bpm, bpm_confidence, bpm_source,
  waveform_peaks BLOB,                                 -- cached downsampled peaks
  is_favorite, tags, notes,
  analyzed_at, analysis_version
)

-- indexes on key_tonic, key_mode, type, subtype, bpm, is_favorite, source_id, filename
```

Store an `analysis_version` so you can re-run analysis only when the algorithm improves. Manual overrides recorded via `*_source = 'manual'` and never clobbered by rescans.

## 8. Performance & scale
- Assume **50,000+ samples**. Everything must stay smooth: virtualized lists, indexed DB queries, debounced search, lazy/cached waveforms, background worker-pool analysis.
- Initial scan of a large library should make the UI usable immediately (stream results in as they're indexed) rather than blocking on full analysis.
- Cache waveform peaks so re-opening a sound is instant. Memory-bound the audio decoder (don't hold thousands of decoded buffers).

## 9. Edge cases & error handling
- Corrupt/zero-byte/unsupported files → skip with a flag, surface a count of "couldn't analyze."
- Files moved/renamed/deleted after scan → reconcile via the watcher; show "missing" state, offer to relink or remove from index.
- Duplicate files (same content, different paths) → optionally flag duplicates.
- Atonal/percussive/noise samples → key = Unknown (don't force a guess).
- Enharmonic equivalents (C#/Db) → normalize to one canonical spelling, display the alias.
- Major/minor ambiguity → keep confidence honest; let the user correct.
- Very long files → cap analysis window for key/BPM for speed.
- BPM half/double-time ambiguity → normalize to a sensible range and expose the alternate (70 ↔ 140). One-shots / non-rhythmic sounds → no tempo; never fabricate one.
- Filename false positives in key parsing (the "C" in "Clap") → guard with strict key-token matching.

## 10. macOS specifics
- Request and handle **folder access permissions**; if sandboxed, use **security-scoped bookmarks** to retain access across launches. (Simplest path: ship un-sandboxed but **code-signed and notarized**.)
- Package a **universal `.dmg`** via electron-builder; document the signing/notarization steps.
- Native-feel menus, window chrome, and standard shortcuts.

## 11. Build milestones (phased)
1. **Shell:** Electron + React + Tailwind app boots; main/preload/renderer + typed IPC; repository boundary wired up; dark themed layout skeleton.
2. **Ingestion + index:** add folders, recursive scan, metadata extraction, persisted sources, chokidar watching, live progress UI.
3. **Key + tempo + type:** filename/metadata parsing → pure-TypeScript audio analysis fallback for both **key and BPM**; drum-vs-melodic classification + subtypes; store results.
4. **Browse:** virtualized library, key color system, circle-of-fifths wheel filter, review/type/BPM/search filters, sort.
5. **Audio:** preview playback, player bar, cached row waveform peaks, keyboard audition workflow.
6. **Key edge pass:** tune filename parsing, metadata parsing, chroma key detection, tuned one-shot/drum
   pitch detection, noise rejection, and `analysisVersion` migrations.
7. **Drag-to-DAW:** Electron `startDrag` (single + multi), verified into a DAW and Finder.
8. **Polish:** overrides, favorites, tags, detector/scan animations, empty/onboarding states, performance pass at 50k files, sign + notarize + `.dmg`.

### Current hardening priorities after 0.4.0

- Expand the benchmark beyond filename fixtures into labeled decoded audio fixtures.
- Keep improving BPM detection and ambiguity reporting.
- Only migrate from JSON to SQLite after validating cached waveform size/performance in large libraries
  and packaging native dependencies cleanly for macOS universal + Windows x64.

## 12. Definition of done (acceptance criteria)
- I can add a messy folder of mixed samples and drum kits; within seconds I'm browsing, and analysis fills in keys/types in the background with a visible "detecting" state.
- Sounds with keys in their filenames are correctly read; unlabeled melodic sounds get a reasonable **detected** key with a confidence; drums and one-shots are correctly separated from melodic samples and sub-categorized.
- Sounds with a tempo in their filename are read correctly; loops and rhythmic samples get a reasonable **detected BPM**; I can browse, filter, and sort by tempo (with half/double-time matching).
- I can filter to, e.g., **"Melodic + F minor + 90–100 BPM"** via the color wheel, the tempo slider, and a type toggle and see only those, color-coded.
- I can **click to instantly preview** any sound and scrub its waveform.
- I can **drag a sound directly into my DAW** and it imports as the real audio file.
- I can **correct** a wrong key or type and the fix sticks across rescans.
- It stays fast and responsive with tens of thousands of samples, fully offline.

## 13. Nice-to-haves (only after the above)
- Tempo-sync preview (audition loops time-stretched to a target/project tempo).
- Key-transpose preview (audition a sample shifted to a target key).
- Similar-sound / "more like this" suggestions.
- Smart auto-crates ("All my C minor melodics," "All 808s").
- Tag-along export of a selection to a new folder.

---

**Deliver:** a working, signed macOS Electron app meeting Section 12, with clean typed code, the key-as-color system implemented as the visual signature, and the circle-of-fifths wheel + detector scan animation as the branded centerpieces. Build incrementally per Section 11 and keep the app runnable at the end of every milestone.
