#!/usr/bin/env python3
"""Train the transposition-equivariant key classifier from a feature dump.

    python scripts/eval/train_key.py <keyfeat-dump.jsonl> [--sweep] [--export src/shared/keyModel.ts]

Each sample contributes 12-dim pitch-class profiles (chroma variants). The score of
key (tonic t, mode m) is  w_m · φ(rotate(profiles, t)) + b_m:  one weight vector per
mode, shared across all twelve tonics, so the model is exactly transposition-
equivariant (it learns key *profiles*, not key frequencies) with a few hundred
parameters. A "shortness" gate g (1 for hits, 0 for phrases) adds a second set of
profiles for short sounds:  score += g · (w'_m · φ + b'_m).

Softmax over the 24 keys; labels without a mode count toward either mode. Folds are
grouped by sample pack, so the reported accuracy reflects unseen packs.
"""
import json
import sys
import numpy as np
from scipy.optimize import minimize

PCS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
EPS = 0.02
GATE = (1.0, 4.0)  # (shortSec, phraseSec)
# A sound is treated as a "hit" only if it is short AND harmonically static: the gate
# fades out as more pitch classes take turns being the loudest (a moving melody).
VARIETY = (1.5, 3.5)  # (varietyFull, varietyNone); None disables
USE_VARIETY = '--no-variety-gate' not in sys.argv


def pack_fold(pack, k=5):
    """Stable pack → fold assignment shared with scripts/eval/run-eval.mjs (FNV-1a)."""
    h = 0x811C9DC5
    for b in str(pack).encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % k


def load(path):
    rows = []
    for line in open(path):
        r = json.loads(line)
        if r.get('error') or not r.get('pred') or 'kf' not in r['pred'] or not r.get('tonic'):
            continue
        r['t'] = PCS.index(r['tonic'])
        r['m'] = {'major': 0, 'minor': 1}.get(r.get('mode'), -1)
        rows.append(r)
    return rows


def block_vec(kf, name):
    if name in ('pitch', 'yin'):
        v = np.zeros(12)
        if kf['yinPc'] >= 0:
            v[kf['yinPc']] = kf['yinConf']
        return v
    return np.array(kf[name], dtype=np.float64)


def transform_of(name):
    return 'lin' if name in ('pitch', 'yin') else 'log'


def rotations(v):
    """(12, 12): row t = v rotated so the candidate tonic t sits at index 0."""
    idx = (np.arange(12)[None, :] + np.arange(12)[:, None]) % 12
    return v[idx]


def shortness(sec, variety=None):
    lo, hi = GATE
    g = float(np.clip((hi - sec) / (hi - lo), 0, 1))
    if USE_VARIETY and variety is not None:
        vf, vn = VARIETY
        g *= float(np.clip((vn - variety) / (vn - vf), 0, 1))
    return g


def design(rows, names, gate=True):
    """X: (n, 24, D) — per sample, per key, the feature vector; D covers both modes."""
    n = len(rows)
    F = np.zeros((n, 12, 12 * len(names)))
    G = np.zeros(n)
    for i, r in enumerate(rows):
        kf = r['pred']['kf']
        parts = []
        for nm in names:
            v = block_vec(kf, nm)
            if transform_of(nm) == 'log':
                v = np.log(v + EPS)
            parts.append(rotations(v))
        F[i] = np.concatenate(parts, axis=1)
        G[i] = shortness(kf['activeSec'], kf.get('variety')) if gate else 0.0
    d = F.shape[2]
    # layout: [major d | minor d | minor bias | (gated) major d | minor d | minor bias]
    D = 2 * d + 1
    X = np.zeros((n, 24, 2 * D if gate else D))
    X[:, :12, :d] = F
    X[:, 12:, d:2 * d] = F
    X[:, 12:, 2 * d] = 1.0
    if gate:
        g = G[:, None, None]
        X[:, :12, D:D + d] = F * g
        X[:, 12:, D + d:D + 2 * d] = F * g
        X[:, 12:, D + 2 * d] = G[:, None]
    return X


def labels(rows):
    y = np.zeros((len(rows), 24), dtype=bool)
    for i, r in enumerate(rows):
        if r['m'] == 0:
            y[i, r['t']] = True
        elif r['m'] == 1:
            y[i, 12 + r['t']] = True
        else:
            y[i, r['t']] = True
            y[i, 12 + r['t']] = True
    return y


def fit(X, y, lam):
    n, K, D = X.shape
    Xf = X.reshape(n * K, D)

    def obj(w):
        s = (Xf @ w).reshape(n, K)
        s -= s.max(1, keepdims=True)
        e = np.exp(s)
        p = e / e.sum(1, keepdims=True)
        pc = (p * y).sum(1)
        loss = -np.log(pc + 1e-12).mean() + lam * (w @ w)
        q = p * y / (pc[:, None] + 1e-12)
        g = Xf.T @ ((p - q).reshape(n * K)) / n + 2 * lam * w
        return loss, g

    res = minimize(obj, np.zeros(D), jac=True, method='L-BFGS-B', options=dict(maxiter=3000))
    return res.x


def probs(X, w):
    n, K, D = X.shape
    s = (X.reshape(n * K, D) @ w).reshape(n, K)
    s -= s.max(1, keepdims=True)
    e = np.exp(s)
    return e / e.sum(1, keepdims=True)


def score(rows, P):
    tonic = exact = mirex = n_mode = 0
    for r, p in zip(rows, P):
        k = int(np.argmax(p))
        t, m = k % 12, k // 12
        if r['m'] < 0:
            tm = int(np.argmax(p[:12] + p[12:]))
            tonic += tm == r['t']
            continue
        tonic += t == r['t']
        n_mode += 1
        d = (t - r['t']) % 12
        if m == r['m']:
            if d == 0:
                exact += 1
                mirex += 1
            elif d in (5, 7):
                mirex += 0.5
        else:
            if d == 0:
                mirex += 0.2
            elif (r['m'] == 0 and d == 9) or (r['m'] == 1 and d == 3):
                mirex += 0.3
    n = len(rows)
    return dict(tonic=tonic / max(1, n), exact=exact / max(1, n_mode), mirex=mirex / max(1, n_mode), n=n, n_mode=n_mode)


def folds(rows, k=5, seed=0):
    return np.array([pack_fold(r.get('pack') or r['path'], k) for r in rows])


def ks_baseline(rows, block='treble'):
    P = []
    for r in rows:
        R = rotations(np.array(r['pred']['kf'][block]))
        maj = [np.corrcoef(R[t], KS_MAJOR)[0, 1] if R[t].std() > 0 else 0 for t in range(12)]
        mn = [np.corrcoef(R[t], KS_MINOR)[0, 1] if R[t].std() > 0 else 0 for t in range(12)]
        P.append(np.exp(10 * np.array(maj + mn)))
    return np.array(P)


def cv(rows, names, lam, gate=True, k=5):
    fo = folds(rows, k)
    X = design(rows, names, gate)
    y = labels(rows)
    P = np.zeros((len(rows), 24))
    for f in range(k):
        tr, te = fo != f, fo == f
        w = fit(X[tr], y[tr], lam)
        P[te] = probs(X[te], w)
    return P


def report(tag, rows, P):
    loops = [i for i, r in enumerate(rows) if r['kind'] == 'loop']
    shots = [i for i, r in enumerate(rows) if r['kind'] != 'loop']
    sl = score([rows[i] for i in loops], P[loops])
    so = score([rows[i] for i in shots], P[shots])
    print(f'{tag:58s} loops tonic {sl["tonic"]:.3f} exact {sl["exact"]:.3f} mirex {sl["mirex"]:.3f} | '
          f'shots tonic {so["tonic"]:.3f} exact {so["exact"]:.3f}', flush=True)
    return sl, so


def export(rows, names, lam, path, cv_note):
    X = design(rows, names, True)
    w = fit(X, labels(rows), lam)
    d = 12 * len(names)
    D = 2 * d + 1
    model = dict(
        version=1,
        eps=EPS,
        gate=dict(enabled=True, shortSec=GATE[0], phraseSec=GATE[1],
                  varietyFull=VARIETY[0] if USE_VARIETY else 0, varietyNone=VARIETY[1] if USE_VARIETY else 0),
        blocks=[dict(name=('pitch' if n in ('yin', 'pitch') else n), transform=transform_of(n)) for n in names],
        major=[round(float(x), 6) for x in w[:d]],
        minor=[round(float(x), 6) for x in w[d:2 * d]],
        minorBias=round(float(w[2 * d]), 6),
        majorShort=[round(float(x), 6) for x in w[D:D + d]],
        minorShort=[round(float(x), 6) for x in w[D + d:D + 2 * d]],
        minorBiasShort=round(float(w[D + 2 * d]), 6),
    )
    ts = (
        '// Generated by scripts/eval/train_key.py — do not edit by hand.\n'
        f'// Trained on {len(rows)} producer-labelled samples; {cv_note}\n\n'
        'export interface KeyModel {\n'
        '  version: number\n  eps: number\n'
        '  gate: { enabled: boolean; shortSec: number; phraseSec: number; varietyFull: number; varietyNone: number }\n'
        "  blocks: { name: string; transform: 'log' | 'lin' }[]\n"
        '  major: number[]\n  minor: number[]\n  minorBias: number\n'
        '  majorShort: number[]\n  minorShort: number[]\n  minorBiasShort: number\n}\n\n'
        f'export const KEY_MODEL: KeyModel = {json.dumps(model, indent=2)}\n'
    )
    open(path, 'w').write(ts)
    print('model →', path)


def main():
    rows = load(sys.argv[1])
    print(f'{len(rows)} labeled samples ({sum(r["kind"] == "loop" for r in rows)} loops)')
    blocks = (sys.argv[sys.argv.index('--blocks') + 1].split(',') if '--blocks' in sys.argv
              else ['treble', 'bass', 'salience', 'bassNote', 'opening', 'closing', 'pitch'])
    lam = float(sys.argv[sys.argv.index('--lam') + 1]) if '--lam' in sys.argv else 1e-3
    if '--sweep' in sys.argv:
        report('KS template, treble chroma', rows, ks_baseline(rows, 'treble'))
        for nm in [blocks, [b for b in blocks if b != 'pitch']]:
            for gate in [False, True]:
                for lm in [3e-4, 1e-3, 3e-3]:
                    report(f'{"+".join(nm)} gate={gate} lam={lm}', rows, cv(rows, nm, lm, gate))
    if '--holdout' in sys.argv:
        k = int(sys.argv[sys.argv.index('--holdout') + 1])
        train = [r for r in rows if pack_fold(r.get('pack') or r['path']) != k]
        export(train, blocks, lam, sys.argv[sys.argv.index('--export') + 1], f'held-out fold {k} excluded from training.')
        return
    P = cv(rows, blocks, lam, True)
    sl, so = report(f'{"+".join(blocks)} gate lam={lam}', rows, P)
    if '--export' in sys.argv:
        note = f'pack-grouped 5-fold CV: loops tonic {sl["tonic"]:.3f} / exact {sl["exact"]:.3f}, one-shots tonic {so["tonic"]:.3f}.'
        export(rows, blocks, lam, sys.argv[sys.argv.index('--export') + 1], note)


if __name__ == '__main__':
    main()
