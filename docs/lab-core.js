/* XAI Lab core: model evaluation, exact Shapley values, LIME, counterfactual search, CGM features,
   counterfactual margin and a decision-based attack. Used by the browser page and by the Node test suite. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.XAICore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- random numbers ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rand) {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  }

  /* ---------- gradient boosting models exported from scikit-learn ---------- */
  function treeValue(tree, x) {
    let n = 0;
    while (tree.l[n] !== -1) n = Math.fround(x[tree.f[n]]) <= tree.t[n] ? tree.l[n] : tree.r[n];
    return tree.v[n];
  }

  function rawScore(model, x) {
    let s = model.init;
    const trees = model.trees;
    for (let i = 0; i < trees.length; i++) s += treeValue(trees[i], x);
    return s;
  }

  function proba(model, x) {
    return 1 / (1 + Math.exp(-rawScore(model, x)));
  }

  /* ---------- Shapley values ---------- */
  function exactShapley(f, x, background) {
    const M = x.length, B = background.length, nS = 1 << M;
    const v = new Float64Array(nS), z = new Array(M);
    for (let S = 0; S < nS; S++) {
      let acc = 0;
      for (let b = 0; b < B; b++) {
        const row = background[b];
        for (let j = 0; j < M; j++) z[j] = (S >> j) & 1 ? x[j] : row[j];
        acc += f(z);
      }
      v[S] = acc / B;
    }
    const fact = [1];
    for (let i = 1; i <= M; i++) fact[i] = fact[i - 1] * i;
    const w = [];
    for (let s = 0; s < M; s++) w[s] = (fact[s] * fact[M - s - 1]) / fact[M];
    const size = new Uint8Array(nS);
    for (let S = 1; S < nS; S++) size[S] = size[S >> 1] + (S & 1);
    const phi = new Array(M).fill(0);
    for (let S = 0; S < nS; S++) {
      for (let i = 0; i < M; i++) if (!((S >> i) & 1)) phi[i] += w[size[S]] * (v[S | (1 << i)] - v[S]);
    }
    return { phi: phi, base: v[0], full: v[nS - 1] };
  }

  /* A three-player game: the chosen players are present or absent, every other feature keeps the patient's value. */
  function coalitionGame(f, x, background, players) {
    const k = players.length, values = [];
    for (let S = 0; S < 1 << k; S++) {
      let acc = 0;
      for (const row of background) {
        const z = x.slice();
        players.forEach((j, p) => { if (!((S >> p) & 1)) z[j] = row[j]; });
        acc += f(z);
      }
      values.push(acc / background.length);
    }
    const orders = permutations([...Array(k).keys()]).map(function (order) {
      let S = 0;
      const gains = new Array(k).fill(0);
      for (const p of order) {
        gains[p] = values[S | (1 << p)] - values[S];
        S |= 1 << p;
      }
      return { order: order, gains: gains };
    });
    const phi = new Array(k).fill(0);
    orders.forEach(function (o) { o.gains.forEach(function (g, p) { phi[p] += g / orders.length; }); });
    return { values: values, orders: orders, phi: phi };
  }

  function permutations(items) {
    if (items.length <= 1) return [items.slice()];
    const out = [];
    items.forEach(function (item, i) {
      const rest = items.slice(0, i).concat(items.slice(i + 1));
      permutations(rest).forEach(function (p) { out.push([item].concat(p)); });
    });
    return out;
  }

  /* ---------- LIME with binary "kept / replaced" features and a weighted ridge fit ---------- */
  function lime(f, x, pool, seed, samples) {
    const rand = mulberry32(seed), N = samples || 800, M = x.length, width2 = 0.75 * 0.75 * M;
    const A = [], y = [], w = [];
    for (let n = 0; n < N; n++) {
      const row = pool[Math.floor(rand() * pool.length)];
      const keep = new Array(M), z = new Array(M);
      let off = 0;
      for (let j = 0; j < M; j++) {
        keep[j] = n === 0 || rand() < 0.5 ? 1 : 0;
        z[j] = keep[j] ? x[j] : row[j];
        off += 1 - keep[j];
      }
      A.push([1].concat(keep));
      y.push(f(z));
      w.push(Math.exp(-off / width2));
    }
    return ridge(A, y, w, 1.0).slice(1);
  }

  function ridge(A, y, w, lambda) {
    const P = A[0].length, G = [], h = new Array(P).fill(0);
    for (let i = 0; i < P; i++) G.push(new Array(P).fill(0));
    for (let n = 0; n < A.length; n++) {
      const a = A[n];
      for (let i = 0; i < P; i++) {
        h[i] += w[n] * a[i] * y[n];
        for (let j = 0; j < P; j++) G[i][j] += w[n] * a[i] * a[j];
      }
    }
    for (let i = 1; i < P; i++) G[i][i] += lambda;
    return solve(G, h);
  }

  function solve(G, h) {
    const n = h.length, M = G.map(function (r, i) { return r.concat([h[i]]); });
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      const tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      for (let r = 0; r < n; r++) {
        if (r === c || M[c][c] === 0) continue;
        const k = M[r][c] / M[c][c];
        for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
      }
    }
    return M.map(function (r, i) { return r[n] / r[i]; });
  }

  /* ---------- counterfactual search (greedy, then minimal) ---------- */
  function counterfactual(f, x, spec) {
    const target = spec.target === undefined ? 0.5 : spec.target;
    let cur = x.slice(), p = f(cur);
    for (let it = 0; it < 40 && p >= target; it++) {
      let best = null;
      for (let j = 0; j < x.length; j++) {
        const kind = spec.kind[j];
        if (kind === null || kind === undefined) continue;
        const options = kind === "flip" ? [1 - cur[j]] : kind === "down" ? [cur[j] - 1] : [cur[j] - kind, cur[j] + kind];
        for (const v of options) {
          if (v < spec.lo[j] - 1e-9 || v > spec.hi[j] + 1e-9) continue;
          const z = cur.slice();
          z[j] = Math.round(v * 1000) / 1000;
          const pz = f(z), gain = (p - pz) / (Math.abs(v - cur[j]) / spec.scale[j]);
          if (!best || gain > best.gain) best = { z: z, pz: pz, gain: gain };
        }
      }
      if (!best || best.gain <= 0) break;
      cur = best.z;
      p = best.pz;
    }
    for (let j = 0; j < x.length; j++) {
      if (cur[j] === x[j]) continue;
      const z = cur.slice();
      z[j] = x[j];
      if (f(z) < target) cur = z;
    }
    const pf = f(cur);
    return { x: cur, p: pf, success: pf < target };
  }

  /* ---------- CGM features (identical to NB4 and tools/build_lab_models.py) ---------- */
  function slope(block) {
    const n = block.length;
    let tMean = 0, bMean = 0;
    for (let k = 0; k < n; k++) { tMean += k * 5; bMean += block[k]; }
    tMean /= n; bMean /= n;
    let num = 0, den = 0;
    for (let k = 0; k < n; k++) {
      const t = k * 5 - tMean;
      num += (block[k] - bMean) * t;
      den += t * t;
    }
    return num / den;
  }

  function cgmFeatures(w) {
    const n = w.length, last = w[n - 1];
    let mean = 0, min = Infinity, max = -Infinity;
    for (const v of w) { mean += v; if (v < min) min = v; if (v > max) max = v; }
    mean /= n;
    let ss = 0;
    for (const v of w) ss += (v - mean) * (v - mean);
    const s15 = slope(w.slice(n - 4)), s30 = slope(w.slice(n - 7)), s15b = slope(w.slice(n - 7, n - 3));
    return [last, mean, min, max, Math.sqrt(ss / n), s15, s30, (last - w[n - 2]) / 5, last - w[0], s15 - s15b];
  }

  /* Smallest uniform decrease of all readings (mg/dL) that raises the alert; maxDrop if none does. */
  function marginLower(decide, w, maxDrop, tol) {
    maxDrop = maxDrop || 20; tol = tol || 0.2;
    const shifted = function (s) { return w.map(function (v) { return Math.min(400, Math.max(40, v - s)); }); };
    if (!decide(shifted(maxDrop))) return maxDrop;
    let lo = 0, hi = maxDrop;
    while (hi - lo > tol) {
      const mid = 0.5 * (lo + hi);
      if (decide(shifted(mid))) hi = mid; else lo = mid;
    }
    return hi;
  }

  /* ---------- decision-based attack in the spirit of HopSkipJump ---------- */
  function norm(v) { let s = 0; for (const a of v) s += a * a; return Math.sqrt(s); }
  function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(s); }

  function hsja(decide, x0, lower, upper, candidates, opts) {
    opts = opts || {};
    const rand = mulberry32(opts.seed || 7), nIter = opts.iterations || 12, nDirs = opts.directions || 40, d = x0.length;
    let queries = 0;
    const trace = [];
    const alert = function (z) { queries++; return decide(z); };
    const clip = function (z) { return z.map(function (v, i) { return Math.min(upper[i], Math.max(lower[i], v)); }); };
    const blend = function (b, t) { return x0.map(function (v, i) { return v + t * (b[i] - v); }); };
    let start = null, best = Infinity;
    for (const c0 of candidates) {
      const c = clip(c0);
      if (!alert(c)) { const dc = dist(c, x0); if (dc < best) { best = dc; start = c; } }
    }
    if (!start) return { success: false, queries: queries, trace: trace };
    const toBoundary = function (free) {
      let lo = 0, hi = 1;
      while (hi - lo > 1e-3) { const mid = 0.5 * (lo + hi); if (alert(blend(free, mid))) lo = mid; else hi = mid; }
      return blend(free, hi);
    };
    let xb = toBoundary(start);
    trace.push(xb.slice());
    for (let t = 1; t <= nIter; t++) {
      const dd = dist(xb, x0);
      if (dd < 1e-6) break;
      const radius = Math.max(0.1 * dd / Math.sqrt(t), 1e-3);
      const U = [], phi = [];
      for (let k = 0; k < nDirs; k++) {
        const u = [];
        for (let i = 0; i < d; i++) u.push(gaussian(rand));
        const nu = norm(u);
        for (let i = 0; i < d; i++) u[i] /= nu;
        U.push(u);
        phi.push(alert(clip(xb.map(function (v, i) { return v + radius * u[i]; }))) ? -1 : 1);
      }
      const mean = phi.reduce(function (a, b) { return a + b; }, 0) / nDirs;
      const v = new Array(d).fill(0);
      const varied = phi.some(function (p) { return p !== phi[0]; });
      for (let k = 0; k < nDirs; k++) {
        const c = varied ? phi[k] - mean : phi[0];
        for (let i = 0; i < d; i++) v[i] += (c * U[k][i]) / nDirs;
      }
      const nv = norm(v);
      if (nv < 1e-12) break;
      let step = dd / Math.sqrt(t);
      for (let h = 0; h < 12; h++) {
        const cand = clip(xb.map(function (a, i) { return a + (step * v[i]) / nv; }));
        if (!alert(cand)) { xb = toBoundary(cand); break; }
        step /= 2;
      }
      trace.push(xb.slice());
    }
    let linf = 0;
    for (let i = 0; i < d; i++) linf = Math.max(linf, Math.abs(xb[i] - x0[i]));
    return { success: true, x: xb, queries: queries, trace: trace, linf: linf, l2: dist(xb, x0) };
  }

  /* ---------- small statistics helpers ---------- */
  function ranks(a) {
    const idx = a.map(function (v, i) { return [v, i]; }).sort(function (p, q) { return p[0] - q[0]; });
    const r = new Array(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  }

  function spearman(a, b) {
    const ra = ranks(a), rb = ranks(b), n = a.length;
    const ma = ra.reduce(function (s, v) { return s + v; }, 0) / n, mb = rb.reduce(function (s, v) { return s + v; }, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }

  function ece(y, p, bins) {
    bins = bins || 10;
    let total = 0;
    for (let b = 0; b < bins; b++) {
      let n = 0, sy = 0, sp = 0;
      for (let i = 0; i < p.length; i++) {
        const k = Math.min(bins - 1, Math.floor(p[i] * bins));
        if (k === b) { n++; sy += y[i]; sp += p[i]; }
      }
      if (n) total += (n / p.length) * Math.abs(sy / n - sp / n);
    }
    return total;
  }

  return {
    mulberry32: mulberry32, gaussian: gaussian, treeValue: treeValue, rawScore: rawScore, proba: proba,
    exactShapley: exactShapley, coalitionGame: coalitionGame, permutations: permutations, lime: lime,
    ridge: ridge, counterfactual: counterfactual, cgmFeatures: cgmFeatures, marginLower: marginLower,
    hsja: hsja, spearman: spearman, ece: ece
  };
});
