// Scoring for key / tempo predictions against labeled ground truth.
//
// Key: MIREX-style weighted score (exact 1.0, perfect fifth 0.5, relative 0.3,
// parallel 0.2), plus plain tonic and exact accuracy and coverage. Tempo: exact
// integer BPM, Acc1 (±4%), Acc2 (±4% allowing ×2 ×½ ×3 ×⅓ octave errors).

const PCS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const pc = (t) => PCS.indexOf(t)

export function keyRelation(label, pred) {
  // label/pred: { tonic, mode } (mode may be null)
  const lt = pc(label.tonic)
  const pt = pc(pred.tonic)
  if (lt < 0 || pt < 0) return 'other'
  const d = (pt - lt + 12) % 12
  if (!label.mode || !pred.mode) {
    if (d === 0) return 'tonic'
    if (d === 7) return 'fifth-up'
    if (d === 5) return 'fifth-down'
    return 'other'
  }
  if (label.mode === pred.mode) {
    if (d === 0) return 'exact'
    if (d === 7) return 'fifth-up'
    if (d === 5) return 'fifth-down'
    return 'other'
  }
  if (d === 0) return 'parallel'
  // relative: C major ↔ A minor (minor tonic is 9 semitones above the major tonic)
  if (label.mode === 'major' && d === 9) return 'relative'
  if (label.mode === 'minor' && d === 3) return 'relative'
  return 'other'
}

const MIREX = { exact: 1, 'fifth-up': 0.5, 'fifth-down': 0.5, relative: 0.3, parallel: 0.2, other: 0, tonic: 1 }

const pct = (n, d) => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : '—')
const pad = (s, n) => String(s).padEnd(n)

export function scoreKeys(rows) {
  const labeled = rows.filter((r) => r.tonic && !r.error)
  let predicted = 0
  let tonicHits = 0
  let withMode = 0
  let withModePred = 0
  let exact = 0
  let mirex = 0
  const rel = {}
  for (const r of labeled) {
    const k = r.pred?.key
    if (!k?.tonic) continue
    predicted++
    if (k.tonic === r.tonic) tonicHits++
    if (r.mode) {
      withMode++
      if (k.mode) {
        withModePred++
        const relation = keyRelation(r, k)
        rel[relation] = (rel[relation] ?? 0) + 1
        if (relation === 'exact') exact++
        mirex += MIREX[relation] ?? 0
      } else if (k.tonic === r.tonic) {
        rel['tonic-only'] = (rel['tonic-only'] ?? 0) + 1
      } else {
        rel['wrong-no-mode'] = (rel['wrong-no-mode'] ?? 0) + 1
      }
    }
  }
  const labeledWithMode = labeled.filter((r) => r.mode).length
  return {
    n: labeled.length,
    predicted,
    coverage: predicted / Math.max(1, labeled.length),
    tonicAccPredicted: tonicHits / Math.max(1, predicted),
    tonicAccAll: tonicHits / Math.max(1, labeled.length),
    labeledWithMode,
    exactAccModePred: exact / Math.max(1, withModePred),
    exactAccAll: exact / Math.max(1, labeledWithMode),
    mirexAll: mirex / Math.max(1, labeledWithMode),
    relations: rel,
    withMode,
    withModePred
  }
}

export function bpmRelation(label, pred) {
  const within = (a, b) => Math.abs(a - b) <= 0.04 * b
  if (Math.abs(pred - label) <= 0.5) return 'exact'
  if (within(pred, label)) return 'acc1'
  if (within(pred, label * 2)) return 'double'
  if (within(pred, label / 2)) return 'half'
  if (within(pred, label * 3) || within(pred, label / 3)) return 'triple'
  if (within(pred, (label * 3) / 2) || within(pred, (label * 2) / 3)) return 'three-two'
  return 'other'
}

export function scoreBpm(rows) {
  const labeled = rows.filter((r) => r.kind === 'loop' && r.bpm && !r.error)
  let predicted = 0
  const rel = {}
  for (const r of labeled) {
    const p = r.pred?.bpm
    if (p == null) continue
    predicted++
    const relation = bpmRelation(r.bpm, p)
    rel[relation] = (rel[relation] ?? 0) + 1
  }
  const exact = rel.exact ?? 0
  const acc1 = exact + (rel.acc1 ?? 0)
  const acc2 = acc1 + (rel.double ?? 0) + (rel.half ?? 0) + (rel.triple ?? 0)
  const oneshots = rows.filter((r) => r.kind === 'oneshot' && !r.error)
  const oneshotTempo = oneshots.filter((r) => r.pred?.bpm != null).length
  return {
    n: labeled.length,
    predicted,
    coverage: predicted / Math.max(1, labeled.length),
    exactAll: exact / Math.max(1, labeled.length),
    acc1All: acc1 / Math.max(1, labeled.length),
    acc2All: acc2 / Math.max(1, labeled.length),
    acc1Predicted: acc1 / Math.max(1, predicted),
    relations: rel,
    oneshots: oneshots.length,
    oneshotTempo
  }
}

function calibration(rows, getConf, isRight) {
  const bins = [0, 0.2, 0.4, 0.55, 0.7, 0.85, 1.01]
  const lines = []
  for (let i = 0; i < bins.length - 1; i++) {
    const inBin = rows.filter((r) => {
      const c = getConf(r)
      return c != null && c >= bins[i] && c < bins[i + 1]
    })
    if (!inBin.length) continue
    const right = inBin.filter(isRight).length
    lines.push(`    conf ${bins[i].toFixed(2)}–${Math.min(1, bins[i + 1]).toFixed(2)}: ${pad(inBin.length, 5)} acc ${pct(right, inBin.length)}`)
  }
  return lines.join('\n')
}

function keyBlock(title, rows) {
  const s = scoreKeys(rows)
  if (!s.n) return ''
  const relations = Object.entries(s.relations)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')
  const labeled = rows.filter((r) => r.tonic && !r.error && r.pred?.key?.tonic)
  return [
    `  ${title}: n=${s.n}  coverage ${pct(s.predicted, s.n)}`,
    `    tonic acc: ${pct(s.tonicAccAll * s.n, s.n)} of all · ${pct(s.tonicAccPredicted * s.predicted, s.predicted)} of predicted`,
    s.labeledWithMode
      ? `    with mode (n=${s.labeledWithMode}): exact ${pct(s.exactAccAll * s.labeledWithMode, s.labeledWithMode)} of all · ${pct(s.exactAccModePred * s.withModePred, s.withModePred)} of mode-predicted · MIREX ${(100 * s.mirexAll).toFixed(1)}`
      : '',
    relations ? `    relations: ${relations}` : '',
    calibration(labeled, (r) => r.pred.key.confidence, (r) => r.pred.key.tonic === r.tonic && (!r.mode || !r.pred.key.mode || r.pred.key.mode === r.mode))
  ]
    .filter(Boolean)
    .join('\n')
}

function bpmBlock(title, rows) {
  const s = scoreBpm(rows)
  if (!s.n) return ''
  const relations = Object.entries(s.relations)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')
  const labeled = rows.filter((r) => r.kind === 'loop' && r.bpm && !r.error && r.pred?.bpm != null)
  return [
    `  ${title}: n=${s.n}  coverage ${pct(s.predicted, s.n)}`,
    `    exact ${pct(s.exactAll * s.n, s.n)} · acc1 ${pct(s.acc1All * s.n, s.n)} · acc2 ${pct(s.acc2All * s.n, s.n)}  (acc1 of predicted ${pct(s.acc1Predicted * s.predicted, s.predicted)})`,
    `    relations: ${relations}`,
    s.oneshots ? `    one-shots given a tempo: ${pct(s.oneshotTempo, s.oneshots)} (${s.oneshotTempo}/${s.oneshots})` : '',
    calibration(labeled, (r) => r.pred.bpmConfidence, (r) => ['exact', 'acc1'].includes(bpmRelation(r.bpm, r.pred.bpm)))
  ]
    .filter(Boolean)
    .join('\n')
}

const TAG_GROUPS = [
  ['bass', /bass|808|sub/],
  ['keys/piano', /piano|keys|rhodes|organ|electric piano/],
  ['guitar', /guitar/],
  ['synth', /synth|lead|pluck|arp/],
  ['pad/texture', /pad|texture|ambient|atmos/],
  ['vocal', /vocal|vox|choir/],
  ['strings/brass/winds', /strings|violin|cello|brass|horn|trumpet|flute|sax|woodwind/],
  ['chords', /chord/],
  ['drums/perc', /drum|percussion|kick|snare|hat|clap|perc|top/]
]

function groupOf(r) {
  const tags = (r.tags || []).join(' ').toLowerCase()
  for (const [name, re] of TAG_GROUPS) if (re.test(tags)) return name
  return 'other'
}

export function report(rows) {
  const errors = rows.filter((r) => r.error)
  const loops = rows.filter((r) => r.kind === 'loop')
  const shots = rows.filter((r) => r.kind === 'oneshot')
  const lines = []
  lines.push(`decode/analysis errors: ${errors.length}`)
  lines.push('KEY')
  lines.push(keyBlock('loops', loops))
  lines.push(keyBlock('one-shots', shots))
  lines.push('  by instrument group (loops+one-shots, tonic acc of all / exact of all):')
  const groups = new Map()
  for (const r of rows.filter((x) => x.tonic && !x.error)) {
    const g = groupOf(r)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(r)
  }
  for (const [g, rs] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const s = scoreKeys(rs)
    lines.push(
      `    ${pad(g, 20)} n=${pad(s.n, 5)} cov ${pad(pct(s.predicted, s.n), 6)} tonic ${pad(pct(s.tonicAccAll * s.n, s.n), 6)} exact ${s.labeledWithMode ? pct(s.exactAccAll * s.labeledWithMode, s.labeledWithMode) : '—'}`
    )
  }
  lines.push('TEMPO')
  lines.push(bpmBlock('loops', rows))
  const drumLoops = loops.filter((r) => groupOf(r) === 'drums/perc')
  const tonalLoops = loops.filter((r) => groupOf(r) !== 'drums/perc')
  lines.push(bpmBlock('  drum/perc loops', drumLoops))
  lines.push(bpmBlock('  other loops', tonalLoops))
  return lines.filter(Boolean).join('\n')
}
