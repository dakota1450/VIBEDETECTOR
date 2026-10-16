#!/usr/bin/env python3
"""Train the tempo candidate ranker (conditional logit) from a feature dump.

    python scripts/eval/train_tempo.py <tempo-dump.jsonl> --names names.json [--out weights.json]

Each dumped loop carries its candidate list: [bpm, beats, f1..fK]. A candidate is
"correct" when it is within 0.6 BPM (or 1.2%) of the producer label. The model
maximises the log-probability of the correct candidates under a softmax over each
loop's candidates, with L2 regularisation. Folds are grouped by sample pack so the
reported accuracy reflects unseen packs, not memorised ones.
"""
import json
import sys
import numpy as np
from scipy.optimize import minimize


def pack_fold(pack, k=5):
    """Stable pack → fold assignment shared with scripts/eval/run-eval.mjs (FNV-1a)."""
    h = 0x811C9DC5
    for b in str(pack).encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % k


def load(path):
    loops = []
    for line in open(path):
        r = json.loads(line)
        if r.get('error') or not r.get('pred') or not r['pred'].get('cands'):
            continue
        c = r['pred']['cands']
        X = np.array([x[2:] for x in c], dtype=np.float64)
        bpm = np.array([x[0] for x in c], dtype=np.float64)
        beats = np.array([x[1] if x[1] is not None else -1 for x in c], dtype=np.float64)
        label = r['bpm']
        y = np.abs(bpm - label) <= max(0.6, 0.012 * label)
        loops.append(dict(X=X, bpm=bpm, beats=beats, y=y, label=label, pack=r.get('pack') or r['path'],
                          path=r['path'], g=np.array(r['pred'].get('global') or [], dtype=np.float64)))
    return loops


class Batch:
    """All candidates of many loops stacked, with group offsets for segment ops."""

    def __init__(self, loops, mu, sd):
        self.loops = loops
        self.X = (np.vstack([l['X'] for l in loops]) - mu) / sd
        self.y = np.concatenate([l['y'] for l in loops])
        sizes = np.array([len(l['y']) for l in loops])
        self.starts = np.concatenate([[0], np.cumsum(sizes)[:-1]])
        self.gid = np.repeat(np.arange(len(loops)), sizes)

    def scores(self, w):
        return self.X @ w

    def group_softmax(self, s):
        m = np.maximum.reduceat(s, self.starts)
        e = np.exp(s - m[self.gid])
        Z = np.add.reduceat(e, self.starts)
        return e / Z[self.gid]


def fit(loops, lam, mu, sd, w0=None):
    train = [l for l in loops if l['y'].any()]
    B = Batch(train, mu, sd)
    D = B.X.shape[1]
    n = len(train)

    def obj(w):
        p = B.group_softmax(B.scores(w))
        pc = np.add.reduceat(np.where(B.y, p, 0.0), B.starts)
        loss = -np.log(pc + 1e-12).sum() / n + lam * (w @ w)
        q = np.where(B.y, p, 0.0) / (pc[B.gid] + 1e-12)
        grad = B.X.T @ (p - q) / n + 2 * lam * w
        return loss, grad

    res = minimize(obj, np.zeros(D) if w0 is None else w0, jac=True, method='L-BFGS-B', options=dict(maxiter=2000))
    return res.x


def predict(loops, w, mu, sd):
    B = Batch(loops, mu, sd)
    s = B.scores(w)
    p = B.group_softmax(s)
    out = []
    for i, l in enumerate(loops):
        a, b = B.starts[i], B.starts[i] + len(l['y'])
        k = int(np.argmax(s[a:b]))
        out.append((k, float(p[a + k])))
    return out


def folds(loops, k=5, seed=0):
    return [pack_fold(l['pack'], k) for l in loops]


def cross_validate(loops, lam, k=5):
    fo = folds(loops, k)
    Xall = np.vstack([l['X'] for l in loops])
    mu, sd = Xall.mean(0), Xall.std(0) + 1e-9
    preds = [None] * len(loops)
    for f in range(k):
        tr = [l for l, g in zip(loops, fo) if g != f]
        te_idx = [i for i, g in enumerate(fo) if g == f]
        if not te_idx:
            continue
        w = fit(tr, lam, mu, sd)
        for i, pr in zip(te_idx, predict([loops[i] for i in te_idx], w, mu, sd)):
            preds[i] = pr
    done = [(i, pr) for i, pr in enumerate(preds) if pr is not None]
    acc = np.mean([loops[i]['y'][pr[0]] for i, pr in done])
    return acc, [pr if pr is not None else (0, 0.0) for pr in preds]


def main():
    path = sys.argv[1]
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
    names = json.load(open(sys.argv[sys.argv.index('--names') + 1]))
    loops = load(path)
    if '--holdout' in sys.argv:
        k = int(sys.argv[sys.argv.index('--holdout') + 1])
        loops = [l for l in loops if pack_fold(l['pack']) != k]
    print(f'{len(loops)} loops, {loops[0]["X"].shape[1]} features, reachable {np.mean([l["y"].any() for l in loops]):.4f}')
    best = None
    for lam in ([3e-4] if '--holdout' in sys.argv else [3e-4, 1e-3, 3e-3]):
        acc, preds = cross_validate(loops, lam)
        print(f'lam={lam}: CV top-1 {acc:.4f}')
        if best is None or acc > best[0]:
            best = (acc, lam, preds)
    acc, lam, preds = best
    Xall = np.vstack([l['X'] for l in loops])
    mu, sd = Xall.mean(0), Xall.std(0) + 1e-9
    w = fit(loops, lam, mu, sd)
    raw = w / sd  # softmax is shift-invariant, so the mean offset can be dropped
    for nme, v, vs in sorted(zip(names, raw, w), key=lambda t: -abs(t[2])):
        print(f'  {nme:16s} {v:+9.4f}   (std {vs:+.3f})')
    if '--export' in sys.argv:
        ts_path = sys.argv[sys.argv.index('--export') + 1]
        lines = '\n'.join(f'    {v:.6f}, // {n}' for n, v in zip(names, raw))
        open(ts_path, 'w').write(
            '// Generated by scripts/eval/train_tempo.py — do not edit by hand.\n'
            f'// Conditional-logit tempo candidate ranker over TEMPO_FEATURE_NAMES (+ global × log-tempo\n'
            f'// interactions), trained on {len(loops)} producer-labelled loops. Pack-grouped 5-fold CV\n'
            f'// top-1 accuracy: {acc:.3f}.\n'
            'export const TEMPO_MODEL = {\n'
            '  version: 1,\n'
            '  weights: [\n' + lines + '\n  ]\n}\n'
        )
        print('model →', ts_path)
    if out:
        json.dump(dict(names=names, weights=[float(x) for x in raw], lam=lam, cv=acc), open(out, 'w'), indent=1)
        cvp = out.replace('.json', '.cv.jsonl')
        with open(cvp, 'w') as fh:
            for l, (k_, p) in zip(loops, preds):
                fh.write(json.dumps(dict(path=l['path'], label=l['label'], pred=float(l['bpm'][k_]), beats=float(l['beats'][k_]), p=p, ok=bool(l['y'][k_]))) + '\n')
        print('weights →', out)


if __name__ == '__main__':
    main()
