# Changelog

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
