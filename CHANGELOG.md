# Changelog

## 0.5.0 - Measured Detection

Key and tempo detection rebuilt from the ground up — and, for the first time, *measured*:
every number below comes from running the shipping analysis code over 10,817
producer-labelled samples (2,000+ Splice packs), scored only on packs the models never saw
during training (5-fold, grouped by pack). Filenames are ignored for these numbers — this
is what the app hears.

| Audio-only, on held-out packs | 0.4.0 | 0.5.0 |
| --- | --- | --- |
| Loops — exact BPM | 7.2% | **80.6%** |
| Loops — BPM within 4% | 36.6% | **80.9%** |
| Loops — BPM, half/double time allowed | 51.5% | **93.5%** |
| Drum loops — exact BPM | 9.8% | **84.4%** |
| One-shots given a (wrong) tempo | 18.0% | **2.5%** |
| Loops — a key is named | 76.4% | **90.9%** |
| Loops — right key root, when named | 44.8% | **58.0%** |
| Loops — exact key, all mode-labelled loops | 25.1% | **51.9%** |
| Loops — right key among the top 3 suggestions | — | **81.0%** |
| One-shots — right root, when named | 64.5% | **72.5%** |
| Bass & 808 one-shots — right note, when named | — | **88.3%** |

Confidence is calibrated: loop tempos read at ≥85% confidence (6 in 10 loops) are right 94.6% of
the time; keys read at ≥80% are right 84.8% of the time.

### Tempo
- **New loop-grid tempo estimator** (`src/shared/tempo.ts`). Log-compressed mel-band spectral
  flux (172 frames/s, full/low/mid/high bands) → generalized autocorrelation. Because producer
  loops are cut to whole bars, the file's exact length admits only a few tempos
  (60·beats/duration); those candidates, the audio's periodicity peaks and their octave
  relatives are each scored on ~70 features (periodicity at beat/half/bar lags, beat-grid phase
  at the loop start, whole-BPM closeness, bar structure, metrical profile, onsets per beat,
  timbre × log-tempo interactions) by a conditional-logit ranker trained on 4,666 labelled loops.
  It learns how producers label half/double time (trap at 140, not 70).
- **Exact BPMs** locked to the loop's own grid (whole-number readings of a grid are preferred,
  as producer tempos almost always are — an 87.5 BPM loop reads as its double, 175), plus
  **½× / 2× readings** stored with every detection and offered as one-click fixes.
- **A learned "has a tempo?" gate** stops pads, risers, crashes and other one-shots from getting
  a fake BPM; one-shot-named files ("One Shots", "Hits") skip tempo analysis entirely.
- **Drum loops now get tempos.** Previously anything typed "drum" was excluded from tempo
  analysis, so drum loops without a BPM in the name never got one.
- **Filename tempos are checked against the loop length.** A bare number that cuts the loop into
  whole beats is trusted (99.8% correct); one that doesn't (a take/variation number) is demoted and
  audio-checked. When audio reads a weak filename tempo at half/double time, the producer's octave
  is kept.

### Key
- **New learned key classifier** (`keyFeatures.ts`, `keyClassifier.ts`, `key.ts`). Tuning-corrected
  (A440-relative, circular-mean) spectral peaks from a drum-suppressing temporal median produce
  treble, bass, harmonic-salience, lowest-note, opening/closing and first-chord chroma plus a
  chord-root histogram. A transposition-equivariant softmax over the 24 keys (one profile per
  mode, shared by all 12 tonics) trained on 4,318 labelled samples turns them into calibrated
  probabilities. A second profile set handles short, harmonically static sounds (one-shots, 808s,
  stabs), gated by length *and* note variety so short melodic phrases are still read as phrases.
- **Calibrated confidence**: when the app is ≥80% sure of a key it is right ~85% of the time
  (tempo: ≥85% sure → right ~95%).
- **Top alternatives** ("Audio reading": e.g. Am 71% · C 15%) shown in the detail panel; one click
  applies one.
- **No third, no mode**: single notes, 808s and power chords get a root but no major/minor.
- **Per-family thresholds** from measured accuracy: melodic 25%, tuned drums 40%, hats/claps/
  snares/cymbals and whole drum loops 55% — so hats stay keyless instead of getting random keys.
- **Filename key parser fixes** — all-caps pack codes are no longer read as flat keys (`AB_` → A♭,
  `BB3_` → B♭, `CB2_` → C♭, `DBM_` → D♭ minor at 90% confidence!); `A#M` reads as major; when two
  explicit keys appear, the last one wins. Filename-key accuracy at 0.7 confidence: 88.6% → 98.9%.
  Existing libraries re-read names once (`NAME_VERSION`), no audio work needed.
- An upgraded audio analysis now replaces older analysis keys/tempos (previously an old,
  confidently-wrong result could never be refreshed).

### App & design
- New brand mark and icon: a radar sweeping the circle of fifths — the twelve key dots sit where
  they sit on the key wheel, in the key colours, and the keys under the sweep light up.
  Regenerated `.icns`/`.ico`/PNGs (also fixes a light strip along the old icon's right/bottom edge).
- Key wheel doubles as a library map — segment brightness shows how many sounds are in each key;
  hover for key, Camelot code and count.
- **Compatible keys** filter (Camelot ±1 + relative) for harmonic layering; compatible segments are
  outlined on the wheel.
- Rows show the specific subtype (Kick, 808, Pad, Loop…), tentative keys with a dashed outline and
  low-confidence BPMs dimmed; drum loops have a proper **Loop** subtype.
- Tonic-only sounds match both the major and minor key filter on their root.
- Fixed a first-import race that could leave the list showing the empty state.
- Removed a leftover test harness that wrote `_libtest.txt` into the repo on every test run.

### Tooling
- `scripts/eval/` — a reproducible evaluation + training toolkit: Splice-DB ground truth
  (`dataset-from-splice.mjs`), a parallel harness that runs the exact shipping analysis job
  (`run-eval.mjs`, pure-JS WAV decode + band-limited resampling matching the app), metrics
  (MIREX key score, Acc1/Acc2 tempo, calibration), trainers for the tempo ranker, tempo gate and
  key model, and a fully held-out end-to-end evaluation (`holdout-eval.mjs`).
- `scripts/make-demo-library.mjs` (synthesized demo library for screenshots/QA) and
  `scripts/make-og-image.cjs` (social card).

## 0.4.0 - Trust, Review, and Cached Waveforms

Make key detection more measurable and make analysis results easier to trust, review,
and correct at library scale.

- **Added a key-detection benchmark.** `npm run benchmark:key` runs embedded labeled
  filename fixtures and reports accuracy, coverage, precision, false positives,
  false negatives, tonic mismatches, and mode mismatches. The reusable evaluator
  lives in `src/shared/keyDetectionBenchmark.ts`.
- **Added structured key diagnostics.** Audio key analysis now records detector
  evidence and store merge decisions, including accepted/rejected/updated/cleared
  reasons, previous key snapshots, candidate snapshots, confidence, threshold, and
  atonal-drum veto state.
- **Added cached real row waveforms.** The existing renderer analysis pipeline now
  computes normalized waveform peak buckets from decoded audio, persists them in
  the JSON store, invalidates them when files change, and renders them in rows with
  the old deterministic bars only as a fallback.
- **Added review workflows.** The sidebar now has `Needs review` and `Failed analysis`
  filters, plus stricter `Unknown`, `Low`, and `Verified` key filters aligned with
  the store's trust thresholds.
- **Added batch correction.** Multi-select now exposes a compact batch toolbar for
  setting/clearing keys, marking selected sounds as melodic/drums, favoriting, and
  clearing the selection.
- **Made analysis failures visible and retryable.** Decode, timeout, and worker
  failures are stored as analysis errors, shown in rows/details, filtered by the
  review queue, and can be retried from the detail panel.
- **Improved project hygiene.** The project is now initialized as a git repository
  and `.gitignore` excludes generated build/test artifacts.

## 0.3.0 - Sound-Driven Detection

Make the actual audio — not the filename — the source of truth for key and type,
fixing mislabels (e.g. a brass stab read as a drum) and making key detection
accurate on any sound, including tuned drum one-shots.

- **Rewrote audio key detection.** Robust multi-window YIN pitch tracking that skips
  the attack transient and votes across the sustained body — accurate tonic on tuned
  snares/toms/808s and one-shots. Peak-picking chromagram with parabolic frequency
  interpolation and power weighting (so a note's upper harmonics no longer pull a
  triad toward its relative/parallel key). A polyphonic-vs-monophonic fusion: chords
  and loops get tonic + mode from chroma-KS, single notes and tuned hits get a tonic
  from the pitch tracker, and flat (noisy) spectra earn no key.
- **Type is now decided from the sound, not duration.** A short tonal stab/pluck is
  melodic; a tuned snare stays a drum (still keyed); kicks/808s are protected by a
  spectral-centroid floor. Generically-named files are left `Unknown` for the audio
  classifier instead of being guessed as drums from their length.
- The analysis pass now verifies type on every non-manual sound (fixes filename
  mislabels in both directions) and runs key detection on tuned drums.
- Kick guard: short, low, fast-decaying thumps no longer get a spurious key, while
  sustained low tones (808s) and ringing toms still do.
- Bumped `analysisVersion` to 3 so existing libraries get one upgraded pass while
  preserving manual overrides; explicit filename key tags (maj/min/Camelot) are kept.
- Added a realistic-synthesis test suite (tuned drums, plucks, stabs, chords, noise)
  and verified the full pipeline end-to-end on the WAV fixtures.

### Tuned against a real 11,000-file Splice library

- **Type classification: ~80% → ~99%.** Validated that filename/folder labels in a
  real library are highly reliable, so type now trusts an explicit instrument/drum
  keyword (or a "Drum Loops"/"Percussion" folder) and only asks the audio classifier
  to decide when the name says nothing. `classify` learned generic drum-context
  ("drum loop", "percussion", "break") and split instrument keywords from the generic
  "loop"/"sample" words so a drum loop isn't read as melodic.
- **Key tonic accuracy materially improved** (≈55% exact / ≈74% within a fifth or
  relative on one-shots; loops lower, as a 2-bar loop is often a non-tonic chord).
  Three fixes drove this, found by diagnosing real mismatches:
  - The monophonic pitch tracker is now restricted to one-shots; musical phrases use
    the chroma estimate (a pitch tracker on a loop locks onto the bass/dominant note —
    the main fifth/fourth key error).
  - The chromagram is normalised per frame (key = which notes are used over time, not
    how loud or sustained one note is) and weights the bass register (the root usually
    lives in the bass), which breaks the i↔v / i↔iv confusion.
  - Mode is taken from the chroma for chords/loops and left open for single hits.

## 0.2.0 - Key Detection Upgrade

- Made key detection the core analysis edge for both melodic sounds and tuned drums.
- Added audio pitch-class detection for tuned one-shots, 808s, bass hits, and drum samples with stable pitch.
- Kept noisy/atonal drums below the key confidence threshold instead of forcing a guess.
- Reworked analysis queueing so drums and weak filename keys receive an audio verification pass.
- Added `analysisVersion` so existing libraries can receive one upgraded analysis pass while preserving manual overrides.
- Expanded melodic labels to include guitar, piano, synth, strings, brass, winds, and mallet.
- Improved filename key parsing for contextual names like `Guitar_in_A`, `Kick_C`, `808 F`, and minor chord tokens such as `Am7`.
- Updated tests for tuned one-shot key detection, noisy drum rejection, contextual filename keys, and expanded melodic labels.
