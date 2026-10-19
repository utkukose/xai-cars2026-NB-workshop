/* Part 2 of the workshop site: the XAI toolkit on the gradient boosting model of NB2.
   Every number on the page is computed at run time from window.LAB_DATA. */
(function () {
  "use strict";
  const S = window.XAISite, X = window.XAICore, D = window.LAB_DATA;
  if (!S || !X || !D || !D.heart || !D.nb2) return;
  const H = D.heart, F = H.features, N2 = D.nb2, M = F.length, NLIME = 800;
  const add = S.add, store = S.store;
  const $ = function (id) { return document.getElementById(id); };
  const MINUS = "−", LE = "≤", GE = "≥";
  const KEY = F.map(function (ft) { return ft.key; });
  const J = {};
  KEY.forEach(function (k, j) { J[k] = j; });
  const SHORT = { resting_bp: "Blood pressure", cholesterol: "Cholesterol", fasting_glucose_high: "Fasting glucose", max_heart_rate: "Max heart rate",
    exercise_angina: "Exercise angina", st_depression: "ST depression", st_slope: "ST slope", major_vessels: "Vessel count" };
  const STATIONS = [null, "s-glass", "s-shap", "s-lime", "s-cf", "s-trust", "s-sanity"];
  const f = function (z) { return X.proba(H.model, z); };
  const risks = H.patients.map(f);

  /* ---------- formatting and small helpers ---------- */
  function short(j) { return SHORT[KEY[j]] || F[j].label; }
  function lower(j) { return short(j).toLowerCase().replace(/^st /, "ST ").replace(/ ecg/, " ECG"); }
  function num(v, d) { const s = Math.abs(v).toFixed(d); return (v < 0 && Number(s) !== 0 ? MINUS : "") + s; }
  function signed(v, d) { const s = Math.abs(v).toFixed(d); return (v < 0 && Number(s) !== 0 ? MINUS : "+") + s; }
  function valueText(j, v) {
    const ft = F[j];
    if (ft.type === "cat") {
      const o = ft.options.filter(function (op) { return op[0] === v; })[0];
      return o ? o[1] : String(v);
    }
    return v.toFixed(ft.step < 1 ? 1 : 0) + (ft.unit ? " " + ft.unit : "");
  }
  const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  function word(n, cap) {
    const w = n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
    return cap ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }
  function grouped(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function byAbs(w) { return w.map(function (v, j) { return j; }).sort(function (a, b) { return Math.abs(w[b]) - Math.abs(w[a]); }); }
  function key(x) { return x.join(","); }
  function auroc(y, p) {
    const idx = p.map(function (v, i) { return i; }).sort(function (a, b) { return p[a] - p[b]; });
    const r = new Array(p.length);
    for (let i = 0; i < idx.length;) {
      let k = i;
      while (k + 1 < idx.length && p[idx[k + 1]] === p[idx[i]]) k++;
      for (let q = i; q <= k; q++) r[idx[q]] = (i + k) / 2 + 1;
      i = k + 1;
    }
    let n1 = 0, sum = 0;
    y.forEach(function (v, i) { if (v === 1) { n1++; sum += r[i]; } });
    const n0 = y.length - n1;
    return n1 && n0 ? (sum - (n1 * (n1 + 1)) / 2) / (n1 * n0) : 0.5;
  }
  function niceTicks(lo, hi, n) {
    const raw = (hi - lo) / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= raw - 1e-12; })[0];
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+(Math.round(v / step) * step).toFixed(10));
    return out;
  }
  function decimalsOf(ticks) {
    for (let d = 0; d < 4; d++) {
      const k = Math.pow(10, d);
      if (ticks.every(function (t) { return Math.abs(t * k - Math.round(t * k)) < 1e-6; })) return d;
    }
    return 3;
  }
  function widthOf(node, def) { const w = node ? node.clientWidth : 0; return w >= 260 ? Math.round(w) : def; }
  function tween(ms, step) {
    return new Promise(function (resolve) {
      if (S.reduceMotion || !window.requestAnimationFrame) { step(1); resolve(); return; }
      const t0 = performance.now();
      function frame(t) {
        const k = Math.min(1, Math.max(0, (t - t0) / ms));
        step(1 - Math.pow(1 - k, 3));
        if (k < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }
  function axisX(s, xs, y, ticks, label, fmt) {
    add(s, "line", { x1: xs(ticks[0]), x2: xs(ticks[ticks.length - 1]), y1: y, y2: y, class: "axis" });
    ticks.forEach(function (v) {
      add(s, "line", { x1: xs(v), x2: xs(v), y1: y, y2: y + 4, class: "axis" });
      add(s, "text", { x: xs(v), y: y + 17, class: "tick", "text-anchor": "middle" }, fmt ? fmt(v) : String(v));
    });
    if (label) add(s, "text", { x: (xs(ticks[0]) + xs(ticks[ticks.length - 1])) / 2, y: y + 34, class: "axis-label", "text-anchor": "middle" }, label);
  }
  /* A horizontal legend that wraps; items are {label, kind, cls}. Returns the y of its last line. */
  function legend(s, items, x, y, maxX) {
    let cx = x, cy = y;
    items.forEach(function (it) {
      const w = 24 + it.label.length * 6.3;
      if (cx + w > maxX && cx > x) { cx = x; cy += 19; }
      if (it.kind === "bar") add(s, "rect", { x: cx, y: cy - 10, width: 14, height: 11, rx: 2, class: it.cls });
      else if (it.kind === "dot") add(s, "circle", { cx: cx + 7, cy: cy - 4, r: 5, class: it.cls + " head" });
      else if (it.kind === "ring") add(s, "circle", { cx: cx + 7, cy: cy - 4, r: 5.5, class: "ring" });
      else if (it.kind === "tick") add(s, "line", { x1: cx + 7, x2: cx + 7, y1: cy - 12, y2: cy + 2, class: "ghost" });
      else if (it.kind === "guide") add(s, "line", { x1: cx, x2: cx + 16, y1: cy - 4, y2: cy - 4, class: "guide" });
      else add(s, "line", { x1: cx, x2: cx + 16, y1: cy - 4, y2: cy - 4, class: "line " + it.cls + (it.kind === "dash" ? " dashed" : "") });
      add(s, "text", { x: cx + 21, y: cy, class: "tick" }, it.label);
      cx += w + 12;
    });
    const vb = (s.getAttribute("viewBox") || "").split(" ").map(Number);
    if (vb.length === 4 && cy + 8 > vb[3]) s.setAttribute("viewBox", "0 0 " + vb[2] + " " + (cy + 8));
    return cy;
  }

  /* ---------- the patient shared by every station ---------- */
  let pagePatient = 0, gap = Infinity;
  H.labels.forEach(function (l, i) { if (l === 1 && Math.abs(risks[i] - 0.75) < gap) { gap = Math.abs(risks[i] - 0.75); pagePatient = i; } });
  const state = { idx: pagePatient, x: H.patients[pagePatient].slice(), edited: false };
  const listeners = [], bars = [];
  function onPatient(fn) { listeners.push(fn); }
  function notify(kind) { listeners.forEach(function (fn) { fn(kind); }); }
  function currentRisk() { return f(state.x); }
  function patientName() { return "Test patient " + state.idx + (state.edited ? ", edited" : ""); }
  function setPatient(i) {
    state.idx = i;
    state.x = H.patients[i].slice();
    state.edited = false;
    syncBars();
    notify("patient");
  }
  function setValue(j, v, live) {
    if (live) pauseShap();
    state.x[j] = v;
    state.edited = state.x.some(function (val, k) { return val !== H.patients[state.idx][k]; });
    syncBars();
    notify(live ? "live" : "value");
  }
  function buildBar(host, n) {
    const id = "pt-" + n;
    host.className = "patient-bar";
    host.innerHTML = '<label for="' + id + '">Patient</label><select id="' + id + '"></select>' +
      '<span class="chip num" data-role="risk"></span>' +
      '<span class="chip edited" data-role="edited" hidden>Edited values</span>' +
      '<button class="btn" type="button" data-role="restore" hidden>Restore recorded values</button>';
    const sel = host.querySelector("select");
    H.patients.forEach(function (_, i) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = "Test patient " + i + ", " + (H.labels[i] ? "disease" : "no disease") + " on angiography" + (i === pagePatient ? " (NB2's choice)" : "");
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { setPatient(parseInt(sel.value, 10)); });
    host.querySelector('[data-role="restore"]').addEventListener("click", function () { setPatient(state.idx); });
    bars.push(host);
  }
  function syncBars() {
    const r = currentRisk();
    bars.forEach(function (host) {
      host.querySelector("select").value = String(state.idx);
      host.querySelector('[data-role="risk"]').textContent = "predicted risk " + r.toFixed(2);
      host.querySelector('[data-role="edited"]').hidden = !state.edited;
      host.querySelector('[data-role="restore"]').hidden = !state.edited;
    });
  }

  /* Exact Shapley values of the current patient, deferred so that a busy state can paint first. */
  const shap = { key: null, res: null, ms: 0, waiters: {}, timer: null, hooks: [], holdUntil: 0 };
  function withShap(tag, cb, delay) {
    if (shap.key === key(state.x)) { shap.hooks.forEach(function (h) { h(false); }); cb(shap.res); return; }
    shap.waiters[tag] = cb;
    shap.hooks.forEach(function (h) { h(true); });
    if (shap.timer) return;
    shap.timer = setTimeout(function run() {
      const wait = shap.holdUntil - Date.now();
      if (wait > 0) { shap.timer = setTimeout(run, wait); return; }
      shap.timer = null;
      const x = state.x.slice(), t0 = performance.now();
      const res = X.exactShapley(f, x, H.background);
      shap.key = key(x);
      shap.res = res;
      shap.ms = performance.now() - t0;
      const waiting = shap.waiters;
      shap.waiters = {};
      shap.hooks.forEach(function (h) { h(false); });
      Object.keys(waiting).forEach(function (t) { waiting[t](res); });
    }, delay || 50);
  }
  function cancelShap(tag) { delete shap.waiters[tag]; }
  function pauseShap() { if (shap.timer) { clearTimeout(shap.timer); shap.timer = null; } }

  /* ---------- cold open: the black box opens into the toolkit ---------- */
  const GROUPS = [
    { q: "Can the model itself be read?", w: "NB2, section 2", t: [
      ["LR", "Logistic regression", "Reads the model through one odds ratio per variable.", "NB2, section 2"],
      ["DT", "Decision tree", "Reads the model as three yes-or-no questions that end in a leaf.", "NB2, section 2", 1],
      ["GA", "GAM", "Reads the model as one smooth curve per variable, added on the log-odds scale.", "NB2, section 2", 1],
      ["EB", "EBM", "A GAM learned by boosting, with a few pairwise interactions.", "NB2, section 2"]] },
    { q: "What matters overall?", w: "NB2, section 3", t: [
      ["PI", "Permutation importance", "How much the test AUROC drops when one variable is shuffled.", "NB2, section 3"],
      ["SS", "SHAP summary", "Every test patient's Shapley values in one picture.", "NB2, section 3", 2],
      ["PD", "PDP", "The average predicted risk as one variable sweeps its range.", "NB2, section 3"],
      ["IC", "ICE", "The same sweep drawn as one curve per patient.", "NB2, section 3"],
      ["AL", "ALE", "Local effects within real data, safer than PDP when variables are correlated.", "NB2, section 3"],
      ["SA", "SAGE", "How much each variable reduces the model's loss: the Shapley value of the whole task.", "NB2, section 3"]] },
    { q: "Why this prediction?", w: "NB2, section 4", t: [
      ["SH", "SHAP waterfall", "One patient's risk split exactly into a share per variable.", "NB2, section 4", 2],
      ["LI", "LIME", "A weighted linear model fitted to random perturbations around one patient.", "NB2, section 4", 3],
      ["MA", "MAPLE", "A local linear model on the training patients that a random forest finds similar.", "NB2, section 4"],
      ["IG", "Integrated gradients", "Gradients of a neural network summed along a path from the average patient.", "NB2, section 4"],
      ["OC", "Occlusion", "The drop in risk when one variable at a time is replaced by reference values.", "NB2, section 7"]] },
    { q: "What would change it?", w: "NB2, section 5", t: [
      ["CF", "Counterfactual", "The smallest plausible change that flips the decision.", "NB2, section 5", 4],
      ["AN", "Anchors", "An IF-THEN rule that keeps the prediction in place, with its precision and coverage.", "NB2, section 5"],
      ["GS", "Global surrogate", "A shallow tree that imitates the black box, with its fidelity.", "NB2, section 5"]] },
    { q: "What does the geometry say?", w: "NB2, section 6", t: [
      ["GX", "GEMEX", "Geodesic sensitivity of the output along the shortest path on the model's statistical manifold.", "NB2, section 6"]] },
    { q: "Can it be trusted?", w: "NB2, section 7; NB3, section 4", t: [
      ["DL", "Deletion test", "Removes the top-ranked variables first; a faithful explanation makes the risk fall fastest.", "NB2, section 7", 5],
      ["MO", "Monotonicity", "Do larger attributions go with larger effects of removing a variable?", "NB2, section 7"],
      ["ST", "Stability", "How far the explanation moves after a tiny change of the patient.", "NB2, section 7"],
      ["DA", "Disagreement", "Rank agreement between methods that explain the same patient.", "NB2, section 7", 3],
      ["SC", "Sanity check", "Randomise the model and see whether the explanation changes.", "NB3, section 4", 6]] },
    { q: "Images", w: "NB3, sections 3 to 6", t: [
      ["GC", "Grad-CAM", "Last convolutional feature maps weighted by the gradient of the class score.", "NB3, section 3"],
      ["GR", "Gradient", "How sensitive the class score is to each pixel.", "NB3, section 3"],
      ["SM", "SmoothGrad", "Gradients averaged over noisy copies of the X-ray.", "NB3, section 3"],
      ["IG", "Integrated gradients", "Gradients accumulated along a path from a black image to the X-ray.", "NB3, section 3"],
      ["OC", "Occlusion", "The drop in probability when each patch of the image is covered with grey.", "NB3, section 3"],
      ["FG", "FGSM", "An invisible perturbation that flips both the prediction and its heat map.", "NB3, section 6"]] }
  ];

  function initColdOpen() {
    const table = $("ptable"), info = $("tile-info");
    let count = 0, opened = false;
    GROUPS.forEach(function (g, gi) {
      const col = S.el("div", { class: "pgroup g" + (gi + 1), role: "group", "aria-label": g.q });
      col.appendChild(S.el("div", { class: "phead", "data-d": String(gi * 110) }, g.q + "<span>" + g.w + "</span>"));
      g.t.forEach(function (t, ti) {
        count += 1;
        const b = S.el("button", { type: "button", class: "tile", "aria-pressed": "false", "data-d": String(gi * 110 + 90 + ti * 60),
          "aria-label": t[1] + (t[4] ? ", live on this page" : "") },
          '<span class="no">' + count + "</span>" + (t[4] ? '<span class="live" aria-hidden="true"></span>' : "") +
          '<span class="sym">' + t[0] + '</span><span class="nm">' + t[1] + "</span>");
        b.addEventListener("click", function () {
          table.querySelectorAll(".tile").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
          info.innerHTML = "<strong>" + t[1] + ".</strong> " + t[2] + ' <span class="where">' + t[3] +
            (t[4] ? ' · <a href="#' + STATIONS[t[4]] + '">On this page, station ' + t[4] + "</a>" : "") + "</span>";
        });
        col.appendChild(b);
      });
      table.appendChild(col);
    });
    $("tile-count").textContent = count + " tools from NB2 and NB3, grouped by the question each one answers";
    info.textContent = "Select a tile to see what it answers and where to find it.";

    const r0 = risks[pagePatient];
    $("bb-sub").textContent = "Test patient " + pagePatient;
    $("box-note").textContent = "Gradient boosting with " + H.model.trees.length + " trees, test AUROC " + auroc(H.labels, risks).toFixed(3) +
      ". It reads " + M + " clinical variables and returns one number.";
    $("bb-risk").textContent = r0.toFixed(2);
    S.countUp($("bb-risk"), r0, { decimals: 2, ms: 1500 });

    /* The tiles fly out of the box to their places, one group after the other. */
    function openBox(animate) {
      if (opened) return;
      opened = true;
      const box = $("blackbox"), kit = $("toolkit"), rb = box.getBoundingClientRect();
      const cx = rb.left + rb.width / 2, cy = rb.top + rb.height / 2;
      const show = function () {
        $("box-row").hidden = true;
        kit.hidden = false;
        $("begin").classList.add("primary");
        if (animate && !S.reduceMotion) {
          const parts = Array.prototype.slice.call(kit.querySelectorAll(".tile, .phead"));
          parts.forEach(function (t) {
            const r = t.getBoundingClientRect();
            t.style.transition = "none";
            t.style.opacity = "0";
            t.style.transform = "translate(" + (cx - r.left - r.width / 2) + "px," + (cy - r.top - r.height / 2) + "px) scale(0.25)";
          });
          void kit.offsetWidth;
          parts.forEach(function (t) {
            const d = t.getAttribute("data-d") || "0";
            t.style.transition = "transform 0.75s cubic-bezier(0.2, 0.8, 0.2, 1) " + d + "ms, opacity 0.3s ease " + d + "ms";
            t.style.opacity = "";
            t.style.transform = "";
          });
          setTimeout(function () { parts.forEach(function (t) { t.style.transition = ""; }); }, 2000);
        }
        if (animate) $("tile-count").focus({ preventScroll: true });
      };
      if (animate && !S.reduceMotion) {
        shap.holdUntil = Date.now() + 2600;
        box.classList.add("opening");
        setTimeout(show, 300);
      } else show();
    }
    $("open-box").addEventListener("click", function () { openBox(true); });
    $("begin").addEventListener("click", function () {
      if (!opened) { openBox(true); return; }
      $("s-glass").scrollIntoView({ behavior: S.reduceMotion ? "auto" : "smooth", block: "start" });
    });
  }

  /* ---------- station 1: glass boxes ---------- */
  const TREE = N2.tree;
  function branchText(j, t, left) {
    const ft = F[j];
    if (ft.type === "num") {
      const s = ft.step, lo = Math.floor(t / s + 1e-9) * s, d = s < 1 ? 1 : 0, u = ft.unit ? " " + ft.unit : "";
      return left ? LE + " " + lo.toFixed(d) + u : GE + " " + (lo + s).toFixed(d) + u;
    }
    const side = ft.options.filter(function (o) { return left ? o[0] <= t : o[0] > t; });
    const other = ft.options.filter(function (o) { return left ? o[0] > t : o[0] <= t; });
    if (side.every(function (o) { return /^\d+$/.test(o[1]); })) return side.length === 1 ? side[0][1] : side[0][1] + " to " + side[side.length - 1][1];
    if (side.length === 1) return side[0][1];
    if (side.length === 2) return side[0][1] + " or " + side[1][1];
    return other.length === 1 ? "not " + other[0][1] : side.map(function (o) { return o[1]; }).join(", ");
  }
  function treeRoute(x) {
    let n = 0;
    const path = [0];
    while (TREE[n].f !== null) {
      n = Math.fround(x[J[TREE[n].f]]) <= TREE[n].t ? TREE[n].l : TREE[n].r;
      path.push(n);
    }
    return path;
  }
  function treeLayout() {
    const pos = {};
    let slot = 0, depth = 0;
    (function walk(n, d) {
      depth = Math.max(depth, d);
      if (TREE[n].f === null) { pos[n] = { x: slot++, d: d }; return; }
      walk(TREE[n].l, d + 1);
      walk(TREE[n].r, d + 1);
      pos[n] = { x: (pos[TREE[n].l].x + pos[TREE[n].r].x) / 2, d: d };
    })(0, 0);
    return { pos: pos, leaves: slot, depth: depth };
  }

  function initGlass() {
    const G = N2.glassbox;
    const black = G.filter(function (m) { return m.kind === "black box"; })[0];
    const glass = G.filter(function (m) { return m !== black; });
    const order = G.map(function (m, i) { return i; }).sort(function (a, b) { return G[b].auroc - G[a].auroc; });
    const rankOf = [];
    order.forEach(function (i, r) { rankOf[i] = r; });
    const race = { grow: 0, move: 0, done: false };

    function drawRace() {
      const host = $("race"), W = widthOf(host, 660), stacked = W < 520, n = G.length;
      const rowH = stacked ? 46 : 34, top = 6, labelW = stacked ? 0 : Math.min(240, W * 0.36);
      const x0 = stacked ? 14 : labelW + 14, x1 = W - 58, base = top + n * rowH;
      const s = S.svgRoot(host, W, base + 64, "Test AUROC of four glass-box models and the black-box gradient boosting model");
      const xs = function (v) { return x0 + ((Math.max(0.5, v) - 0.5) / 0.5) * (x1 - x0); };
      [0.5, 0.6, 0.7, 0.8, 0.9, 1].forEach(function (t) { add(s, "line", { x1: xs(t), x2: xs(t), y1: top, y2: base, class: "gridline" }); });
      axisX(s, xs, base, [0.5, 0.6, 0.7, 0.8, 0.9, 1], "test AUROC (0.5 is chance)", function (v) { return v.toFixed(1); });
      if (race.grow >= 1) add(s, "line", { x1: xs(black.auroc), x2: xs(black.auroc), y1: top, y2: base, class: "guide" });
      G.forEach(function (m, i) {
        const y = top + (i + (rankOf[i] - i) * race.move) * rowH, isBlack = m === black;
        const by = stacked ? y + 20 : y + 7, bh = stacked ? 18 : 20, v = 0.5 + (m.auroc - 0.5) * race.grow;
        if (stacked) add(s, "text", { x: x0, y: y + 14, class: isBlack ? "strong" : "" }, m.name);
        else add(s, "text", { x: labelW, y: y + 21, "text-anchor": "end", class: isBlack ? "strong" : "" }, m.name);
        if (race.grow > 0) {
          add(s, "rect", { x: x0, y: by, width: Math.max(1, xs(v) - x0), height: bh, rx: 3, class: isBlack ? "f-ink" : "f-violet" });
          add(s, "text", { x: W - 4, y: by + bh - 5, "text-anchor": "end", class: "val strong" }, v.toFixed(3));
        }
      });
      legend(s, [{ label: "glass box", kind: "bar", cls: "f-violet" }, { label: "black box", kind: "bar", cls: "f-ink" }], x0, base + 58, W);
    }
    function raceNote(answer) {
      const better = glass.filter(function (m) { return m.auroc > black.auroc; }), best = G[order[0]];
      const bestGlass = glass.slice().sort(function (a, b) { return b.auroc - a.auroc; })[0];
      const outcome = Math.abs(bestGlass.auroc - black.auroc) < 0.005 ? "tie" : bestGlass.auroc > black.auroc ? "glass-box" : "black-box";
      $("race-note").textContent = (answer ? (answer === outcome ? "Right. " : "Not on this data. ") : "") +
        word(better.length, true) + " of the " + word(glass.length) + " glass boxes score higher than the black box (" + black.auroc.toFixed(3) +
        "). Best: " + best.name + ", " + best.auroc.toFixed(3) + ".";
    }
    let restoring = true, answer = null;
    S.poll($("poll-winner"), "p2-winner", function (value) {
      answer = value;
      if (race.done || restoring) {
        race.grow = 1; race.move = 1; race.done = true;
        drawRace(); raceNote(answer); S.reveal(document.querySelector("#s-glass .takeaway"));
        return;
      }
      race.done = true;
      tween(1100, function (k) { race.grow = k; drawRace(); })
        .then(function () { return S.wait(250); })
        .then(function () { return tween(700, function (k) { race.move = k; drawRace(); }); })
        .then(function () { raceNote(answer); S.reveal(document.querySelector("#s-glass .takeaway")); });
    });
    restoring = false;
    if (!race.done) $("race-note").textContent = "Answer the poll to start the race.";
    drawRace();

    /* the depth-3 tree with the route of the current patient */
    function drawTree() {
      const host = $("tree"), lay = treeLayout(), W = Math.max(540, widthOf(host, 600) - 2), top = 8, rowGap = 84, boxW = 138, boxH = 40, leafW = Math.min(76, (W - 16) / lay.leaves - 8), leafH = 50;
      const slotW = (W - 16) / lay.leaves;
      const cx = function (n) { return 8 + (lay.pos[n].x + 0.5) * slotW; };
      const cy = function (n) { return TREE[n].f === null ? top + lay.depth * rowGap : top + lay.pos[n].d * rowGap; };
      const s = S.svgRoot(host, W, top + lay.depth * rowGap + leafH + 10, "Decision tree of depth 3 with the route of " + patientName());
      const on = {};
      treeRoute(state.x).forEach(function (n) { on[n] = true; });
      TREE.forEach(function (nd, n) {
        if (nd.f === null) return;
        [nd.l, nd.r].forEach(function (c, side) {
          const x1 = cx(n), y1 = cy(n) + boxH, x2 = cx(c), y2 = cy(c), midY = (y1 + y2) / 2;
          add(s, "path", { d: "M" + x1 + " " + y1 + " C" + x1 + " " + midY + " " + x2 + " " + midY + " " + x2 + " " + y2, class: "edge" + (on[n] && on[c] ? " on" : "") });
          add(s, "text", { x: (x1 + x2) / 2, y: midY + 4, "text-anchor": "middle", class: "tick halo" + (on[n] && on[c] ? " strong" : "") }, side ? "yes" : "no");
        });
      });
      TREE.forEach(function (nd, n) {
        const x = cx(n), y = cy(n);
        if (nd.f !== null) {
          const j = J[nd.f];
          add(s, "rect", { x: x - boxW / 2, y: y, width: boxW, height: boxH, rx: 7, class: "node" + (on[n] ? " on" : "") });
          add(s, "text", { x: x, y: y + 16, "text-anchor": "middle", class: "strong" }, short(j));
          add(s, "text", { x: x, y: y + 32, "text-anchor": "middle", class: "tick" }, branchText(j, nd.t, false) + "?");
        } else {
          add(s, "rect", { x: x - leafW / 2, y: y, width: leafW, height: leafH, rx: 7, class: (nd.p >= 0.5 ? "leaf-hi" : "leaf-lo") + (on[n] ? " on" : "") });
          add(s, "text", { x: x, y: y + 23, "text-anchor": "middle", class: "strong val", style: "font-size:17px" }, Math.round(nd.p * 100) + "%");
          add(s, "text", { x: x, y: y + 40, "text-anchor": "middle", class: "tick" }, "of " + nd.n);
        }
      });
      const path = treeRoute(state.x), leaf = TREE[path[path.length - 1]];
      if (host.clientWidth && host.scrollWidth > host.clientWidth + 4) {
        const scale = host.scrollWidth / W;
        host.scrollLeft = Math.max(0, cx(path[path.length - 1]) * scale - host.clientWidth / 2);
      }
      const steps = path.slice(0, -1).map(function (n, k) {
        const j = J[TREE[n].f];
        return lower(j) + " " + branchText(j, TREE[n].t, path[k + 1] === TREE[n].l);
      });
      $("tree-note").textContent = patientName() + ": " + steps.join(", ") + ". In that leaf " + Math.round(leaf.p * leaf.n) + " of " + leaf.n +
        " training patients had disease, so the tree predicts " + (leaf.p >= 0.5 ? "disease." : "no disease.");
    }

    /* GAM shape functions with the current patient's value */
    const GK = Object.keys(N2.gam);
    let gk = GK[0];
    const pills = $("gam-pills");
    GK.forEach(function (k) {
      const b = S.el("button", { type: "button", "aria-pressed": String(k === gk) }, short(J[k]));
      b.addEventListener("click", function () {
        gk = k;
        pills.querySelectorAll("button").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        drawGam();
      });
      pills.appendChild(b);
    });
    let ylo = 0, yhi = 0;
    GK.forEach(function (k) { N2.gam[k].y.forEach(function (v) { ylo = Math.min(ylo, v); yhi = Math.max(yhi, v); }); });
    ylo = Math.floor(ylo * 10) / 10;
    yhi = Math.ceil(yhi * 10) / 10;
    function drawGam() {
      const host = $("gam"), W = widthOf(host, 480), Hh = 280, m = { l: 46, r: 16, t: 28, b: 46 };
      const c = N2.gam[gk], j = J[gk], ft = F[j], xlo = c.x[0], xhi = c.x[c.x.length - 1];
      const xs = function (v) { return m.l + ((v - xlo) / (xhi - xlo)) * (W - m.l - m.r); };
      const ys = function (v) { return Hh - m.b - ((v - ylo) / (yhi - ylo)) * (Hh - m.t - m.b); };
      const s = S.svgRoot(host, W, Hh, "GAM shape function for " + ft.label);
      const yt = niceTicks(ylo, yhi, 4);
      yt.forEach(function (v) {
        add(s, "line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), class: v === 0 ? "axis" : "gridline" });
        add(s, "text", { x: m.l - 6, y: ys(v) + 4, class: "tick", "text-anchor": "end" }, num(v, decimalsOf(yt)));
      });
      add(s, "text", { x: m.l - 40, y: 14, class: "axis-label" }, "contribution to the log-odds of disease");
      const xt = niceTicks(xlo, xhi, W < 420 ? 4 : 6).filter(function (v) { return v >= xlo - 1e-9 && v <= xhi + 1e-9; });
      axisX(s, xs, Hh - m.b, xt, ft.label + (ft.unit ? " (" + ft.unit + ")" : ""), function (v) { return num(v, decimalsOf(xt)); });
      add(s, "polyline", { points: c.x.map(function (v, k) { return xs(v).toFixed(1) + "," + ys(c.y[k]).toFixed(1); }).join(" "), class: "line s-violet" });
      const v = state.x[j], vc = Math.min(xhi, Math.max(xlo, v));
      let k = 0;
      while (k < c.x.length - 2 && c.x[k + 1] < vc) k++;
      const t = c.x[k + 1] === c.x[k] ? 0 : (vc - c.x[k]) / (c.x[k + 1] - c.x[k]), yv = c.y[k] + t * (c.y[k + 1] - c.y[k]);
      add(s, "line", { x1: xs(vc), x2: xs(vc), y1: m.t, y2: Hh - m.b, class: "guide" });
      add(s, "circle", { cx: xs(vc), cy: ys(yv), r: 6.5, class: "f-violet head" });
      const right = xs(vc) < W * 0.6;
      add(s, "text", { x: xs(vc) + (right ? 12 : -12), y: ys(yv) + (yv > (ylo + yhi) / 2 ? 20 : -12), "text-anchor": right ? "start" : "end", class: "strong halo" },
        valueText(j, v) + ", " + signed(yv, 2));
      $("gam-note").textContent = patientName() + ": " + lower(j) + " " + valueText(j, v) + " adds " + signed(yv, 2) +
        " to the log-odds of disease" + (v !== vc ? ", read at the edge of the plotted 2nd to 98th percentile." : ".") + " The curve is the whole story for this variable.";
    }

    onPatient(function () { drawTree(); drawGam(); });
    drawTree();
    drawGam();
    return function redraw() { drawRace(); drawTree(); drawGam(); };
  }

  /* ---------- station 2: exact SHAP waterfall, what-if sliders and the test-set strip plot ---------- */
  function initShap() {
    const box = $("whatif"), sliders = [], wf = $("waterfall"), status = $("status-2");
    ["resting_bp", "max_heart_rate", "st_depression"].forEach(function (k) {
      const j = J[k], ft = F[j], id = "wi-" + k;
      const wrap = S.el("div", {}, '<label class="control" for="' + id + '"><span>' + short(j) + '</span><output id="' + id + '-out"></output></label>' +
        '<input type="range" id="' + id + '" min="' + ft.min + '" max="' + ft.max + '" step="' + ft.step + '">');
      box.appendChild(wrap);
      const input = wrap.querySelector("input"), out = wrap.querySelector("output");
      input.addEventListener("input", function () { out.textContent = valueText(j, parseFloat(input.value)); setValue(j, parseFloat(input.value), true); });
      input.addEventListener("change", function () { setValue(j, parseFloat(input.value), false); });
      sliders.push({ j: j, input: input, out: out });
    });
    function syncSliders() { sliders.forEach(function (s) { s.input.value = String(state.x[s.j]); s.out.textContent = valueText(s.j, state.x[s.j]); }); }
    function drawRisk() {
      const r = currentRisk(), el = $("risk-2");
      el.textContent = r.toFixed(2);
      el.className = "big " + (r >= 0.5 ? "hi" : "lo");
      $("risk-2-label").textContent = "predicted risk of disease, " + (r >= 0.5 ? "above" : "below") + " the 0.50 threshold";
    }
    const nEval = (1 << M) * H.background.length;
    shap.hooks.push(function (busy) {
      wf.classList.toggle("busy", busy);
      status.className = "status" + (busy ? " on" : "");
      status.textContent = busy ? "Computing exact Shapley values: " + grouped(1 << M) + " coalitions, " + H.background.length + " reference patients" :
        "Exact Shapley values from " + grouped(nEval) + " model evaluations, computed in this browser in " + (shap.ms / 1000).toFixed(2) + " s.";
    });
    let last = null;
    function drawWaterfall(sh) {
      last = sh;
      const W = widthOf(wf, 600), stacked = W < 500, order = byAbs(sh.phi), K = 8;
      const rows = order.slice(0, K).map(function (j) { return { label: short(j) + " = " + valueText(j, state.x[j]), v: sh.phi[j] }; });
      rows.push({ label: "Other " + (M - K) + " variables", v: order.slice(K).reduce(function (a, j) { return a + sh.phi[j]; }, 0), other: true });
      let cum = sh.base, lo = sh.base, hi = sh.base;
      rows.forEach(function (r) { r.a = cum; cum += r.v; r.b = cum; lo = Math.min(lo, r.a, r.b); hi = Math.max(hi, r.a, r.b); });
      lo = Math.max(0, lo - 0.03); hi = Math.min(1, hi + 0.03);
      const rowH = stacked ? 40 : 27, labelW = stacked ? 0 : Math.min(280, Math.round(W * 0.43)), top = 6, n = rows.length + 2;
      const x0 = stacked ? 6 : labelW + 12, x1 = W - 62, Hh = top + n * rowH + 64;
      const s = S.svgRoot(wf, W, Hh, "SHAP waterfall for " + patientName());
      const xs = function (v) { return x0 + ((v - lo) / (hi - lo)) * (x1 - x0); };
      const ticks = niceTicks(lo, hi, stacked ? 3 : 5);
      ticks.forEach(function (t) { add(s, "line", { x1: xs(t), x2: xs(t), y1: top, y2: top + n * rowH, class: "gridline" }); });
      const bh = stacked ? 15 : 17, by = function (i) { return top + i * rowH + (stacked ? 20 : (rowH - bh) / 2); };
      function label(i, text, cls) {
        if (stacked) add(s, "text", { x: x0, y: top + i * rowH + 14, class: cls || "" }, text);
        else add(s, "text", { x: labelW, y: by(i) + bh / 2 + 4.5, "text-anchor": "end", class: cls || "" }, text);
      }
      function value(i, text, cls) { add(s, "text", { x: W - 4, y: by(i) + bh / 2 + 4.5, "text-anchor": "end", class: "val " + (cls || "") }, text); }
      label(0, "Average of the reference patients", "muted");
      add(s, "line", { x1: xs(sh.base), x2: xs(sh.base), y1: by(0) + bh / 2, y2: by(1), class: "connector" });
      add(s, "circle", { cx: xs(sh.base), cy: by(0) + bh / 2, r: 5, class: "f-ink head" });
      value(0, sh.base.toFixed(3));
      rows.forEach(function (r, k) {
        const i = k + 1;
        label(i, r.label, r.other ? "muted" : "");
        add(s, "line", { x1: xs(r.b), x2: xs(r.b), y1: by(i) + bh, y2: by(i + 1), class: "connector" });
        add(s, "rect", { x: xs(Math.min(r.a, r.b)), y: by(i), width: Math.max(2, Math.abs(xs(r.b) - xs(r.a))), height: bh, rx: 3, class: r.v >= 0 ? "f-alert" : "f-safe" });
        value(i, signed(r.v, 3));
      });
      const e = rows.length + 1;
      label(e, "This patient", "strong");
      add(s, "circle", { cx: xs(sh.full), cy: by(e) + bh / 2, r: 7, class: (sh.full >= 0.5 ? "f-alert" : "f-safe") + " head" });
      value(e, sh.full.toFixed(3), "strong");
      axisX(s, xs, top + n * rowH + 2, ticks, "predicted risk", function (v) { return v.toFixed(decimalsOf(ticks)); });
      legend(s, [{ label: "raises the risk", kind: "bar", cls: "f-alert" }, { label: "lowers the risk", kind: "bar", cls: "f-safe" }], x0, Hh - 6, W);
      const sum = sh.phi.reduce(function (a, v) { return a + v; }, 0);
      $("sum-check").textContent = sh.base.toFixed(3) + " " + (sum < 0 ? MINUS : "+") + " " + Math.abs(sum).toFixed(3) + " (all " + M +
        " contributions) = " + (sh.base + sum).toFixed(3) + ", and the model gives " + currentRisk().toFixed(3) + ".";
    }

    /* the strip plot of NB2's SHAP values for the test patients */
    const SV = N2.shap_test.values, Z = N2.shap_test.z;
    const meanAbs = F.map(function (_, j) { return SV.reduce(function (a, r) { return a + Math.abs(r[j]); }, 0) / SV.length; });
    const fo = F.map(function (_, j) { return j; }).sort(function (a, b) { return meanAbs[b] - meanAbs[a]; });
    const rj = X.mulberry32(7), jit = SV.map(function () { return F.map(function () { return rj() * 2 - 1; }); });
    let slo = 0, shi = 0;
    SV.forEach(function (r) { r.forEach(function (v) { slo = Math.min(slo, v); shi = Math.max(shi, v); }); });
    function zClass(z) { return z <= -1 ? "zn2" : z <= -0.33 ? "zn1" : z < 0.33 ? "z0" : z < 1 ? "zp1" : "zp2"; }
    function drawSwarm() {
      const host = $("swarm"), W = widthOf(host, 440), labelW = 132, rowH = 25, top = 4, x0 = labelW + 12, x1 = W - 10;
      const plotB = top + M * rowH, Hh = plotB + 82;
      const ticks = niceTicks(slo, shi, W < 400 ? 3 : 4), lo = Math.min(slo, ticks[0]), hi = Math.max(shi, ticks[ticks.length - 1]);
      const xs = function (v) { return x0 + ((v - lo) / (hi - lo)) * (x1 - x0); };
      const s = S.svgRoot(host, W, Hh, "SHAP values of the " + SV.length + " test patients, one row per variable");
      ticks.forEach(function (t) { add(s, "line", { x1: xs(t), x2: xs(t), y1: top, y2: plotB, class: t === 0 ? "axis" : "gridline" }); });
      const ring = !state.edited ? state.idx : -1;
      fo.forEach(function (j, r) {
        const yc = top + r * rowH + rowH / 2;
        add(s, "text", { x: labelW, y: yc + 4.5, "text-anchor": "end" }, short(j));
        SV.forEach(function (row, i) {
          if (i !== ring) add(s, "circle", { cx: xs(row[j]).toFixed(1), cy: (yc + jit[i][j] * 8).toFixed(1), r: 3.4, class: "dot " + zClass(Z[i][j]) });
        });
        if (ring >= 0) {
          const cx = xs(SV[ring][j]), cy = yc + jit[ring][j] * 8;
          add(s, "circle", { cx: cx, cy: cy, r: 4, class: "dot " + zClass(Z[ring][j]) });
          add(s, "circle", { cx: cx, cy: cy, r: 7, class: "ring" });
        }
      });
      axisX(s, xs, plotB + 2, ticks, "SHAP value: effect on the predicted risk", function (v) { return num(v, decimalsOf(ticks)); });
      const ly = plotB + 64;
      add(s, "text", { x: x0 - 8, y: ly, "text-anchor": "end", class: "tick" }, "variable value: low");
      ["zn2", "zn1", "z0", "zp1", "zp2"].forEach(function (c, k) { add(s, "circle", { cx: x0 + 7 + k * 17, cy: ly - 4, r: 6, class: "dot " + c }); });
      add(s, "text", { x: x0 + 92, y: ly, class: "tick" }, "high");
      if (ring >= 0) {
        add(s, "circle", { cx: x0 + 146, cy: ly - 4, r: 6, class: "ring" });
        add(s, "text", { x: x0 + 158, y: ly, class: "tick" }, "test patient " + state.idx);
      }
      $("swarm-note").textContent = ring >= 0 ? "NB2 computes these values with TreeSHAP against 100 training patients, so they differ slightly from the exact values on the left." :
        "Edited values are not part of the NB2 test set, so no dots are outlined.";
    }

    let ringShown = null, acted = false;
    function refresh(kind, first) {
      drawRisk();
      if (kind !== "live") syncSliders();
      const ring = state.edited ? -1 : state.idx;
      if (ring !== ringShown) { ringShown = ring; drawSwarm(); }
      if (!first) acted = true;
      if (kind === "live") {
        wf.classList.add("busy");
        status.className = "status";
        status.textContent = "Release the slider to recompute the exact Shapley values.";
        return;
      }
      withShap("waterfall", function (sh) {
        drawWaterfall(sh);
        if (acted) S.reveal(document.querySelector("#s-shap .takeaway"));
      }, first ? 1700 : 50);
    }
    onPatient(function (kind) { refresh(kind, false); });
    refresh("patient", true);
    return function redraw() { if (last && shap.key === key(state.x)) drawWaterfall(last); drawSwarm(); };
  }

  /* ---------- station 3: LIME, run after run ---------- */
  const limeState = { key: null, w: null, seed: 0 };
  function initLime() {
    let seed = 0, order = null, prevW = null, prevTop = null, history = [], rho = null, overlap = null;
    const total = { runs: 0, minOverlap: null }, takeaway = document.querySelector("#s-lime .takeaway");
    S.poll($("poll-lime"), "p2-lime");
    function top5(w) { return byAbs(w).slice(0, 5); }
    function reset() {
      order = null; prevW = null; prevTop = null; history = []; rho = null; overlap = null;
      limeState.key = null; limeState.w = null;
      draw();
    }
    function run() {
      seed += 1;
      const w = X.lime(f, state.x.slice(), H.pool, seed, NLIME), t = top5(w);
      if (!order) order = byAbs(w);
      overlap = prevTop ? t.filter(function (j) { return prevTop.indexOf(j) >= 0; }).length : null;
      if (overlap !== null) {
        history.push(overlap);
        total.minOverlap = total.minOverlap === null ? overlap : Math.min(total.minOverlap, overlap);
      }
      prevW = limeState.key === key(state.x) ? limeState.w : null;
      prevTop = t;
      limeState.key = key(state.x); limeState.w = w; limeState.seed = seed;
      total.runs += 1;
      store.set("p2:lime", { runs: total.runs, minOverlap: total.minOverlap });
      rho = null;
      draw();
      withShap("lime", function (sh) {
        if (limeState.key !== key(state.x)) return;
        rho = X.spearman(limeState.w.map(Math.abs), sh.phi.map(Math.abs));
        drawStats();
      });
      if (history.length) S.reveal(takeaway);
    }
    $("lime-run").addEventListener("click", run);
    function drawBars() {
      const host = $("lime-chart"), W = widthOf(host, 520), w = limeState.w;
      if (!w || !order) {
        const s0 = S.svgRoot(host, W, 120, "LIME weights, not yet computed");
        add(s0, "text", { x: W / 2, y: 64, "text-anchor": "middle", class: "muted" }, "Press Run LIME to explain " + patientName().toLowerCase() + ".");
        return;
      }
      const rowH = 23, labelW = Math.min(170, Math.round(W * 0.36)), top = 6, x0 = labelW + 10, x1 = W - 62, Hh = top + M * rowH + 30;
      const all = w.concat(prevW || []), mx = Math.max(1e-9, Math.max.apply(null, all.map(Math.abs)));
      const mid = (x0 + x1) / 2, half = (x1 - x0) / 2 - 4, xs = function (v) { return mid + (v / mx) * half; };
      const s = S.svgRoot(host, W, Hh, "LIME weights of run " + limeState.seed);
      add(s, "line", { x1: mid, x2: mid, y1: top, y2: top + M * rowH, class: "axis" });
      const t = top5(w);
      order.forEach(function (j, r) {
        const y = top + r * rowH, v = w[j], isTop = t.indexOf(j) >= 0;
        add(s, "text", { x: labelW, y: y + 16, "text-anchor": "end", class: isTop ? "strong" : "muted" }, short(j));
        add(s, "rect", { x: Math.min(mid, xs(v)), y: y + 5, width: Math.max(1.5, Math.abs(xs(v) - mid)), height: rowH - 9, rx: 3, class: v >= 0 ? "f-alert" : "f-safe" });
        if (prevW) add(s, "line", { x1: xs(prevW[j]), x2: xs(prevW[j]), y1: y + 2, y2: y + rowH - 1, class: "ghost" });
        add(s, "text", { x: W - 4, y: y + 16, "text-anchor": "end", class: "val" + (isTop ? " strong" : "") }, signed(v, 3));
      });
      add(s, "text", { x: mid - 6, y: Hh - 8, "text-anchor": "end", class: "tick" }, "lowers the risk");
      add(s, "text", { x: mid + 6, y: Hh - 8, class: "tick" }, "raises the risk");
    }
    function drawStats() {
      const runs = history.length + (limeState.w ? 1 : 0), mn = history.length ? Math.min.apply(null, history) : null;
      const stat = function (v, l, tone) { return '<div class="stat' + (tone ? " " + tone : "") + '"><span class="v' + (String(v).length > 6 ? " small" : "") + '">' + v + '</span><span class="l">' + l + "</span></div>"; };
      $("lime-stats").innerHTML = stat(overlap === null ? (runs ? "first" : "none") : overlap + " of 5", "top-five variables shared with the previous run", overlap !== null && overlap < 5 ? "amber" : "violet") +
        stat(rho === null ? (runs ? "..." : "none") : rho.toFixed(2), "rank agreement with exact SHAP (Spearman)", "violet") +
        stat(runs, runs && mn !== null ? "runs on this patient, lowest overlap " + mn + " of 5" : "runs on this patient", "");
      $("lime-seed").textContent = runs ? "Seed " + limeState.seed + ", " + NLIME + " samples" : "";
    }
    function drawHistory() {
      const host = $("lime-history"), W = widthOf(host, 420), Hh = 168, m = { l: 34, r: 14, t: 12, b: 40 };
      const shown = history.slice(-24), n0 = history.length - shown.length;
      const s = S.svgRoot(host, W, Hh, "Top-five overlap between consecutive LIME runs");
      const slots = Math.max(8, shown.length), xs = function (k) { return m.l + 10 + (k / Math.max(1, slots - 1)) * (W - m.l - m.r - 20); };
      const ys = function (v) { return Hh - m.b - (v / 5) * (Hh - m.t - m.b); };
      [0, 1, 2, 3, 4, 5].forEach(function (v) {
        add(s, "line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), class: "gridline" });
        add(s, "text", { x: m.l - 8, y: ys(v) + 4, "text-anchor": "end", class: "tick" }, String(v));
      });
      add(s, "text", { x: m.l, y: Hh - 8, class: "axis-label" }, shown.length ? "runs " + (n0 + 2) + " to " + (n0 + shown.length + 1) + ", compared with the run before" : "Run LIME at least twice");
      if (shown.length > 1) add(s, "polyline", { points: shown.map(function (v, k) { return xs(k) + "," + ys(v); }).join(" "), class: "line s-muted", style: "stroke-width:1.5" });
      shown.forEach(function (v, k) { add(s, "circle", { cx: xs(k), cy: ys(v), r: k === shown.length - 1 ? 7 : 5, class: (v < 5 ? "f-amber" : "f-violet") + " head" }); });
    }
    function draw() { drawBars(); drawStats(); drawHistory(); }
    onPatient(reset);
    draw();
    return draw;
  }

  /* ---------- station 4: the counterfactual ---------- */
  function initCf() {
    const may = F.map(function (_, j) { return j; }).filter(function (j) { return F[j].cf !== null && F[j].cf !== undefined; });
    const fixed = F.map(function (_, j) { return j; }).filter(function (j) { return may.indexOf(j) < 0; });
    may.forEach(function (j) { $("cf-may").appendChild(S.el("span", { class: "chip", "data-j": String(j) }, F[j].label)); });
    fixed.forEach(function (j) { $("cf-fixed").appendChild(S.el("span", { class: "chip" }, F[j].label)); });
    const steps = may.filter(function (j) { return typeof F[j].cf === "number"; }).map(function (j) { return lower(j) + " " + F[j].cf + " " + F[j].unit; });
    const flip = may.filter(function (j) { return F[j].cf === "flip"; }).map(function (j) { return F[j].label.toLowerCase(); });
    const down = may.filter(function (j) { return F[j].cf === "down"; }).map(function (j) { return "the " + lower(j); });
    $("cf-rule").textContent = "Search steps: " + steps.join(", ") + ". " + flip.join(" and ").replace(/^./, function (c) { return c.toUpperCase(); }) +
      " may switch; " + down.join(" and ") + " may only fall. Every value stays between the 2nd and 98th percentile of the training patients.";
    const spec = { kind: F.map(function (ft) { return ft.cf; }), lo: H.lo, hi: H.hi, scale: H.scale, target: 0.5 };
    const gauge = { from: null, to: null, k: 0 };
    function drawGauge() {
      const host = $("gauge"), W = widthOf(host, 700), Hh = 112, x0 = 14, x1 = W - 14, yb = 58;
      const xs = function (v) { return x0 + v * (x1 - x0); };
      const s = S.svgRoot(host, W, Hh, "Predicted risk before and after the counterfactual change");
      add(s, "rect", { x: xs(0), y: yb, width: xs(0.5) - xs(0), height: 14, rx: 3, class: "zone-lo" });
      add(s, "rect", { x: xs(0.5), y: yb, width: xs(1) - xs(0.5), height: 14, rx: 3, class: "zone-hi" });
      add(s, "text", { x: xs(0.25), y: yb + 34, "text-anchor": "middle", class: "tick" }, "no disease predicted");
      add(s, "text", { x: xs(0.75), y: yb + 34, "text-anchor": "middle", class: "tick" }, "disease predicted");
      add(s, "line", { x1: xs(0.5), x2: xs(0.5), y1: yb - 30, y2: yb + 20, class: "threshold" });
      add(s, "text", { x: xs(0.5), y: yb + 52, "text-anchor": "middle", class: "tick strong" }, "threshold 0.50");
      [0, 1].forEach(function (v) { add(s, "text", { x: xs(v), y: yb + 52, "text-anchor": v ? "end" : "start", class: "tick" }, v.toFixed(1)); });
      const r0 = gauge.from === null ? currentRisk() : gauge.from, labels = [{ x: xs(r0), t: "now " + r0.toFixed(2) }];
      add(s, "circle", { cx: xs(r0), cy: yb + 7, r: 9, class: "mk-before" });
      if (gauge.to !== null) {
        const v = r0 + (gauge.to - r0) * gauge.k;
        add(s, "line", { x1: xs(r0), x2: xs(v), y1: yb + 7, y2: yb + 7, class: "line s-ink", style: "stroke-width:3" });
        add(s, "circle", { cx: xs(v), cy: yb + 7, r: 9, class: "mk-after " + (v < 0.5 ? "f-safe" : "f-alert") });
        if (gauge.k >= 1) labels.push({ x: xs(v), t: "after " + v.toFixed(2) });
      }
      labels.forEach(function (l) { l.a = l.x < 60 ? "start" : l.x > W - 60 ? "end" : "middle"; });
      if (labels.length === 2 && Math.abs(labels[0].x - labels[1].x) < 140) {
        const left = labels[0].x <= labels[1].x ? 0 : 1;
        labels[left].a = "end"; labels[left].x += 8;
        labels[1 - left].a = "start"; labels[1 - left].x -= 8;
      }
      labels.forEach(function (l) { add(s, "text", { x: l.x, y: yb - 16, "text-anchor": l.a, class: "strong val", style: "font-size:17px" }, l.t); });
    }
    function chipsOn(js) { $("cf-may").querySelectorAll(".chip").forEach(function (c) { c.classList.toggle("on", js.indexOf(parseInt(c.getAttribute("data-j"), 10)) >= 0); }); }
    function ready() {
      gauge.from = null; gauge.to = null; gauge.k = 0;
      chipsOn([]);
      const r = currentRisk(), btn = $("cf-run");
      btn.disabled = r < 0.5;
      $("cf-result").innerHTML = r < 0.5 ? '<p class="note">The model already predicts no disease for ' + patientName().toLowerCase() +
        " (risk " + r.toFixed(2) + "). Choose a patient with a risk of at least 0.50.</p>" : "";
      drawGauge();
    }
    $("cf-run").addEventListener("click", function () {
      const x0 = state.x.slice(), r0 = f(x0);
      if (r0 < 0.5) return;
      const res = X.counterfactual(f, x0, spec);
      const changed = F.map(function (_, j) { return j; }).filter(function (j) { return res.x[j] !== x0[j]; });
      chipsOn(changed);
      gauge.from = r0; gauge.to = res.p; gauge.k = 0;
      tween(900, function (k) { gauge.k = k; drawGauge(); });
      const parts = changed.map(function (j) {
        return '<span class="change">' + F[j].label + " from " + valueText(j, x0[j]) + " to " + valueText(j, res.x[j]) + "</span>";
      }).join("");
      let html = '<div class="changes">' + parts + "</div>";
      if (!res.success) {
        html = '<p><strong>No counterfactual within the allowed changes.</strong> The lowest risk reached is ' + res.p.toFixed(2) + ".</p>" + (changed.length ? html : "");
      } else if (changed.length === 1) {
        const j = changed[0], ft = F[j], d = Math.abs(res.x[j] - x0[j]);
        const small = ft.type === "num" && d <= 2 * ft.cf + 1e-9;
        const what = ft.type === "num" ? "A single change of " + (+d.toFixed(1)) + " " + ft.unit + " in " + ft.label.toLowerCase().replace(/^st /, "ST ") :
          "A single change in " + ft.label.toLowerCase();
        html += "<p><strong>" + what + " moves the risk from " + r0.toFixed(2) + " to " + res.p.toFixed(2) + " and flips the decision.</strong></p>";
        if (small) html += '<p class="to-part3">A tiny change that flips a decision is exactly what an attacker looks for. <a href="part3.html">Part 3 tests this on medical alerts.</a></p>';
      } else {
        html += "<p><strong>" + word(changed.length, true) + " changes together move the risk from " + r0.toFixed(2) + " to " + res.p.toFixed(2) + ".</strong></p>";
      }
      $("cf-result").innerHTML = html;
      store.set("p2:counterfactual", { changes: changed.length, from: +r0.toFixed(3), to: +res.p.toFixed(3), success: res.success,
        variables: changed.map(function (j) { return KEY[j]; }), patient: state.idx, edited: state.edited });
      S.reveal(document.querySelector("#s-cf .takeaway"));
    });
    onPatient(ready);
    ready();
    return drawGauge;
  }

  /* ---------- station 5: the deletion test ---------- */
  function initTrust() {
    let result = null, shown = 0, answer = null, timer = null;
    const takeaway = document.querySelector("#s-trust .takeaway"), status = $("status-5");
    const METHODS = [{ id: "shap", name: "SHAP", cls: "s-violet", dot: "f-violet", tone: "violet" },
      { id: "lime", name: "LIME", cls: "s-amber", dot: "f-amber", tone: "amber" },
      { id: "random", name: "Random", cls: "s-muted dashed", dot: "f-muted", tone: "" }];
    S.poll($("poll-deletion"), "p2-deletion", function (v) { answer = v; if (result) drawStats(); });
    function curve(order, x) {
      const B = H.background, rows = B.map(function () { return x.slice(); }), c = [f(x)];
      order.forEach(function (j) {
        rows.forEach(function (r, b) { r[j] = B[b][j]; });
        c.push(rows.reduce(function (a, r) { return a + f(r); }, 0) / rows.length);
      });
      return c;
    }
    function area(c) { let a = 0; for (let k = 1; k < c.length; k++) a += (c[k] + c[k - 1]) / 2 / (c.length - 1); return a; }
    function reset() {
      if (timer) { clearTimeout(timer); timer = null; }
      cancelShap("deletion");
      result = null; shown = 0;
      status.className = "status"; status.textContent = "";
      $("del-run").disabled = false;
      draw();
      drawStats();
    }
    $("del-run").addEventListener("click", function () {
      if (timer) return;
      $("del-run").disabled = true;
      status.className = "status on";
      status.textContent = "Computing the three orderings";
      withShap("deletion", function (sh) {
        timer = setTimeout(function () {
          timer = null;
          const x = state.x.slice(), k = key(x);
          let lime = limeState.key === k ? { w: limeState.w, seed: limeState.seed, latest: true } : null;
          if (!lime) lime = { w: X.lime(f, x, H.pool, 1, NLIME), seed: 1, latest: false };
          const rand = X.mulberry32(42), curves = [];
          for (let r = 0; r < 10; r++) {
            const o = F.map(function (_, j) { return j; });
            for (let a = o.length - 1; a > 0; a--) { const b = Math.floor(rand() * (a + 1)); const t = o[a]; o[a] = o[b]; o[b] = t; }
            curves.push(curve(o, x));
          }
          const avg = curves[0].map(function (_, s) { return curves.reduce(function (a, c) { return a + c[s]; }, 0) / curves.length; });
          const sOrd = byAbs(sh.phi), lOrd = byAbs(lime.w);
          result = { c: { shap: curve(sOrd, x), lime: curve(lOrd, x), random: avg }, lime: lime, first: { shap: sOrd[0], lime: lOrd[0] } };
          METHODS.forEach(function (m) { result[m.id] = area(result.c[m.id]); });
          status.className = "status";
          status.textContent = lime.latest ? "LIME order from the run with seed " + lime.seed + " in station 3." : "LIME order from a fresh run with seed 1.";
          shown = 0;
          (function step() {
            draw();
            if (shown < M) { shown += 1; timer = setTimeout(step, S.reduceMotion ? 0 : 140); return; }
            timer = null;
            $("del-run").disabled = false;
            drawStats();
            const best = METHODS.slice().sort(function (a, b) { return result[a.id] - result[b.id]; })[0];
            store.set("p2:deletion", { shap: +result.shap.toFixed(3), lime: +result.lime.toFixed(3), random: +result.random.toFixed(3), best: best.id, patient: state.idx });
            S.reveal(takeaway);
          })();
        }, 30);
      });
    });
    function draw() {
      const host = $("del-chart"), W = widthOf(host, 560), Hh = 316, m = { l: 46, r: 16, t: 30, b: 66 };
      let lo = 0.3, hi = 0.8;
      if (result) {
        const all = result.c.shap.concat(result.c.lime, result.c.random);
        lo = Math.max(0, Math.floor((Math.min.apply(null, all) - 0.03) * 10) / 10);
        hi = Math.min(1, Math.ceil((Math.max.apply(null, all) + 0.03) * 10) / 10);
      }
      const xs = function (k) { return m.l + (k / M) * (W - m.l - m.r); }, ys = function (v) { return Hh - m.b - ((v - lo) / (hi - lo)) * (Hh - m.t - m.b); };
      const s = S.svgRoot(host, W, Hh, "Deletion curves: predicted risk as variables are removed");
      const yt = niceTicks(lo, hi, 5);
      yt.forEach(function (v) {
        add(s, "line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), class: "gridline" });
        add(s, "text", { x: m.l - 6, y: ys(v) + 4, "text-anchor": "end", class: "tick" }, v.toFixed(decimalsOf(yt)));
      });
      if (lo < 0.5 && hi > 0.5) add(s, "line", { x1: m.l, x2: W - m.r, y1: ys(0.5), y2: ys(0.5), class: "guide" });
      add(s, "text", { x: m.l - 40, y: 14, class: "axis-label" }, "predicted risk");
      const xt = [0, 2, 4, 6, 8, 10, 12].filter(function (v) { return v <= M; }).concat(M % 2 ? [M] : []);
      axisX(s, xs, Hh - m.b, xt, W < 480 ? "variables removed" : "variables removed (replaced by values of the " + H.background.length + " reference patients)");
      if (!result) {
        add(s, "text", { x: (m.l + W - m.r) / 2, y: ys((lo + hi) / 2), "text-anchor": "middle", class: "muted" }, "Run the test to draw the curves.");
      } else {
        METHODS.slice().reverse().forEach(function (mt) {
          const c = result.c[mt.id].slice(0, shown + 1);
          add(s, "polyline", { points: c.map(function (v, k) { return xs(k) + "," + ys(v); }).join(" "), class: "line " + mt.cls });
          c.forEach(function (v, k) { if (mt.id !== "random") add(s, "circle", { cx: xs(k), cy: ys(v), r: k === c.length - 1 ? 5 : 3.5, class: mt.dot + " head" }); });
        });
      }
      legend(s, METHODS.map(function (mt) { return { label: mt.name + " order", kind: mt.id === "random" ? "dash" : "line", cls: mt.cls }; })
        .concat([{ label: "threshold 0.50", kind: "guide" }]), m.l, Hh - 6, W);
    }
    function drawStats() {
      if (!result) { $("del-stats").innerHTML = ""; $("del-note").textContent = "Answer the poll, then run the test."; return; }
      const best = METHODS.slice().sort(function (a, b) { return result[a.id] - result[b.id]; })[0];
      $("del-stats").innerHTML = METHODS.map(function (mt) {
        return '<div class="stat ' + mt.tone + '"><span class="v">' + result[mt.id].toFixed(3) + '</span><span class="l">area, ' + mt.name +
          " order" + (mt === best ? ", lowest" : "") + "</span></div>";
      }).join("");
      const c = result.c.shap, j = result.first.shap;
      $("del-note").textContent = "Lower area means a more faithful ranking. Fastest fall here: " + best.name + (answer ? (answer === best.id ? ", as predicted. " : ". ") : ". ") +
        "Removing the top SHAP variable alone (" + lower(j) + ") moves the risk from " + c[0].toFixed(2) + " to " + c[1].toFixed(2) + ".";
    }
    onPatient(reset);
    reset();
    return function redraw() { draw(); };
  }

  /* ---------- station 6: the model randomisation test ---------- */
  function initSanity() {
    const T = H.model.trees.length, LEVELS = [0, 25, 50, 75, 100], status = $("status-6");
    const rand = X.mulberry32(42), shuffled = new Array(T);
    for (let t = T - 1; t >= 0; t--) {
      const tr = H.model.trees[t], leaves = [];
      tr.l.forEach(function (l, n) { if (l === -1) leaves.push(n); });
      const vals = leaves.map(function (n) { return tr.v[n]; });
      for (let a = vals.length - 1; a > 0; a--) { const b = Math.floor(rand() * (a + 1)); const tmp = vals[a]; vals[a] = vals[b]; vals[b] = tmp; }
      const v = tr.v.slice();
      leaves.forEach(function (n, q) { v[n] = vals[q]; });
      shuffled[t] = { f: tr.f, t: tr.t, l: tr.l, r: tr.r, v: v };
    }
    const copies = LEVELS.map(function (k) {
      const c = Math.round((T * k) / 100);
      return { init: H.model.init, trees: H.model.trees.map(function (tr, t) { return t >= T - c ? shuffled[t] : tr; }) };
    });
    const aucs = copies.map(function (mdl) { return auroc(H.labels, H.patients.map(function (x) { return X.proba(mdl, x); })); });
    /* training mean recovered from NB2's standardised values z = (x - mean) / sd */
    const mu = F.map(function (_, j) {
      let acc = 0, n = 0;
      H.patients.forEach(function (x, i) { const z = N2.shap_test.z[i][j]; if (Math.abs(z) < 2.95) { acc += x[j] - z * H.scale[j]; n++; } });
      return n ? acc / n : 0;
    });
    let level = 0, cache = { key: null, phi: [] }, timer = null, stored = false;
    const pills = $("lvl-pills");
    LEVELS.forEach(function (k, li) {
      const b = S.el("button", { type: "button", "aria-pressed": String(li === 0) }, k + "%");
      b.setAttribute("aria-label", k + " percent of trees shuffled");
      b.addEventListener("click", function () { go(li); });
      pills.appendChild(b);
    });
    $("lvl-next").addEventListener("click", function () { go(Math.min(LEVELS.length - 1, level + 1)); });
    function inputOnly() { return state.x.map(function (v, j) { return Math.min(3, Math.abs((v - mu[j]) / H.scale[j])); }); }
    function go(li) {
      level = li;
      pills.querySelectorAll("button").forEach(function (b, k) { b.setAttribute("aria-pressed", String(k === li)); });
      $("lvl-next").disabled = li === LEVELS.length - 1;
      compute();
    }
    function compute() {
      if (timer) { clearTimeout(timer); timer = null; }
      withShap("sanity", function (sh) {
        const k = key(state.x);
        if (cache.key !== k) cache = { key: k, phi: [sh.phi] };
        const missing = [];
        for (let li = 1; li <= level; li++) if (!cache.phi[li]) missing.push(li);
        draw();
        if (!missing.length) { done(); return; }
        status.className = "status on";
        (function next() {
          const li = missing.shift();
          status.textContent = "Computing exact SHAP for the copy with " + LEVELS[li] + " percent of the trees shuffled";
          timer = setTimeout(function () {
            timer = null;
            if (cache.key !== key(state.x)) return;
            const mdl = copies[li];
            cache.phi[li] = X.exactShapley(function (z) { return X.proba(mdl, z); }, state.x.slice(), H.background).phi;
            draw();
            if (missing.length) next(); else done();
          }, 40);
        })();
      });
    }
    function done() {
      status.className = "status";
      status.textContent = level ? "Shuffled leaf values: the last " + Math.round((T * LEVELS[level]) / 100) + " of " + T + " trees, seed 42." : "The trained model: nothing shuffled yet.";
      if (cache.phi[4] && !stored) {
        const r = rhoAt(4);
        const io = inputOnly();
        store.set("p2:sanity", { shapAt100: +r.toFixed(3), inputAt100: +X.spearman(io, io).toFixed(3), patient: state.idx });
        stored = true;
        S.reveal(document.querySelector("#s-sanity .takeaway"));
      }
    }
    function rhoAt(li) { return X.spearman(cache.phi[li].map(Math.abs), cache.phi[0].map(Math.abs)); }
    function draw() {
      const host = $("san-chart"), W = widthOf(host, 520), Hh = 286, m = { l: 46, r: 18, t: 32, b: 64 };
      const rhos = LEVELS.map(function (_, li) { return cache.key === key(state.x) && cache.phi[li] ? rhoAt(li) : null; });
      const lo = Math.min(-0.2, Math.floor(Math.min.apply(null, rhos.filter(function (v) { return v !== null; }).concat([0])) * 5) / 5);
      const xs = function (k) { return m.l + 12 + (k / 100) * (W - m.l - m.r - 24); }, ys = function (v) { return Hh - m.b - ((v - lo) / (1 - lo)) * (Hh - m.t - m.b); };
      const s = S.svgRoot(host, W, Hh, "Rank correlation with the trained model's explanation as more trees are shuffled");
      const yt = niceTicks(lo, 1, 4);
      yt.forEach(function (v) {
        add(s, "line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), class: v === 0 ? "axis" : "gridline" });
        add(s, "text", { x: m.l - 6, y: ys(v) + 4, "text-anchor": "end", class: "tick" }, num(v, decimalsOf(yt)));
      });
      add(s, "text", { x: m.l - 40, y: 14, class: "axis-label" }, "Spearman with the trained model's explanation");
      axisX(s, xs, Hh - m.b, LEVELS, "share of trees with shuffled leaf values", function (v) { return v + "%"; });
      add(s, "line", { x1: xs(LEVELS[level]), x2: xs(LEVELS[level]), y1: m.t, y2: Hh - m.b, class: "guide" });
      const upto = LEVELS.map(function (k, li) { return li; }).filter(function (li) { return rhos[li] !== null; });
      add(s, "polyline", { points: upto.map(function (li) { return xs(LEVELS[li]) + "," + ys(1); }).join(" "), class: "line s-muted dashed" });
      upto.forEach(function (li) { add(s, "circle", { cx: xs(LEVELS[li]), cy: ys(1), r: 4.5, class: "f-muted head" }); });
      if (upto.length > 1) add(s, "polyline", { points: upto.map(function (li) { return xs(LEVELS[li]) + "," + ys(rhos[li]); }).join(" "), class: "line s-violet" });
      upto.forEach(function (li) { add(s, "circle", { cx: xs(LEVELS[li]), cy: ys(rhos[li]), r: li === level ? 7 : 5, class: "f-violet head" }); });
      legend(s, [{ label: "SHAP of the model", kind: "line", cls: "s-violet" }, { label: "input only, ignores the model", kind: "dash", cls: "s-muted" }], m.l, Hh - 6, W);
      const cur = rhos[level];
      const stat = function (v, l, tone) { return '<div class="stat ' + tone + '"><span class="v">' + v + '</span><span class="l">' + l + "</span></div>"; };
      $("san-stats").innerHTML = stat(cur === null ? "..." : cur.toFixed(2), "SHAP: Spearman with the trained model", "violet") +
        stat("1.00", "input only: Spearman with itself, unchanged", "") +
        stat(aucs[level].toFixed(3), "test AUROC of this copy of the model", aucs[level] < 0.6 ? "alert" : "safe");
      drawBars();
    }
    function drawBars() {
      const host = $("san-bars"), W = widthOf(host, 460), rowH = 22, labelW = 132, top = 24, gapX = 16;
      const ph = cache.key === key(state.x) && cache.phi[level] ? cache.phi[level].map(Math.abs) : null;
      const p0 = cache.key === key(state.x) && cache.phi[0] ? cache.phi[0].map(Math.abs) : null;
      const io = inputOnly(), order = p0 ? byAbs(p0) : byAbs(io);
      const colW = (W - labelW - 12 - gapX) / 2, xa = labelW + 12, xb = xa + colW + gapX, Hh = top + M * rowH + 40;
      const s = S.svgRoot(host, W, Hh, "Importance per variable for SHAP and for the input-only explanation");
      add(s, "text", { x: xa, y: 14, class: "strong" }, colW >= 150 ? "SHAP, " + LEVELS[level] + "% shuffled" : "SHAP");
      add(s, "text", { x: xb, y: 14, class: "strong" }, "Input only");
      const mp = ph ? Math.max.apply(null, ph) || 1 : 1, m0 = p0 ? Math.max.apply(null, p0) || 1 : 1, mi = Math.max.apply(null, io) || 1;
      order.forEach(function (j, r) {
        const y = top + r * rowH;
        add(s, "text", { x: labelW, y: y + 15, "text-anchor": "end" }, short(j));
        if (ph) add(s, "rect", { x: xa, y: y + 5, width: Math.max(1.5, (ph[j] / mp) * colW), height: rowH - 9, rx: 3, class: "f-violet" });
        if (p0 && level > 0) { const tx = xa + (p0[j] / m0) * colW; add(s, "line", { x1: tx, x2: tx, y1: y + 2, y2: y + rowH - 1, class: "ghost" }); }
        add(s, "rect", { x: xb, y: y + 5, width: Math.max(1.5, (io[j] / mi) * colW), height: rowH - 9, rx: 3, class: "f-muted" });
      });
      if (level > 0) legend(s, [{ label: "trained model", kind: "tick" }], xa, Hh - 10, W);
    }
    onPatient(function (kind) {
      if (timer) { clearTimeout(timer); timer = null; }
      cache = { key: null, phi: [] };
      stored = false;
      if (kind === "live") {
        cancelShap("sanity");
        level = 0;
        pills.querySelectorAll("button").forEach(function (b, k) { b.setAttribute("aria-pressed", String(k === 0)); });
        $("lvl-next").disabled = false;
        status.className = "status";
        status.textContent = "";
        draw();
        return;
      }
      go(0);
    });
    go(0);
    $("nb3-link").href = S.colabUrl("NB3");
    return draw;
  }

  /* ---------- start ---------- */
  const fills = { ntrain: String(N2.tree[0].n), ntest: String(H.patients.length), nvar: String(M), nlime: String(NLIME), npool: String(H.pool.length) };
  document.querySelectorAll("[data-fill]").forEach(function (n) { n.textContent = fills[n.getAttribute("data-fill")] || ""; });
  for (let n = 1; n <= 6; n++) { const h = $("bar-" + n); if (h) buildBar(h, n); }
  syncBars();
  initColdOpen();
  const redraws = [initGlass(), initShap(), initLime(), initCf(), initTrust(), initSanity()];
  let rt = null;
  function redrawAll() { redraws.forEach(function (fn) { try { fn(); } catch (e) { /* keep the other charts */ } }); }
  window.addEventListener("resize", function () { if (rt) clearTimeout(rt); rt = setTimeout(redrawAll, 160); });
  document.addEventListener("themechange", redrawAll);
})();
