/* XAI Lab: the finale of the workshop. The four tools of the morning, a subgroup audit and a discharge summary
   generated from the progress kept in this browser. Depends on site-data.js (window.LAB_DATA), lab-core.js
   (window.XAICore) and site.js (window.XAISite). */
(function () {
  "use strict";
  const D = window.LAB_DATA || {}, X = window.XAICore, S = window.XAISite;
  if (!X || !S) return;
  const $ = function (id) { return document.getElementById(id); };
  const add = S.add, svgRoot = S.svgRoot, reduceMotion = S.reduceMotion;
  const HD = D.heart;

  /* ---------- small helpers ---------- */
  function signed(v, d) { return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d); }
  function pct(v, d) { return (100 * v).toFixed(d === undefined ? 1 : d) + "%"; }
  function num(v) { return typeof v === "number" && isFinite(v); }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function thousands(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function quantile(a, q) {
    if (!a.length) return NaN;
    const s = a.slice().sort(function (u, v) { return u - v; }), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function scrollToNode(node) {
    if (node && node.scrollIntoView) node.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }
  function confusion(y, p, t) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (let i = 0; i < y.length; i++) {
      const pos = p[i] >= t;
      if (pos && y[i]) tp++; else if (pos) fp++; else if (y[i]) fn++; else tn++;
    }
    return { tp: tp, fp: fp, fn: fn, tn: tn };
  }
  function stat(v, l, tone) {
    return '<div class="stat' + (tone ? " " + tone : "") + '"><span class="v">' + v + '</span><span class="l">' + l + "</span></div>";
  }

  function axisX(s, xs, y, ticks, label, fmt) {
    add(s, "line", { x1: xs(ticks[0]), x2: xs(ticks[ticks.length - 1]), y1: y, y2: y, class: "axis" });
    ticks.forEach(function (v) {
      add(s, "line", { x1: xs(v), x2: xs(v), y1: y, y2: y + 4, class: "axis" });
      add(s, "text", { x: xs(v), y: y + 17, class: "tick", "text-anchor": "middle" }, fmt ? fmt(v) : String(v));
    });
    if (label) add(s, "text", { x: (xs(ticks[0]) + xs(ticks[ticks.length - 1])) / 2, y: y + 33, class: "axis-label", "text-anchor": "middle" }, label);
  }

  function legend(s, entries, x, y) {
    entries.forEach(function (e, i) {
      add(s, "rect", { x: x, y: y + i * 18, width: 12, height: 12, rx: 2, class: e[1] });
      add(s, "text", { x: x + 18, y: y + i * 18 + 11, class: "tick" }, e[0]);
    });
  }

  /* Horizontal bars around zero, largest magnitude first, values in a right-hand column. */
  function drawBars(container, items, K, digits, caption) {
    const shown = items.slice().sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); }).slice(0, K);
    const W = 560, rowH = 24, m = { l: 210, r: 70 }, H = shown.length * rowH + 40;
    const s = svgRoot(container, W, H, caption);
    const maxAbs = Math.max(1e-12, Math.max.apply(null, shown.map(function (it) { return Math.abs(it.v); })));
    const x0 = m.l + (W - m.l - m.r) / 2, half = (W - m.l - m.r) / 2 - 4;
    add(s, "line", { x1: x0, x2: x0, y1: 6, y2: H - 26, class: "axis" });
    shown.forEach(function (it, r) {
      const y = 8 + r * rowH, w = (Math.abs(it.v) / maxAbs) * half;
      add(s, "text", { x: m.l - 10, y: y + 15, "text-anchor": "end" }, it.label);
      add(s, "rect", { x: it.v >= 0 ? x0 : x0 - w, y: y + 4, width: Math.max(w, 1), height: rowH - 9, rx: 2,
                       class: it.v >= 0 ? "f-alert" : "f-safe" });
      add(s, "text", { x: W - 6, y: y + 15, "text-anchor": "end", class: "val" }, signed(it.v, digits));
    });
    add(s, "text", { x: x0 - 8, y: H - 8, "text-anchor": "end", class: "tick" }, "lowers the risk");
    add(s, "text", { x: x0 + 8, y: H - 8, "text-anchor": "start", class: "tick" }, "raises the risk");
  }

  /* ---------- facts in the page text and notebook links ---------- */
  function markOpened(nb) {
    const o = obj(S.store.get("opened", null)) || {};
    o[nb] = true;
    S.store.set("opened", o);
  }
  function notebookLink(a, nb) {
    if (!S.NOTEBOOKS[nb]) return;
    a.href = S.colabUrl(nb);
    a.target = "_blank";
    a.rel = "noopener";
    a.addEventListener("click", function () { markOpened(nb); });
  }
  function fillFacts() {
    const N7 = D.nb7, facts = {
      "wdbc-n": D.wdbc ? D.wdbc.y.length : null,
      "heart-vars": HD ? HD.features.length : null,
      "heart-coal": HD ? thousands(Math.pow(2, HD.features.length)) : null,
      "heart-bg": HD ? HD.background.length : null,
      "cgm-budget": D.cgm ? D.cgm.budget : null,
      "nb7-n": N7 ? N7.y.length : null,
      "nb7-w": N7 ? N7.sex_male.filter(function (v) { return v === 0; }).length : null,
      "nb7-m": N7 ? N7.sex_male.filter(function (v) { return v === 1; }).length : null
    };
    document.querySelectorAll("[data-k]").forEach(function (n) {
      const v = facts[n.getAttribute("data-k")];
      if (v !== null && v !== undefined) n.textContent = String(v);
    });
    document.querySelectorAll("a[data-nb]").forEach(function (a) { notebookLink(a, a.getAttribute("data-nb")); });
  }

  /* ---------- the ward round: six tasks, ticked automatically ---------- */
  const TASKS = [
    { id: "deploy", part: "p1", tag: "Part 1", tab: "Deploy?", text: "Choose a threshold that misses at most five cancers" },
    { id: "explain", part: "p2", tag: "Part 2", tab: "Explain a patient", text: "Find a counterfactual for a patient with disease" },
    { id: "shapley", part: "p2", tag: "Part 2", tab: "Shapley by hand", text: "Build a game from three variables of your choice" },
    { id: "spoof", part: "p3", tag: "Part 3", tab: "Spoof the sensor", text: "Silence an alert and watch the margin flag it" },
    { id: "audit", part: "p4", tag: "Part 4", tab: "Audit", text: "Find the threshold that narrows the sensitivity gap between women and men" },
    { id: "debrief", part: "fin", tag: "Finale", tab: "Debrief", text: "Read the discharge summary" }
  ];
  function readTasks() { return obj(S.store.get("lab:tasks", null)) || {}; }
  let tasks = readTasks();
  function buildTasks() {
    const list = $("wr-list"), bar = $("wr-bar");
    TASKS.forEach(function (t) {
      const li = S.el("li", { class: "wr-task", "data-part": t.part, id: "task-" + t.id });
      li.innerHTML = '<a href="#' + t.id + '"><span class="wr-box" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M4 10.5 L8.5 15 L16 5.5"/></svg></span>' +
        '<span class="wr-meta"><strong>' + t.tag + "</strong><span>" + t.tab + '</span></span><span class="wr-text">' + t.text +
        '<span class="sr-only wr-state"></span></span></a>';
      li.querySelector("a").addEventListener("click", function (e) {
        e.preventDefault();
        const tab = $("tab-" + t.id);
        if (tab) { openTab(tab, true); scrollToNode($("bench")); }
      });
      list.appendChild(li);
      bar.appendChild(S.el("i", { "data-part": t.part }));
    });
    updateTasks(null);
  }
  function updateTasks(just) {
    const marks = $("wr-bar").children;
    let n = 0;
    TASKS.forEach(function (t, i) {
      const done = tasks[t.id] === true, li = $("task-" + t.id);
      if (done) n++;
      li.classList.toggle("done", done);
      li.querySelector(".wr-state").textContent = done ? ", done" : ", not done yet";
      if (t.id === just && !reduceMotion) { li.classList.remove("just"); void li.offsetWidth; li.classList.add("just"); }
      if (marks[i]) marks[i].className = done ? "on" : "";
      const tab = $("tab-" + t.id);
      if (tab) tab.classList.toggle("done", done);
    });
    $("wr-count").textContent = n + " of " + TASKS.length + " tasks done";
  }
  function markTask(id) {
    tasks = readTasks();
    if (tasks[id] === true) return;
    tasks[id] = true;
    S.store.set("lab:tasks", tasks);
    updateTasks(id);
    const t = TASKS.filter(function (k) { return k.id === id; })[0];
    $("wr-live").textContent = "Ward round task done: " + t.text + ". " + $("wr-count").textContent + ".";
  }

  /* ---------- tabs ---------- */
  const tabs = Array.prototype.slice.call(document.querySelectorAll('.lab-tab[role="tab"]'));
  const init = { deploy: initDeploy, explain: initExplain, shapley: initShapley, spoof: initSpoof, audit: initAudit };
  const started = {};
  function openTab(tab, focus) {
    tabs.forEach(function (t) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    });
    const key = tab.id.replace("tab-", "");
    if (key === "debrief") openDebrief();
    else if (!started[key]) { started[key] = true; init[key](); }
    if (focus) tab.focus();
    if (window.history && history.replaceState) history.replaceState(null, "", "#" + key);
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { openTab(t); });
    t.addEventListener("keydown", function (e) {
      let j = -1;
      if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") j = (i + tabs.length - 1) % tabs.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      openTab(tabs[j], true);
    });
  });

  /* ---------- 1. Deploy? ---------- */
  function initDeploy() {
    const y = D.wdbc.y, p = D.wdbc.p, slider = $("thr");
    function update() {
      const t = parseFloat(slider.value), c = confusion(y, p, t);
      $("thr-out").textContent = t.toFixed(2);
      $("deploy-stats").innerHTML = stat(pct((c.tp + c.tn) / y.length), "accuracy") + stat(c.fn, "cancers missed", "alert") +
        stat(c.fp, "unnecessary work-ups", "amber") + stat(pct(c.tp / (c.tp + c.fn)), "sensitivity") + stat(pct(c.tn / (c.tn + c.fp)), "specificity");
      drawHist(t);
      drawErrors(t);
      if (c.fn <= 5) markTask("deploy");
    }
    slider.addEventListener("input", update);
    update();
    drawCalibration();
  }

  function drawHist(t) {
    const W = 560, H = 240, m = { l: 44, r: 14, t: 12, b: 42 }, bins = 25;
    const s = svgRoot($("hist"), W, H, "Histogram of predicted probabilities by true diagnosis");
    const benign = new Array(bins).fill(0), malignant = new Array(bins).fill(0);
    D.wdbc.p.forEach(function (v, i) { (D.wdbc.y[i] ? malignant : benign)[Math.min(bins - 1, Math.floor(v * bins))]++; });
    const maxC = Math.max.apply(null, benign.concat(malignant));
    const xs = function (v) { return m.l + v * (W - m.l - m.r); };
    const ys = function (c) { return H - m.b - Math.sqrt(c / maxC) * (H - m.t - m.b); };
    [1, 10, 50, 100, 200, 300].filter(function (c) { return c <= maxC; }).forEach(function (c) {
      add(s, "line", { x1: m.l, x2: W - m.r, y1: ys(c), y2: ys(c), class: "gridline" });
      add(s, "text", { x: m.l - 6, y: ys(c) + 4, class: "tick", "text-anchor": "end" }, String(c));
    });
    const bw = (W - m.l - m.r) / bins;
    for (let k = 0; k < bins; k++) {
      if (benign[k]) add(s, "rect", { x: xs(k / bins) + 1, y: ys(benign[k]), width: bw / 2 - 1, height: H - m.b - ys(benign[k]), class: "f-safe" });
      if (malignant[k]) add(s, "rect", { x: xs(k / bins) + bw / 2, y: ys(malignant[k]), width: bw / 2 - 1, height: H - m.b - ys(malignant[k]), class: "f-alert" });
    }
    axisX(s, xs, H - m.b, [0, 0.25, 0.5, 0.75, 1], "predicted probability of malignancy (square-root count scale)");
    add(s, "line", { x1: xs(t), x2: xs(t), y1: m.t, y2: H - m.b, class: "threshold" });
    legend(s, [["benign", "f-safe"], ["malignant", "f-alert"]], xs(0.36), m.t + 2);
  }

  function drawErrors(t) {
    const y = D.wdbc.y, p = D.wdbc.p, errs = [];
    for (let i = 0; i < y.length; i++) {
      const pos = p[i] >= t;
      if (pos !== (y[i] === 1)) errs.push({ i: i, conf: pos ? p[i] : 1 - p[i] });
    }
    errs.sort(function (a, b) { return b.conf - a.conf; });
    $("errors").innerHTML = errs.slice(0, 6).map(function (e) {
      return "<li>Biopsy " + e.i + " is " + (y[e.i] ? "malignant" : "benign") + "; the model gave P(malignant) = " + p[e.i].toFixed(3) + "</li>";
    }).join("") || "<li>No errors at this threshold.</li>";
  }

  function drawCalibration() {
    const W = 320, H = 280, m = { l: 44, r: 12, t: 12, b: 42 };
    const s = svgRoot($("calib"), W, H, "Reliability diagram");
    const xs = function (v) { return m.l + v * (W - m.l - m.r); }, ys = function (v) { return H - m.b - v * (H - m.t - m.b); };
    add(s, "line", { x1: xs(0), y1: ys(0), x2: xs(1), y2: ys(1), class: "diag" });
    [0.25, 0.5, 0.75, 1].forEach(function (v) {
      add(s, "line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), class: "gridline" });
      add(s, "text", { x: m.l - 6, y: ys(v) + 4, class: "tick", "text-anchor": "end" }, String(v));
    });
    axisX(s, xs, H - m.b, [0, 0.5, 1], "mean predicted probability");
    [["p", "c-alert"], ["p_lr", "c-safe"]].forEach(function (spec) {
      const p = D.wdbc[spec[0]], order = p.map(function (_, i) { return i; }).sort(function (a, b) { return p[a] - p[b]; });
      const pts = [];
      for (let b = 0; b < 8; b++) {
        const chunk = order.slice(Math.floor(b * order.length / 8), Math.floor((b + 1) * order.length / 8));
        const mp = chunk.reduce(function (a, i) { return a + p[i]; }, 0) / chunk.length;
        const obs = chunk.reduce(function (a, i) { return a + D.wdbc.y[i]; }, 0) / chunk.length;
        pts.push(xs(mp) + "," + ys(obs));
      }
      add(s, "polyline", { points: pts.join(" "), class: "line " + spec[1] });
      pts.forEach(function (pt) { const c = pt.split(","); add(s, "circle", { cx: c[0], cy: c[1], r: 3.5, class: "dot " + spec[1] }); });
    });
    legend(s, [["neural network", "f-alert"], ["logistic regression", "f-safe"]], m.l + 8, m.t + 4);
    $("calib-note").textContent = "Expected calibration error: neural network " + X.ece(D.wdbc.y, D.wdbc.p).toFixed(3) +
      ", logistic regression " + X.ece(D.wdbc.y, D.wdbc.p_lr).toFixed(3) + ". Points on the diagonal mean that stated and observed frequencies agree.";
  }

  /* ---------- shared heart-model helpers ---------- */
  const heartRisk = function (z) { return X.proba(HD.model, z); };
  function cfSpec() { return { kind: HD.features.map(function (ft) { return ft.cf; }), lo: HD.lo, hi: HD.hi, scale: HD.scale, target: 0.5 }; }
  function valueText(feat, v) {
    if (feat.type === "cat") {
      const o = feat.options.filter(function (op) { return op[0] === v; })[0];
      return o ? o[1] : String(v);
    }
    return (Math.round(v * 10) / 10) + (feat.unit ? " " + feat.unit : "");
  }
  /* The patient of Part 2: the test patient with disease whose risk is closest to 0.75, as in NB2. */
  let part2Index = null;
  function part2Patient() {
    if (part2Index !== null) return part2Index;
    let best = 0, bd = Infinity;
    HD.patients.forEach(function (x, i) {
      if (HD.labels[i] !== 1) return;
      const d = Math.abs(heartRisk(x) - 0.75);
      if (d < bd) { bd = d; best = i; }
    });
    part2Index = best;
    return best;
  }
  function fillPatients(select) {
    const p2 = part2Patient();
    HD.patients.forEach(function (x, i) {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = "Test patient " + i + ": " + (HD.labels[i] ? "disease" : "no disease") + ", risk " + heartRisk(x).toFixed(2) +
        (i === p2 ? " (the Part 2 patient)" : "");
      select.appendChild(o);
    });
  }
  function topK(w, k) {
    return w.map(function (v, j) { return [Math.abs(v), j]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, k).map(function (p) { return p[1]; });
  }

  /* ---------- 2. Explain a patient ---------- */
  function initExplain() {
    const F = HD.features, select = $("patient"), box = $("feature-controls");
    let current = HD.patients[0].slice(), lastShap = null, limeSeed = 1, lastTop = null;
    fillPatients(select);
    const inputs = F.map(function (feat, j) {
      const wrap = document.createElement("div");
      wrap.className = "lab-field";
      const label = document.createElement("label");
      label.htmlFor = "fx-" + feat.key;
      label.textContent = feat.label + (feat.unit ? " (" + feat.unit + ")" : "");
      wrap.appendChild(label);
      let input;
      if (feat.type === "num") {
        const row = document.createElement("div");
        row.className = "lab-slider";
        input = document.createElement("input");
        input.type = "range";
        input.min = feat.min; input.max = feat.max; input.step = feat.step;
        const out = document.createElement("output");
        row.appendChild(input); row.appendChild(out); wrap.appendChild(row);
        input.addEventListener("input", function () { out.textContent = input.value; current[j] = parseFloat(input.value); quick(); });
        input.addEventListener("change", full);
        input.output = out;
      } else {
        input = document.createElement("select");
        feat.options.forEach(function (op) {
          const o = document.createElement("option");
          o.value = op[0]; o.textContent = op[1];
          input.appendChild(o);
        });
        input.addEventListener("change", function () { current[j] = parseFloat(input.value); quick(); full(); });
        wrap.appendChild(input);
      }
      input.id = "fx-" + feat.key;
      box.appendChild(wrap);
      return input;
    });

    function load(i) {
      current = HD.patients[i].slice();
      inputs.forEach(function (inp, j) { inp.value = current[j]; if (inp.output) inp.output.textContent = current[j]; });
      $("cf-out").innerHTML = "";
      quick();
      full();
    }
    function quick() {
      const r = heartRisk(current);
      $("risk").textContent = r.toFixed(2);
      $("risk").className = "lab-risk " + (r >= 0.5 ? "hi" : "lo");
      $("risk-label").textContent = r >= 0.5 ? "predicted risk: disease (threshold 0.5)" : "predicted risk: no disease (threshold 0.5)";
    }
    function full() {
      lastShap = X.exactShapley(heartRisk, current, HD.background);
      drawWaterfall(lastShap);
      lastTop = null;
      runLime();
    }
    function drawWaterfall(sh) {
      const order = sh.phi.map(function (v, j) { return { j: j, v: v }; }).sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
      const rows = order.slice(0, 8).map(function (it) { return { label: F[it.j].label + " = " + valueText(F[it.j], current[it.j]), v: it.v }; });
      if (order.length > 8) rows.push({ label: "other " + (order.length - 8) + " variables", v: order.slice(8).reduce(function (a, it) { return a + it.v; }, 0) });
      let cum = sh.base, lo = sh.base, hi = sh.base;
      rows.forEach(function (r) { r.a = cum; cum += r.v; r.b = cum; lo = Math.min(lo, r.a, r.b); hi = Math.max(hi, r.a, r.b); });
      lo = Math.max(0, lo - 0.04); hi = Math.min(1, hi + 0.04);
      const W = 620, rowH = 24, m = { l: 300, r: 64 }, H = (rows.length + 2) * rowH + 44;
      const s = svgRoot($("waterfall"), W, H, "SHAP waterfall for the selected patient");
      const xs = function (v) { return m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r); };
      add(s, "line", { x1: xs(sh.base), x2: xs(sh.base), y1: 6, y2: H - 40, class: "guide" });
      add(s, "text", { x: m.l - 10, y: 6 + 16, "text-anchor": "end", class: "muted" }, "average risk of the reference patients");
      add(s, "circle", { cx: xs(sh.base), cy: 6 + 11, r: 4, class: "dot c-ink" });
      add(s, "text", { x: W - 6, y: 6 + 16, "text-anchor": "end", class: "val" }, sh.base.toFixed(3));
      rows.forEach(function (r, i) {
        const y = 6 + (i + 1) * rowH;
        add(s, "text", { x: m.l - 10, y: y + 16, "text-anchor": "end" }, r.label);
        add(s, "rect", { x: xs(Math.min(r.a, r.b)), y: y + 5, width: Math.max(1, Math.abs(xs(r.b) - xs(r.a))), height: rowH - 9, rx: 2,
                         class: r.v >= 0 ? "f-alert" : "f-safe" });
        add(s, "text", { x: W - 6, y: y + 16, "text-anchor": "end", class: "val" }, signed(r.v, 3));
      });
      const yEnd = 6 + (rows.length + 1) * rowH;
      add(s, "text", { x: m.l - 10, y: yEnd + 16, "text-anchor": "end", class: "strong" }, "this patient");
      add(s, "circle", { cx: xs(sh.full), cy: yEnd + 11, r: 5, class: "dot " + (sh.full >= 0.5 ? "c-alert" : "c-safe") });
      add(s, "text", { x: W - 6, y: yEnd + 16, "text-anchor": "end", class: "val strong" }, sh.full.toFixed(3));
      const ticks = [lo, (lo + hi) / 2, hi].map(function (v) { return Math.round(v * 100) / 100; });
      axisX(s, xs, H - 40, ticks, "predicted risk", function (v) { return v.toFixed(2); });
    }
    function runLime() {
      const w = X.lime(heartRisk, current, HD.pool, limeSeed, 800);
      drawBars($("lime"), w.map(function (v, j) { return { label: F[j].label, v: v }; }), 8, 3, "LIME weights");
      const rho = X.spearman(w.map(Math.abs), lastShap.phi.map(Math.abs));
      const top = topK(w, 5);
      let text = "Rank agreement with SHAP (Spearman correlation of absolute values): " + rho.toFixed(2) + ".";
      if (lastTop) text += " Variables shared with the previous run's top five: " + top.filter(function (j) { return lastTop.indexOf(j) >= 0; }).length + " of 5.";
      lastTop = top;
      $("lime-note").textContent = text;
    }
    select.addEventListener("change", function () { load(parseInt(select.value, 10)); });
    $("reset-patient").addEventListener("click", function () { load(parseInt(select.value, 10)); });
    $("lime-again").addEventListener("click", function () { limeSeed += 1; runLime(); });
    $("cf-run").addEventListener("click", function () {
      const p0 = heartRisk(current), out = $("cf-out");
      if (p0 < 0.5) { out.textContent = "The model already predicts no disease for these values. Choose a patient with a risk of at least 0.50."; return; }
      const res = X.counterfactual(heartRisk, current, cfSpec());
      if (!res.success) { out.textContent = "No counterfactual exists within the plausible ranges of the variables that may change. Try another patient."; return; }
      const rows = F.map(function (ft, j) { return { ft: ft, a: current[j], b: res.x[j] }; }).filter(function (c) { return c.a !== c.b; })
        .map(function (c) { return "<tr><td>" + c.ft.label + "</td><td>" + valueText(c.ft, c.a) + "</td><td>" + valueText(c.ft, c.b) + "</td></tr>"; }).join("");
      out.innerHTML = "<table><thead><tr><th>Variable</th><th>Now</th><th>Counterfactual</th></tr></thead><tbody>" + rows +
        "</tbody></table><p>Risk " + p0.toFixed(2) + " becomes " + res.p.toFixed(2) + ". Only resting blood pressure, cholesterol, maximum heart rate, ST depression, exercise-induced angina and the vessel count may change, within the range seen in the training data. A very small change that flips the prediction reveals a sharp step in the model.</p>";
      markTask("explain");
    });
    const start = part2Patient();
    select.value = String(start);
    load(start);
  }

  /* ---------- 3. Shapley by hand ---------- */
  function initShapley() {
    const F = HD.features, psel = $("sh-patient"), sels = [$("sh-a"), $("sh-b"), $("sh-c")];
    fillPatients(psel);
    const defaults = ["chest_pain_type", "thallium_scan", "major_vessels"];
    const defaultIdx = defaults.map(function (k) { return F.map(function (ft) { return ft.key; }).indexOf(k); });
    sels.forEach(function (s, k) {
      F.forEach(function (ft, j) { const o = document.createElement("option"); o.value = j; o.textContent = ft.label; s.appendChild(o); });
      s.value = defaultIdx[k];
      s.addEventListener("change", update);
    });
    psel.addEventListener("change", update);
    function update() {
      const players = sels.map(function (s) { return parseInt(s.value, 10); });
      const names = players.map(function (j) { return F[j].label; });
      if (players[0] === players[1] || players[0] === players[2] || players[1] === players[2]) {
        $("sh-coalitions").innerHTML = ""; $("sh-orders").innerHTML = "";
        $("sh-result").textContent = "Choose three different variables.";
        return;
      }
      const x = HD.patients[parseInt(psel.value, 10)], g = X.coalitionGame(heartRisk, x, HD.background, players);
      let html = "<thead><tr><th>Players present</th><th>Payoff v(S): mean predicted risk</th></tr></thead><tbody>";
      for (let S2 = 0; S2 < 8; S2++) {
        const members = names.filter(function (_, p) { return (S2 >> p) & 1; });
        html += "<tr><td>" + (members.length ? members.join(", ") : "nobody") + "</td><td>" + g.values[S2].toFixed(3) + "</td></tr>";
      }
      $("sh-coalitions").innerHTML = html + "</tbody>";
      html = "<thead><tr><th>Order of arrival</th>" + names.map(function (n) { return "<th>" + n + "</th>"; }).join("") + "</tr></thead><tbody>";
      g.orders.forEach(function (o) {
        html += "<tr><td>" + o.order.map(function (p) { return names[p]; }).join(", then ") + "</td>" +
          o.gains.map(function (v) { return "<td>" + signed(v, 3) + "</td>"; }).join("") + "</tr>";
      });
      html += "<tr class='sum'><td>Average over the six orders: the Shapley value</td>" + g.phi.map(function (v) { return "<td>" + signed(v, 3) + "</td>"; }).join("") + "</tr>";
      $("sh-orders").innerHTML = html + "</tbody>";
      const total = g.phi.reduce(function (a, b) { return a + b; }, 0);
      $("sh-result").textContent = "The three values add up to " + signed(total, 3) + ", exactly the payoff with all three present (" +
        g.values[7].toFixed(3) + ") minus the payoff with none of them (" + g.values[0].toFixed(3) + "). This efficiency property is what makes the credit assignment fair.";
      const own = players.slice().sort().join(",") !== defaultIdx.slice().sort().join(",");
      if (own) markTask("shapley");
    }
    update();
  }

  /* ---------- 4. Spoof the sensor ---------- */
  function initSpoof() {
    const G = D.cgm, tau = G.threshold, B = G.budget;
    const risk = function (w) { return X.proba(G.model, X.cgmFeatures(w)); };
    const decide = function (w) { return risk(w) >= tau; };
    const names = ["glucose now", "mean over 60 min", "lowest in 60 min", "highest in 60 min", "variability (SD)",
                   "trend, last 15 min", "trend, last 30 min", "change, last 5 min", "change over 60 min", "trend acceleration"];
    let k = 0, truth = null, reported = null, revealed = false, queries = 0, animating = false, view = null, drag = -1;

    function load(i) {
      k = (i + G.examples.length) % G.examples.length;
      truth = G.examples[k].past.slice();
      reported = truth.slice();
      queries = 0;
      revealed = false;
      $("reveal").setAttribute("aria-pressed", "false");
      $("attack-note").textContent = "";
      $("ex-label").textContent = "Example " + (k + 1) + " of " + G.examples.length;
      build();
      refresh(true);
    }

    function build() {
      const W = 660, H = 330, m = { l: 48, r: 16, t: 16, b: 44 };
      const all = truth.concat(G.examples[k].future);
      const lo = Math.max(40, Math.floor((Math.min.apply(null, all) - B - 15) / 10) * 10);
      const hi = Math.min(400, Math.ceil((Math.max.apply(null, all) + B + 15) / 10) * 10);
      const s = svgRoot($("cgm"), W, H, "CGM readings of the last hour and the next half hour");
      const xs = function (t) { return m.l + ((t + 60) / 95) * (W - m.l - m.r); };
      const ys = function (v) { return H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b); };
      const step = hi - lo > 150 ? 40 : 20;
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        add(s, "text", { x: m.l - 6, y: ys(v) + 4, class: "tick", "text-anchor": "end" }, String(v));
      }
      axisX(s, xs, H - m.b, [-60, -45, -30, -15, 0, 15, 30], "minutes relative to the alert decision");
      add(s, "line", { x1: m.l, x2: W - m.r, y1: ys(70), y2: ys(70), class: "hypo" });
      add(s, "text", { x: W - m.r - 4, y: ys(70) - 6, "text-anchor": "end", class: "hypo-label" }, "70 mg/dL");
      add(s, "line", { x1: xs(0), x2: xs(0), y1: m.t, y2: H - m.b, class: "guide" });
      const times = truth.map(function (_, i) { return -55 + 5 * i; });
      const band = times.map(function (t, i) { return xs(t) + "," + ys(Math.min(400, truth[i] + B)); })
        .concat(times.slice().reverse().map(function (t, r) { const i = truth.length - 1 - r; return xs(t) + "," + ys(Math.max(40, truth[i] - B)); }));
      const bandEl = add(s, "polygon", { points: band.join(" "), class: "band" });
      add(s, "polyline", { points: times.map(function (t, i) { return xs(t) + "," + ys(truth[i]); }).join(" "), class: "line c-muted" });
      const future = add(s, "g", { class: "future" });
      const fut = G.examples[k].future, ft = fut.map(function (_, i) { return 5 + 5 * i; });
      add(future, "polyline", { points: [xs(0) + "," + ys(truth[truth.length - 1])].concat(ft.map(function (t, i) { return xs(t) + "," + ys(fut[i]); })).join(" "), class: "line dashed c-amber" });
      ft.forEach(function (t, i) { add(future, "rect", { x: xs(t) - 4, y: ys(fut[i]) - 4, width: 8, height: 8, class: "f-amber" }); });
      add(future, "text", { x: xs(17.5), y: m.t + 14, "text-anchor": "middle", class: "future-label" }, "what happened next");
      const repLine = add(s, "polyline", { points: "", class: "line c-rep" });
      const handles = times.map(function (t, i) {
        const h = add(s, "circle", { cx: xs(t), cy: ys(reported[i]), r: 7, class: "handle", tabindex: 0,
                                    "aria-label": "Reading at " + t + " minutes; arrow keys change it" });
        h.addEventListener("pointerdown", function (e) { if (animating) return; drag = i; if (s.setPointerCapture) s.setPointerCapture(e.pointerId); e.preventDefault(); });
        h.addEventListener("keydown", function (e) {
          if (animating || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          e.preventDefault();
          setReading(i, reported[i] + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 5 : 1));
          refresh(true);
        });
        return h;
      });
      s.addEventListener("pointermove", function (e) {
        if (drag < 0) return;
        const rect = s.getBoundingClientRect();
        if (!rect.height) return;
        const yy = ((e.clientY - rect.top) / rect.height) * H;
        setReading(drag, lo + ((H - m.b - yy) / (H - m.t - m.b)) * (hi - lo));
        refresh(false);
      });
      const end = function () { if (drag >= 0) { drag = -1; refresh(true); } };
      s.addEventListener("pointerup", end);
      s.addEventListener("pointercancel", end);
      view = { xs: xs, ys: ys, times: times, repLine: repLine, handles: handles, future: future, band: bandEl, lo: lo, hi: hi };
    }

    function setReading(i, v) {
      let lo = view.lo, hi = view.hi;
      if ($("budget").checked) { lo = Math.max(lo, truth[i] - B); hi = Math.min(hi, truth[i] + B); }
      reported[i] = Math.round(Math.min(hi, Math.max(lo, v)));
    }

    function refresh(heavy) {
      view.repLine.setAttribute("points", view.times.map(function (t, i) { return view.xs(t) + "," + view.ys(reported[i]); }).join(" "));
      view.handles.forEach(function (h, i) {
        h.setAttribute("cy", view.ys(reported[i]));
        h.setAttribute("class", "handle" + (reported[i] !== truth[i] ? " moved" : ""));
      });
      view.future.style.display = revealed ? "" : "none";
      view.band.style.display = $("budget").checked ? "" : "none";
      const r = risk(reported), on = r >= tau;
      $("alarm").className = "lab-alarm " + (on ? "on" : "off");
      $("alarm").textContent = on ? "Low glucose soon" : "No alert";
      $("m-risk").textContent = r.toFixed(3);
      $("m-thr").textContent = tau.toFixed(3);
      $("m-queries").textContent = String(queries);
      let changed = 0;
      reported.forEach(function (v, i) { changed = Math.max(changed, Math.abs(v - truth[i])); });
      $("m-change").textContent = changed.toFixed(1) + " mg/dL";
      if (!heavy) return;
      if (on) {
        $("m-margin").textContent = "not applicable while the alert is on";
        $("m-flag").textContent = "";
        $("m-flag").className = "lab-flag";
      } else {
        const margin = X.marginLower(decide, reported, 20, 0.2);
        $("m-margin").textContent = margin >= 20 ? "more than 20 mg/dL" : margin.toFixed(1) + " mg/dL lower would trigger it";
        const suspicious = margin < G.margin_cut;
        $("m-flag").textContent = suspicious
          ? "Suspicious: fewer than 5% of genuine near-threshold hours are this close to an alert."
          : "The silence is not unusually close to the alert boundary.";
        $("m-flag").className = "lab-flag" + (suspicious ? " warn" : "");
        if (suspicious && changed > 0 && decide(truth)) markTask("spoof");
      }
      const sh = X.exactShapley(function (z) { return X.proba(G.model, z); }, X.cgmFeatures(reported), G.background);
      drawBars($("cgm-shap"), sh.phi.map(function (v, j) { return { label: names[j], v: v }; }), 6, 3, "Exact Shapley values of the alert model");
    }

    $("ex-prev").addEventListener("click", function () { if (!animating) load(k - 1); });
    $("ex-next").addEventListener("click", function () { if (!animating) load(k + 1); });
    $("cgm-reset").addEventListener("click", function () { if (animating) return; reported = truth.slice(); queries = 0; $("attack-note").textContent = ""; refresh(true); });
    $("budget").addEventListener("change", function () { refresh(false); });
    $("reveal").addEventListener("click", function () {
      revealed = !revealed;
      $("reveal").setAttribute("aria-pressed", String(revealed));
      refresh(false);
    });
    $("attack").addEventListener("click", function () {
      if (animating) return;
      const x0 = truth.slice();
      if (!decide(x0)) { $("attack-note").textContent = "The alert is not active for the true readings."; return; }
      const lower = x0.map(function (v) { return Math.max(40, v - B); }), upper = x0.map(function (v) { return Math.min(400, v + B); });
      const rand = X.mulberry32(1000 + k), candidates = [upper, x0.map(function (v, i) { return v + (B * i) / (x0.length - 1); })];
      for (let n = 0; n < 60; n++) candidates.push(x0.map(function (_, i) { return lower[i] + rand() * (upper[i] - lower[i]); }));
      const res = X.hsja(decide, x0, lower, upper, candidates, { seed: k + 1, iterations: 12, directions: 40 });
      if (!res.success) {
        queries = res.queries;
        refresh(true);
        $("attack-note").textContent = "No silent input exists among the attacker's starting points; this alert survives a budget of " + B + " mg/dL. Try the next example.";
        return;
      }
      animating = true;
      let step = 0;
      const tick = function () {
        reported = res.trace[step].slice();
        queries = Math.round((res.queries * (step + 1)) / res.trace.length);
        const last = step === res.trace.length - 1;
        refresh(last);
        step++;
        if (!last) { setTimeout(tick, reduceMotion ? 0 : 180); return; }
        animating = false;
        $("attack-note").textContent = "Silenced after " + res.queries + " yes-or-no queries, with a largest change of " +
          res.linf.toFixed(1) + " mg/dL per reading. Show what happened next to see the low that followed.";
      };
      tick();
    });
    load(0);
  }

  /* ---------- 5. Audit: one referral threshold, two groups ---------- */
  let auditCache = null;
  function auditData() {
    if (auditCache) return auditCache;
    const N = D.nb7, women = [], men = [];
    for (let i = 0; i < N.y.length; i++) (N.sex_male[i] === 1 ? men : women).push(i);
    auditCache = { N: N, women: women, men: men, all: women.concat(men), boot: null, bands: null };
    return auditCache;
  }
  function rates(idx, P, Y, t) {
    let tp = 0, fn = 0, tn = 0, fp = 0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], pos = P[i] >= t;
      if (Y[i] === 1) { if (pos) tp++; else fn++; } else if (pos) fp++; else tn++;
    }
    return { sens: tp + fn ? tp / (tp + fn) : NaN, spec: tn + fp ? tn / (tn + fp) : NaN, pos: tp + fn, n: idx.length };
  }
  /* 1,000 resamples within each group (women first, as in NB7), seeded; resamples with a single class are skipped. */
  function bootstrap() {
    const A = auditData();
    if (A.boot) return A.boot;
    const rand = X.mulberry32(42), out = {};
    [["women", A.women], ["men", A.men]].forEach(function (g) {
      const idx = g[1], m = idx.length, samples = [];
      for (let b = 0; b < 1000; b++) {
        const s = new Array(m);
        let pos = 0;
        for (let k = 0; k < m; k++) { s[k] = idx[Math.floor(rand() * m)]; pos += A.N.y[s[k]]; }
        if (pos > 0 && pos < m) samples.push(s);
      }
      out[g[0]] = samples;
    });
    A.boot = out;
    return out;
  }
  function interval(samples, t, key) {
    const N = auditData().N, v = [];
    for (let b = 0; b < samples.length; b++) { const r = rates(samples[b], N.p_oof, N.y, t)[key]; if (isFinite(r)) v.push(r); }
    return [quantile(v, 0.025), quantile(v, 0.975)];
  }
  function flips(idx, t) {
    const N = auditData().N;
    let c = 0;
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if ((N.p_full[i] >= t) !== (N.p_flip[i] >= t)) c++; }
    return c;
  }
  function auditAt(t, withCI) {
    const A = auditData(), N = A.N;
    const w = rates(A.women, N.p_oof, N.y, t), m = rates(A.men, N.p_oof, N.y, t), all = rates(A.all, N.p_oof, N.y, t);
    const r = { t: t, w: w, m: m, all: all, gap: Math.abs(w.sens - m.sens), nW: A.women.length, nM: A.men.length, n: A.all.length,
                flipW: flips(A.women, t), flipM: flips(A.men, t), flipAll: flips(A.all, t), ci: null };
    if (withCI) {
      const B = bootstrap();
      r.ci = { w: { sens: interval(B.women, t, "sens"), spec: interval(B.women, t, "spec") },
               m: { sens: interval(B.men, t, "sens"), spec: interval(B.men, t, "spec") } };
    }
    return r;
  }
  function ciText(c) { return "[" + c[0].toFixed(2) + ", " + c[1].toFixed(2) + "]"; }
  function gridThresholds() { const ts = []; for (let k = 10; k <= 90; k++) ts.push(k / 100); return ts; }
  function narrowestGap() {
    let best = null;
    gridThresholds().forEach(function (t) { const r = auditAt(t, false); if (!best || r.gap < best.gap - 1e-12) best = { t: t, gap: r.gap }; });
    return best;
  }

  function modelCard(r) {
    const N = auditData().N, nb4 = D.nb4, today = new Date();
    const prev = N.y.reduce(function (a, b) { return a + b; }, 0) / N.y.length;
    const cell = function (g, key) { return g[key].toFixed(2) + (r.ci ? " " + ciText(r.ci[g === r.w ? "w" : "m"][key]) : ""); };
    const lines = [
      "# Model card: coronary artery disease risk, IEEE CARS 2026 workshop example", "",
      "Generated in the XAI Lab on " + dateText(today) + ". Teaching material; not a medical device.", "",
      "## Intended use", "Education and research on explainable AI. The model has not been clinically validated and must not be used for decisions about patients.", "",
      "## Model and data",
      "Gradient boosting ensemble (150 trees of depth 3) predicting angiographic coronary artery disease from 13 clinical variables (NB7). " +
      "UCI Cleveland heart disease data: " + r.n + " patients referred for angiography, " + r.nW + " women and " + r.nM + " men, " + pct(prev, 0) + " with disease.", "",
      "## Performance",
      "Out-of-fold AUROC " + N.oof_auroc.toFixed(3) + " (five-fold cross-validation). At the referral threshold " + r.t.toFixed(2) +
      ": sensitivity " + r.all.sens.toFixed(2) + ", specificity " + r.all.spec.toFixed(2) + ".", "",
      "## Subgroups at threshold " + r.t.toFixed(2), "",
      "| Group | n | With disease | Sensitivity | Specificity |", "|---|---|---|---|---|",
      "| Women | " + r.nW + " | " + r.w.pos + " | " + cell(r.w, "sens") + " | " + cell(r.w, "spec") + " |",
      "| Men | " + r.nM + " | " + r.m.pos + " | " + cell(r.m, "sens") + " | " + cell(r.m, "spec") + " |", "",
      r.ci ? "Brackets: 95 percent bootstrap intervals, 1,000 seeded resamples within each group." : "Bootstrap intervals were not computed for this card.", "",
      "Gap in sensitivity between women and men: " + (100 * r.gap).toFixed(1) + " percentage points.", "",
      "## Fairness probe",
      "Flipping only the recorded sex changes " + pct(r.flipAll / r.n) + " of decisions at threshold " + r.t.toFixed(2) + " (" + r.flipW + " of " + r.nW + " women, " + r.flipM + " of " + r.nM + " men).", "",
      "## Robustness and security",
      nb4 ? "In the workshop's CGM study (NB4), a decision-based attacker silenced " + pct(nb4.success_rate, 0) + " of " + nb4.attacks +
        " correct alerts with changes of at most " + D.cgm.budget + " mg/dL per reading; the counterfactual margin separated manipulated from genuine windows with AUROC " +
        nb4.auroc_margin.toFixed(2) + ". Comparable tests of this model would be part of a deployment." : "Attack tests as in NB4 to NB6 would be part of a deployment.", "",
      "## Limitations", "Historical single-centre data, a referral population, few women (" + r.nW + ", of whom " + r.w.pos + " with disease), no external validation.", "",
      "## Change control", "Any retraining repeats this audit, the explanation checks of NB2 and the attack tests of NB4 to NB6, with a documented comparison against this card.", "",
      "Contact: Prof. Dr. Utku Köse, github.com/utkukose", ""
    ];
    return lines.join("\n");
  }
  function download(name, text) {
    const blob = typeof Blob === "function" ? new Blob([text], { type: "text/markdown;charset=utf-8" }) : null;
    let href = null;
    try { if (blob && window.URL && URL.createObjectURL) href = URL.createObjectURL(blob); } catch (e) { href = null; }
    if (!href) href = "data:text/markdown;charset=utf-8," + encodeURIComponent(text);
    const a = S.el("a", { href: href, download: name, hidden: "" });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); if (href.indexOf("blob:") === 0) { try { URL.revokeObjectURL(href); } catch (e) { /* nothing to release */ } } }, 1500);
  }

  function initAudit() {
    const slider = $("au-thr"), A = auditData(), base = auditAt(0.5, false);
    let showCI = false, moved = false, last = null;
    function update() {
      const t = Math.round(parseFloat(slider.value) * 100) / 100, r = auditAt(t, showCI);
      last = r;
      $("au-thr-out").textContent = t.toFixed(2);
      const narrower = t !== 0.5 && r.gap < base.gap - 1e-9;
      $("au-stats").innerHTML = stat(pct(r.all.sens), "sensitivity, all " + r.n + " patients") + stat(pct(r.all.spec), "specificity, all " + r.n + " patients") +
        stat((100 * r.gap).toFixed(1), "points between the sensitivity of women and men", narrower ? "safe" : "alert");
      const rowFor = function (g, key, cls, name) {
        const ci = r.ci ? r.ci[key] : null;
        return "<tr><th scope=\"row\"><span class=\"lab-sw " + cls + "\"></span>" + name + "<span class=\"lab-ci\">n = " + g.n + "</span></th><td>" + g.pos + "</td><td>" + g.sens.toFixed(2) +
          (ci ? '<span class="lab-ci">' + ciText(ci.sens) + "</span>" : "") + "</td><td>" + g.spec.toFixed(2) + (ci ? '<span class="lab-ci">' + ciText(ci.spec) + "</span>" : "") + "</td></tr>";
      };
      $("au-table").innerHTML = "<thead><tr><th>Group</th><th>With disease</th><th>Sensitivity</th><th>Specificity</th></tr></thead><tbody>" +
        rowFor(r.w, "w", "w", "Women") + rowFor(r.m, "m", "m", "Men") + "</tbody>";
      $("au-gap").textContent = t === 0.5
        ? "At 0.50 the gap in sensitivity is " + (100 * base.gap).toFixed(1) + " points. Move the threshold to find a narrower one."
        : "At " + t.toFixed(2) + " the gap is " + (100 * r.gap).toFixed(1) + " points, " + (narrower ? "narrower than" : r.gap > base.gap + 1e-9 ? "wider than" : "the same as") +
          " the " + (100 * base.gap).toFixed(1) + " points at 0.50.";
      $("au-flip").innerHTML = stat(pct(r.flipAll / r.n), "of decisions change when only the recorded sex is flipped", "amber") +
        stat(r.flipW + " of " + r.nW, "women recorded as men") + stat(r.flipM + " of " + r.nM, "men recorded as women");
      drawAudit(r);
      $("au-card").textContent = modelCard(r);
      if (moved && narrower) markTask("audit");
    }
    function save() {
      const r = last;
      if (!r) return;
      S.store.set("lab:audit", { t: r.t, sensWomen: Math.round(r.w.sens * 1000) / 1000, sensMen: Math.round(r.m.sens * 1000) / 1000,
        gap: Math.round(r.gap * 1000) / 1000, gapAt50: Math.round(base.gap * 1000) / 1000, flipShare: Math.round((r.flipAll / r.n) * 1000) / 1000, intervals: !!r.ci });
    }
    slider.addEventListener("input", function () { moved = true; update(); });
    slider.addEventListener("change", function () { moved = true; update(); save(); });
    $("au-boot").addEventListener("click", function () {
      showCI = true;
      bands();
      update();
      save();
      const B = bootstrap();
      $("au-boot-note").textContent = "95 percent bootstrap intervals from " + thousands(B.women.length) + " resamples of the " + A.women.length + " women and " +
        thousands(B.men.length) + " of the " + A.men.length + " men (seed 42). With " + last.w.pos + " women with disease, their interval is wide.";
      $("au-boot").textContent = "Intervals computed";
      $("au-boot").disabled = true;
    });
    $("au-card-dl").addEventListener("click", function () {
      const r = auditAt(last ? last.t : 0.5, true);
      download("model_card.md", modelCard(r));
      S.store.set("lab:card", true);
      $("au-boot-note").textContent = "Model card downloaded as model_card.md, with the numbers at threshold " + r.t.toFixed(2) + " and bootstrap intervals.";
    });
    update();
  }
  /* Interval bands of both groups at every threshold, computed once. */
  function bands() {
    const A = auditData();
    if (A.bands) return A.bands;
    const B = bootstrap(), ts = gridThresholds();
    A.bands = { ts: ts, w: ts.map(function (t) { return interval(B.women, t, "sens"); }), m: ts.map(function (t) { return interval(B.men, t, "sens"); }) };
    return A.bands;
  }
  let auditShown = null, resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (auditShown && !$("panel-audit").hidden) drawAudit(auditShown); }, 150);
  });
  function drawAudit(r) {
    auditShown = r;
    const A = auditData(), N = A.N, box = $("au-chart"), cw = box.clientWidth || 0;
    const W = cw > 200 ? Math.round(Math.min(640, cw)) : 560, H = Math.round(Math.max(240, Math.min(310, W * 0.55))), m = { l: 40, r: 14, t: 22, b: 44 };
    const s = svgRoot(box, W, H, "Sensitivity for women and men at every referral threshold, with the current threshold marked");
    const xs = function (v) { return m.l + ((v - 0.1) / 0.8) * (W - m.l - m.r); }, ys = function (v) { return H - m.b - v * (H - m.t - m.b); };
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      add(s, "line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), class: "gridline" });
      add(s, "text", { x: m.l - 6, y: ys(v) + 4, class: "tick", "text-anchor": "end" }, String(v));
    });
    axisX(s, xs, H - m.b, W < 420 ? [0.1, 0.5, 0.9] : [0.1, 0.3, 0.5, 0.7, 0.9], "referral threshold", function (v) { return v.toFixed(1); });
    const ts = gridThresholds();
    if (A.bands) {
      [["w", "au-wb"], ["m", "au-mb"]].forEach(function (g) {
        const band = A.bands[g[0]];
        const pts = ts.map(function (t, i) { return xs(t) + "," + ys(band[i][1]); }).concat(ts.slice().reverse().map(function (t, j) { return xs(t) + "," + ys(band[ts.length - 1 - j][0]); }));
        add(s, "polygon", { points: pts.join(" "), class: g[1] });
      });
    }
    [[A.women, "au-w"], [A.men, "au-m"]].forEach(function (g) {
      let d = "";
      ts.forEach(function (t, i) {
        const v = ys(rates(g[0], N.p_oof, N.y, t).sens);
        d += i === 0 ? "M" + xs(t) + " " + v : " H" + xs(t) + " V" + v;
      });
      add(s, "path", { d: d, class: "line " + g[1] });
    });
    if (r.t !== 0.5) {
      add(s, "line", { x1: xs(0.5), x2: xs(0.5), y1: m.t, y2: H - m.b, class: "guide" });
      add(s, "text", { x: xs(0.5), y: m.t - 7, class: "tick", "text-anchor": "middle" }, "0.50");
    }
    const x = xs(r.t);
    add(s, "line", { x1: x, x2: x, y1: m.t, y2: H - m.b, class: "threshold" });
    const yw = ys(r.w.sens), ym = ys(r.m.sens), right = x < W - m.r - 130, gx = right ? x + 12 : x - 12;
    add(s, "path", { d: "M" + (gx + (right ? -4 : 4)) + " " + ym + " H" + gx + " V" + yw + " H" + (gx + (right ? -4 : 4)), class: "au-gap" });
    const ty = Math.min(H - m.b - 8, Math.max(yw, ym) + 18);
    add(s, "text", { x: gx + (right ? 2 : -2), y: ty, class: "au-gapt", "text-anchor": right ? "start" : "end" }, "gap " + (100 * r.gap).toFixed(1) + " points");
    add(s, "circle", { cx: x, cy: ym, r: 6, class: "au-dm" });
    add(s, "circle", { cx: x, cy: yw, r: 6, class: "au-dw" });
    $("au-legend").innerHTML = '<span><i class="w"></i>women (n = ' + r.nW + ')</span><span><i class="m"></i>men (n = ' + r.nM + ")</span>" +
      (A.bands ? '<span><i class="b"></i>95 percent bootstrap intervals</span>' : "");
  }

  /* ---------- 6. Debrief: the discharge summary of the session ---------- */
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function two(n) { return (n < 10 ? "0" : "") + n; }
  function dateText(d) { return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }
  function pageOf(id) { return S.PAGES.filter(function (p) { return p.id === id; })[0] || S.PAGES[0]; }
  function humanise(v) { const s = String(v).replace(/[-_]+/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function asShare(v) { return num(v) ? (v > 1 ? v / 100 : v) : null; }
  function field(o, k) { return o && num(o[k]) ? o[k] : null; }
  const ANSWERS = {
    "p1-deploy": { yes: "Yes", no: "No", depends: "It depends" },
    "p1-calibration": { network: "The neural network", logreg: "Logistic regression", both: "Both" },
    "p1-shortcut": { yes: "Yes", no: "No" },
    "p2-winner": { black: "The black box", blackbox: "The black box", "black-box": "The black box", glass: "A glass box", glassbox: "A glass box", "glass-box": "A glass box", tie: "A tie" },
    "p2-lime": { always: "Always", usually: "Usually", not: "Not necessarily", notnecessarily: "Not necessarily", "not-necessarily": "Not necessarily", never: "Not necessarily" },
    "p2-deletion": { shap: "SHAP", lime: "LIME", random: "Random" },
    "p3-silence": { rarely: "Rarely", sometimes: "Sometimes", mostly: "Most of the time" },
    "p3-signal": { shap: "The attribution pattern (SHAP anomaly)", margin: "The counterfactual margin", neither: "Neither" },
    "p3-sepsis": { none: "Not at all", hours: "A few hours", whole: "Through the whole stay" },
    "p4-women": { higher: "Higher", same: "About the same", lower: "Lower" }
  };
  function answer(all, key) {
    const v = all["poll:" + key];
    if (typeof v !== "string" || !v || v.length > 60) return null;
    const map = ANSWERS[key] || {};
    return { value: v.toLowerCase(), text: map[v] || map[v.toLowerCase()] || humanise(v) };
  }
  function said(a) { return a ? 'Answered <span class="dx-ans">' + esc(a.text) + "</span>" : ""; }
  function verdict(ok, yes, no) {
    if (ok === null || ok === undefined) return "";
    return '<span class="dx-v ' + (ok ? "yes" : "no") + '">' + (ok ? yes || "Agrees with the data." : no || "The data say otherwise.") + "</span>";
  }
  function join(parts) { return parts.filter(Boolean).join("<br>"); }
  function signalName(v) {
    const s = String(v || "").toLowerCase();
    return s.indexOf("margin") >= 0 ? "counterfactual margin" : s.indexOf("shap") >= 0 ? "SHAP anomaly" : s ? humanise(s).toLowerCase() : "";
  }

  let REF = null;
  function references() {
    if (REF) return REF;
    const R = {}, y = D.wdbc.y, p = D.wdbc.p, c50 = confusion(y, p, 0.5);
    R.p1 = { acc: (c50.tp + c50.tn) / y.length, missed: c50.fn, cancers: c50.tp + c50.fn, workups: c50.fp, five: null };
    for (let k = 98; k >= 1; k--) {
      const c = confusion(y, p, k / 100);
      if (c.fn <= 5) { R.p1.five = { t: k / 100, missed: c.fn, workups: c.fp }; break; }
    }
    const cards = (D.nb1 && D.nb1.cards) || [];
    R.p1.cards = { n: cards.length, cancers: cards.filter(function (c) { return c.truth === 1; }).length,
                   conf: cards.length ? Math.floor(1000 * Math.min.apply(null, cards.map(function (c) { return 1 - c.p; }))) / 10 : null };
    R.p1.ece = { nn: X.ece(y, p), lr: X.ece(y, D.wdbc.p_lr) };
    R.p1.sc = D.nb1 && D.nb1.shortcut ? D.nb1.shortcut : null;

    const gb = ((D.nb2 && D.nb2.glassbox) || []).slice().sort(function (a, b) { return b.auroc - a.auroc; });
    const black = gb.filter(function (g) { return g.kind === "black box"; })[0] || null;
    const glass = gb.filter(function (g) { return g.kind !== "black box"; })[0] || null;
    R.p2 = { gb: gb, black: black, glass: glass, glassWins: !!(black && glass && glass.auroc >= black.auroc - 0.005) };
    const i2 = part2Patient(), x2 = HD.patients[i2], cf = X.counterfactual(heartRisk, x2, cfSpec());
    R.p2.patient = i2;
    R.p2.cf = { success: cf.success, from: heartRisk(x2), to: cf.p, changes: HD.features.map(function (ft, j) { return { ft: ft, a: x2[j], b: cf.x[j] }; })
      .filter(function (c) { return c.a !== c.b; }) };
    let prev = null, minO = 5;
    for (let s = 1; s <= 10; s++) {
      const top = topK(X.lime(heartRisk, x2, HD.pool, s, 800), 5);
      if (prev) minO = Math.min(minO, top.filter(function (j) { return prev.indexOf(j) >= 0; }).length);
      prev = top;
    }
    R.p2.limeMin = minO;
    R.p2.deletion = null;

    R.p4 = { at50: auditAt(0.5, true), narrow: narrowestGap() };
    REF = R;
    return R;
  }
  /* Deletion test for the Part 2 patient, as on the Part 2 page: variables replaced by the reference patients' values. */
  function deletionRanking() {
    const R = references();
    if (R.p2.deletion) return R.p2.deletion;
    const x = HD.patients[R.p2.patient], M = x.length;
    const curve = function (order) {
      const gone = new Array(M).fill(false), out = [];
      const value = function () {
        let acc = 0;
        for (let b = 0; b < HD.background.length; b++) { const row = HD.background[b]; acc += heartRisk(x.map(function (v, j) { return gone[j] ? row[j] : v; })); }
        return acc / HD.background.length;
      };
      out.push(value());
      order.forEach(function (j) { gone[j] = true; out.push(value()); });
      let a = 0;
      for (let k = 1; k < out.length; k++) a += (out[k - 1] + out[k]) / 2;
      return a / (out.length - 1);
    };
    const sh = X.exactShapley(heartRisk, x, HD.background);
    const shap = curve(topK(sh.phi, M)), limeArea = curve(topK(X.lime(heartRisk, x, HD.pool, 1, 800), M));
    const rand = X.mulberry32(7);
    let rnd = 0;
    for (let r = 0; r < 10; r++) {
      const o = []; for (let j = 0; j < M; j++) o.push(j);
      for (let i = M - 1; i > 0; i--) { const k = Math.floor(rand() * (i + 1)); const tmp = o[i]; o[i] = o[k]; o[k] = tmp; }
      rnd += curve(o) / 10;
    }
    const ranked = [["shap", "SHAP", shap], ["lime", "LIME (seed 1)", limeArea], ["random", "a random order", rnd]].sort(function (a, b) { return a[2] - b[2]; });
    R.p2.deletion = ranked;
    return ranked;
  }

  function cfChanges(list) {
    return list.map(function (c) {
      return c.ft.label + " " + valueText(c.ft, c.a).replace(/ (mmHg|mg\/dL|bpm|mm|years)$/, "") + " to " + valueText(c.ft, c.b);
    }).join("; ");
  }
  function ownChanges(ch) {
    if (Array.isArray(ch)) {
      const parts = ch.slice(0, 6).map(function (c) {
        if (typeof c === "string" || typeof c === "number") return esc(c);
        const o = obj(c);
        if (!o) return "";
        const name = o.label || o.feature || o.name || o.key || "";
        const a = o.from !== undefined ? o.from : o.a, b = o.to !== undefined ? o.to : o.b;
        return esc(name) + (a !== undefined && b !== undefined ? " " + esc(a) + " to " + esc(b) : "");
      }).filter(Boolean);
      return parts.length ? parts.join("; ") : null;
    }
    if (num(ch)) return plural(ch, "variable changed", "variables changed");
    if (typeof ch === "string" && ch.length < 160) return esc(ch);
    return null;
  }

  function sectionHtml(part, n, title, meta, rows, finding) {
    return '<section class="dx-sec" data-part="' + part + '"><div class="dx-sec-head"><h3><span class="dx-n" aria-hidden="true">' + n + "</span>" + title +
      "</h3><p>" + meta + '</p></div><table class="dx-table"><thead><tr><th scope="col">Item</th><th scope="col">Recorded in this browser</th><th scope="col">Reference</th></tr></thead><tbody>' +
      rows.join("") + "</tbody></table>" + (finding ? '<p class="dx-assess"><strong>Finding.</strong> ' + finding + "</p>" : "") + "</section>";
  }
  function rowHtml(label, own, ref, missingHref, missingText) {
    const cell = own || '<span class="dx-none">Not recorded in this browser.</span> <a class="dx-go" href="' + missingHref + '">' + missingText + "</a>";
    return '<tr><th scope="row">' + label + '</th><td data-label="Recorded in this browser">' + cell + '</td><td data-label="Reference">' + ref + "</td></tr>";
  }
  function partRow(part) {
    const pg = pageOf(part);
    return function (label, own, ref) { return rowHtml(label, own, ref, pg.href, "Open " + pg.label); };
  }

  function beats(all, R) {
    const out = [], nb4 = D.nb4;
    const th = obj(all["p1:threshold"]), tT = field(th, "t"), tM = field(th, "missed");
    out.push(tT !== null && tM !== null
      ? { v: tM + " missed", c: "cancers missed at the chosen threshold of " + tT.toFixed(2), own: true }
      : { v: R.p1.missed + " missed", c: "cancers behind " + pct(R.p1.acc) + " accuracy at 0.50", own: false });
    const cfo = obj(all["p2:counterfactual"]), lime = obj(all["p2:lime"]);
    if (field(cfo, "from") !== null && field(cfo, "to") !== null && cfo.success !== false) out.push({ v: cfo.from.toFixed(2) + " to " + cfo.to.toFixed(2), c: "risk before and after the counterfactual", own: true });
    else if (field(lime, "minOverlap") !== null && field(lime, "runs") !== null && lime.runs >= 2) out.push({ v: lime.minOverlap + " of 5", c: "lowest top-five overlap in " + lime.runs + " LIME runs", own: true });
    else if (R.p2.glass && R.p2.black) out.push({ v: R.p2.glass.auroc.toFixed(3), c: "AUROC of the best glass box, against " + R.p2.black.auroc.toFixed(3) + " for the black box", own: false });
    else out.push({ v: "", c: "", own: false });
    const sil = obj(all["p3:silenced"]), tried = field(sil, "tried"), silenced = field(sil, "silenced");
    out.push(tried !== null && silenced !== null && tried > 0
      ? { v: silenced + " of " + tried, c: "alerts silenced by own attacks", own: true }
      : nb4 ? { v: pct(nb4.success_rate, 0), c: "of " + nb4.attacks + " correct alerts silenced within " + D.cgm.budget + " mg/dL", own: false } : { v: "", c: "", own: false });
    const au = obj(all["p4:audit"]), sw = asShare(field(au, "sensWomen")), sm = asShare(field(au, "sensMen"));
    out.push(sw !== null && sm !== null
      ? { v: sw.toFixed(2) + " vs " + sm.toFixed(2), c: "sensitivity for women and men in the audit", own: true }
      : { v: R.p4.at50.w.sens.toFixed(2) + " vs " + R.p4.at50.m.sens.toFixed(2), c: "sensitivity for women and men at 0.50", own: false });
    return out;
  }
  function drawStrip(all, R) {
    const strip = $("dx-strip"), list = beats(all, R), ids = ["p1", "p2", "p3", "p4"];
    strip.innerHTML = "";
    const labels = [];
    ids.forEach(function (id, i) {
      const pg = pageOf(id), b = list[i];
      const box = S.el("div", { class: "dx-beat", "data-part": id });
      box.innerHTML = '<p class="dx-bt"><strong>' + pg.label + " · " + pg.role + "</strong><span>" + pg.when + '</span></p><div class="dx-bsvg"></div>' +
        '<div class="dx-ann"><p class="dx-bv">' + esc(b.v) + '</p><p class="dx-bc">' + esc(b.c) + '</p><p class="dx-bs' + (b.own ? " own" : "") + '">' +
        (b.own ? "recorded in this browser" : "reference result") + "</p></div>";
      strip.appendChild(box);
      const s = svgRoot(box.querySelector(".dx-bsvg"), 240, 72);
      s.setAttribute("aria-hidden", "true");
      if (id === "p3") add(s, "path", { d: "M0 46 H40", class: "brk" });
      add(s, "path", { d: (id === "p3" ? "M40 46" : "M0 46") + " H72 l8 -8 l8 8 H112 l6 -38 l10 60 l6 -22 H160 q10 -14 20 0 H240", class: "tr" });
      labels.push(pg.label + ": " + b.v + " " + b.c);
    });
    strip.setAttribute("aria-label", "Rhythm strip of the morning. " + labels.join(". ") + ".");
  }

  function renderSummary(all) {
    const R = references(), nb4 = D.nb4, nb5 = D.nb5, nb6 = D.nb6;
    const html = [];

    /* Part 1: Admission */
    let rows = [], row = partRow("p1");
    const deploy = answer(all, "p1-deploy");
    rows.push(row("Would you deploy this model?", said(deploy),
      "At 0.50 the network reaches " + pct(R.p1.acc) + " accuracy and misses " + R.p1.missed + " of " + R.p1.cancers + " cancers."));
    const th = obj(all["p1:threshold"]), tT = field(th, "t"), tM = field(th, "missed"), tW = field(th, "workups");
    rows.push(row("Threshold chosen", tT !== null ? tT.toFixed(2) + ": " + (tM !== null ? plural(tM, "cancer", "cancers") + " missed" : "") +
      (tW !== null ? ", " + plural(tW, "unnecessary work-up", "unnecessary work-ups") : "") : null,
      R.p1.five ? "Five or fewer missed cancers only at " + R.p1.five.t.toFixed(2) + ", with " + R.p1.five.workups + " unnecessary work-ups." : "No threshold misses five or fewer cancers."));
    const cards = obj(all["p1:cards"]), cF = field(cards, "found"), cO = field(cards, "of"), cX = field(cards, "falseMarks");
    rows.push(row("Wrong and sure", cF !== null ? cF + " of " + (cO !== null ? cO : R.p1.cards.cancers) + " cancers found" +
      (cX !== null ? ", " + plural(cX, "benign biopsy", "benign biopsies") + " marked" : "") : null,
      R.p1.cards.n ? R.p1.cards.cancers + " of the " + R.p1.cards.n + " cards were cancers, each called benign with at least " + R.p1.cards.conf.toFixed(1) + "% certainty." : "The cards are not in the data file."));
    const cal = answer(all, "p1-calibration");
    rows.push(row("Does 0.9 mean 90 percent?", said(cal),
      "Expected calibration error: network " + R.p1.ece.nn.toFixed(3) + ", logistic regression " + R.p1.ece.lr.toFixed(3) + "."));
    const sc = R.p1.sc, shortcut = answer(all, "p1-shortcut");
    const dropped = sc ? sc.external.with_site < sc.internal.with_site - 0.05 : null;
    rows.push(row("Will the site-aware model keep its accuracy abroad?", shortcut ? join([said(shortcut), verdict(dropped === null ? null : (shortcut.value === "no") === dropped)]) : null,
      sc ? "AUROC " + sc.internal.with_site.toFixed(2) + " at home and " + sc.external.with_site.toFixed(2) + " at the external hospital; without the site " +
        sc.internal.without_site.toFixed(2) + " and " + sc.external.without_site.toFixed(2) + ". The site variable was constructed for the experiment." : "Shortcut results are not in the data file."));
    const mand = obj(all["p1:mandates"]), mS = field(mand, "score"), mO = field(mand, "of");
    rows.push(row("Three mandates", mS !== null ? mS + " of " + (mO !== null ? mO : 3) + " statements judged correctly" : null,
      "GDPR, the EU AI Act and FDA guidance; high-risk obligations apply from 2 December 2027 (Annex III) and 2 August 2028 (medical devices)."));
    html.push(sectionHtml("p1", 1, "Admission", "Part 1 · 10:00 to 10:20 · NB1", rows,
      "An accuracy of " + pct(R.p1.acc) + " hides " + R.p1.missed + " missed cancers, errors made with near certainty" +
      (sc ? ", and a shortcut whose AUROC falls from " + sc.internal.with_site.toFixed(2) + " at home to " + sc.external.with_site.toFixed(2) + " at another hospital." : ".")));

    /* Part 2: Examination */
    rows = []; row = partRow("p2");
    const win = answer(all, "p2-winner"), gbList = R.p2.gb.map(function (g) { return esc(g.name) + (g.kind === "black box" ? " (black box)" : "") + " " + g.auroc.toFixed(3); }).join("; ");
    const winTruth = R.p2.glassWins ? "glass" : "black";
    rows.push(row("Black box or glass box: which wins?", win ? join([said(win), verdict(win.value.indexOf("tie") >= 0 ? null : win.value.indexOf(winTruth) >= 0)]) : null,
      gbList ? "Test AUROC: " + gbList + "." : "Glass-box results are not in the data file."));
    const limeA = answer(all, "p2-lime"), lime = obj(all["p2:lime"]), lR = field(lime, "runs"), lO = field(lime, "minOverlap");
    rows.push(row("Will LIME give the same top five twice?", join([said(limeA), lR !== null ? plural(lR, "run", "runs") + (lO !== null ? ", lowest overlap " + lO + " of 5" : "") : ""]),
      "Over ten seeds for the Part 2 patient, consecutive runs shared as few as " + R.p2.limeMin + " of the top five variables. Exact Shapley values never change."));
    const cfo = obj(all["p2:counterfactual"]), cfFrom = field(cfo, "from"), cfTo = field(cfo, "to");
    let cfTxt = cfo ? ownChanges(cfo.changes) : null;
    if (cfo && Array.isArray(cfo.variables) && cfo.variables.length) {
      const names = cfo.variables.slice(0, 6).map(function (k) { const ft = HD.features.filter(function (f) { return f.key === k; })[0]; return ft ? ft.label : humanise(k); });
      cfTxt = plural(cfo.variables.length, "variable", "variables") + " changed: " + esc(names.join(", ").toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }));
    }
    const cfWho = cfo && num(cfo.patient) ? "Test patient " + cfo.patient + ". " : "";
    rows.push(row("Smallest change that flips the decision", cfo && (cfTxt || cfFrom !== null) ? join([cfWho + (cfTxt || ""), cfFrom !== null && cfTo !== null ? "Risk " + cfFrom.toFixed(2) + " to " + cfTo.toFixed(2) +
      (cfo.success === false ? ", no flip found" : "") : ""]) : null,
      R.p2.cf.success ? "Test patient " + R.p2.patient + ": " + esc(cfChanges(R.p2.cf.changes)) + " lowers the risk from " + R.p2.cf.from.toFixed(2) + " to " + R.p2.cf.to.toFixed(2) + "."
        : "No counterfactual within the plausible ranges for the Part 2 patient."));
    const del = answer(all, "p2-deletion"), dr = obj(all["p2:deletion"]);
    const dA = dr && num(dr.shap) && num(dr.lime) && num(dr.random) ? [["shap", "SHAP", dr.shap], ["lime", "LIME", dr.lime], ["random", "random", dr.random]].sort(function (a, b) { return a[2] - b[2]; }) : null;
    rows.push(row("Which ordering makes the risk fall fastest?", del || dA ? join([del ? said(del) + (dA ? "" : '<span id="dx-del-v"></span>') : "",
      dA && del ? verdict(del.value.indexOf(dA[0][0]) >= 0, "Agrees with the run on the page.", "The run on the page differs.") : "",
      dA ? "Area under the deletion curve: " + dA.map(function (d) { return d[1] + " " + d[2].toFixed(3); }).join(", ") + " (lower is more faithful)" : ""]) : null,
      '<span id="dx-del">Computing the deletion test for the Part 2 patient.</span>'));
    const san = obj(all["p2:sanity"]), sS = field(san, "shapAt100"), sI = field(san, "inputAt100");
    rows.push(row("Does the explanation depend on the model?", sS !== null ? "With every tree randomised: SHAP agreement " + sS.toFixed(2) + (sI !== null ? ", input-only explanation " + sI.toFixed(2) : "") : null,
      "An explanation that barely changes when the model is destroyed was never explaining the model."));
    const flipOne = R.p2.cf.success && R.p2.cf.changes.length === 1 && R.p2.cf.changes[0].ft.type === "num";
    html.push(sectionHtml("p2", 2, "Examination", "Part 2 · 10:20 to 10:45 · NB2, NB3", rows,
      (R.p2.glass && R.p2.black ? "The best glass box (" + esc(R.p2.glass.name.toLowerCase()) + ", AUROC " + R.p2.glass.auroc.toFixed(3) + ") " +
        (R.p2.glassWins ? "matches or beats" : "trails") + " the black box (" + R.p2.black.auroc.toFixed(3) + "); " : "") +
      "LIME needs repeated runs" + (flipOne ? ", and a change of " + Math.abs(R.p2.cf.changes[0].a - R.p2.cf.changes[0].b) + " " + R.p2.cf.changes[0].ft.unit + " in " +
        R.p2.cf.changes[0].ft.label.toLowerCase() + " flips the Part 2 patient." : ".")));

    /* Part 3: Stress test */
    rows = []; row = partRow("p3");
    const sil = answer(all, "p3-silence");
    const silTruth = nb4 ? (nb4.success_rate >= 0.6 ? "mostly" : nb4.success_rate <= 0.1 ? "rarely" : null) : null;
    rows.push(row("Can a correct alert be silenced?", sil ? join([said(sil), verdict(silTruth ? sil.value === silTruth : null)]) : null,
      nb4 ? "The NB4 attack on " + nb4.attacks + " correct alerts: " + pct(nb4.success_rate) + " silenced within " + D.cgm.budget + " mg/dL; median largest change " +
        nb4.median_linf + " mg/dL, median " + thousands(nb4.median_queries) + " queries." : "Study results are not in the data file."));
    const so = obj(all["p3:silenced"]), soT = field(so, "tried"), soS = field(so, "silenced"), soL = field(so, "medianLinf");
    rows.push(row("Own attacks", soT !== null ? (soS !== null ? soS + " of " + soT : soT) + " alerts silenced" + (soL !== null ? ", median largest change " + soL.toFixed(1) + " mg/dL" : "") : null,
      nb4 ? "One silenced alert in the study was followed by glucose of " + nb4.lowest_after_silenced + " mg/dL." : ""));
    const sig = answer(all, "p3-signal"), det = obj(all["p3:detect"]), dD = asShare(field(det, "detected")), dF = asShare(field(det, "falseAlarms"));
    const sigTruth = nb4 ? (nb4.auroc_margin > nb4.auroc_shap + 0.05 ? "margin" : nb4.auroc_shap > nb4.auroc_margin + 0.05 ? "shap" : null) : null;
    rows.push(row("Which signal exposes the manipulation?", sig || dD !== null ? join([said(sig), sig ? verdict(sigTruth ? sig.value === sigTruth : null) : "",
      dD !== null ? pct(dD, 0) + " detected" + (dF !== null ? ", " + pct(dF, 0) + " false alarms" : "") + (det.signal ? " (" + esc(signalName(det.signal)) + ")" : "") : ""]) : null,
      nb4 ? "AUROC: counterfactual margin " + nb4.auroc_margin.toFixed(3) + ", SHAP anomaly " + nb4.auroc_shap.toFixed(3) + "." : ""));
    const camp = obj(all["p3:campaign"]), cS = asShare(field(camp, "share"));
    const cA = camp && (camp.alarmAfter === null || num(camp.alarmAfter)) ? camp.alarmAfter : undefined;
    rows.push(row("Watch the campaign", camp && (cS !== null || cA !== undefined) ? (cS !== null ? pct(cS, 0) + " manipulated windows: " : "") +
      (cA === null ? "no alarm" : cA !== undefined ? "alarm after " + plural(cA, "window", "windows") : "") + (camp.signal ? " (" + esc(signalName(camp.signal)) + ")" : "") : null,
      "A single flag proves little. On the flags of the counterfactual margin, the Page-Hinkley test catches a campaign of one manipulated window in five, usually within a dozen or so windows; on the flags of the SHAP anomaly it fires in only a minority of streams."));
    const seps = answer(all, "p3-sepsis"), sp = obj(all["p3:sepsis"]);
    let spTxt = "";
    if (sp && ("delayHours" in sp)) {
      spTxt = (num(sp.patient) ? "Stay " + sp.patient + ": " : "") + (sp.delayHours === null ? "alert suppressed for the whole stay" :
        num(sp.delayHours) ? "alert delayed by " + plural(sp.delayHours, "hour", "hours") : "");
    }
    rows.push(row("How long can a sepsis alert be delayed?", seps || spTxt ? join([said(seps), spTxt]) : null,
      nb5 ? "NB5, " + nb5.attacked + " attacked stays: " + pct(nb5.suppressed_share) + " suppressed for the whole stay; when the alert still fired, the median delay was " +
        (nb5.median_delay_h === null ? "not defined" : plural(nb5.median_delay_h, "hour", "hours")) + "; " + plural(nb5.lost_early_alerts, "early alert", "early alerts") + " lost." : "Sepsis results are not in the data file."));
    const af = obj(all["p3:af"]), afB = field(af, "budget");
    const curve = nb6 && Array.isArray(nb6.curve) ? nb6.curve : [];
    const atB = afB !== null ? curve.filter(function (c) { return c.budget === afB; })[0] : null;
    rows.push(row("Hide atrial fibrillation", afB !== null ? afB + " ms per beat: notification " + (af.silenced === true ? "silenced" : af.silenced === false ? "still raised" : "not recorded") : null,
      curve.length ? (atB ? "At " + afB + " ms the NB6 attack silenced " + pct(atB.share, 0) + " of " + nb6.attacked + " correct notifications. " : "") +
        "Silenced share: " + curve.filter(function (c) { return [30, 90, 180].indexOf(c.budget) >= 0; }).map(function (c) { return pct(c.share, 0) + " at " + c.budget + " ms"; }).join(", ") + "."
        : "AF results are not in the data file."));
    html.push(sectionHtml("p3", 3, "Stress test", "Part 3 · 11:00 to 11:30 · NB4, NB5, NB6", rows,
      nb4 ? "Within sensor noise, " + pct(nb4.success_rate, 0) + " of correct alerts fell silent while every validation metric stayed as reported; " +
        (nb4.auroc_margin >= nb4.auroc_shap ? "the counterfactual margin exposed the manipulation better than the SHAP anomaly" : "the SHAP anomaly exposed the manipulation better than the counterfactual margin") +
        " (AUROC " + Math.max(nb4.auroc_margin, nb4.auroc_shap).toFixed(2) + " against " + Math.min(nb4.auroc_margin, nb4.auroc_shap).toFixed(2) + ")." : ""));

    /* Part 4: Discharge */
    rows = []; row = partRow("p4");
    const quiz = obj(all["p4:quiz"]), qS = field(quiz, "score"), qO = field(quiz, "of");
    rows.push(row("Where does each system sit under the AI Act?", qS !== null ? qS + " of " + (qO !== null ? qO : 8) + " systems placed correctly" : null,
      "Sepsis early warning in a medical device is high risk; its obligations apply from 2 August 2028."));
    const a50 = R.p4.at50, women = answer(all, "p4-women"), au = obj(all["p4:audit"]);
    const aW = asShare(field(au, "sensWomen")), aM = asShare(field(au, "sensMen")), aF = asShare(field(au, "flipShare"));
    const overlap = a50.ci ? a50.ci.w.sens[1] >= a50.ci.m.sens[0] && a50.ci.m.sens[1] >= a50.ci.w.sens[0] : false;
    const wTruth = a50.w.sens < a50.m.sens - 0.02 ? "lower" : a50.w.sens > a50.m.sens + 0.02 ? "higher" : "same";
    rows.push(row("Sensitivity for women compared with men", women || aW !== null ? join([said(women),
      women ? (women.value === wTruth ? '<span class="dx-v yes">Agrees with the point estimate' + (overlap ? "; the intervals overlap." : ".") + "</span>" : verdict(false)) : "",
      aW !== null && aM !== null ? "Audit: women " + aW.toFixed(2) + ", men " + aM.toFixed(2) + (aF !== null ? "; the sex flip changes " + pct(aF) + " of decisions" : "") : ""]) : null,
      "At 0.50: women " + a50.w.sens.toFixed(2) + " " + ciText(a50.ci.w.sens) + ", men " + a50.m.sens.toFixed(2) + " " + ciText(a50.ci.m.sens) + "; " +
        a50.w.pos + " of the " + a50.nW + " women had disease."));
    const la = obj(all["lab:audit"]), laT = field(la, "t"), laG = field(la, "gap");
    rows.push(rowHtml("Audit in this lab", laT !== null && laG !== null ? laT.toFixed(2) + ": gap " + (100 * laG).toFixed(1) + " points (" + (100 * R.p4.at50.gap).toFixed(1) + " at 0.50)" : null,
      "Narrowest gap between 0.10 and 0.90: " + (100 * R.p4.narrow.gap).toFixed(1) + " points at " + R.p4.narrow.t.toFixed(2) + ".", "#audit", "Open the Audit tab"));
    const card4 = all["p4:card"] === true, cardLab = all["lab:card"] === true;
    rows.push(row("Model card", card4 || cardLab ? [card4 ? "Written on the Part 4 page" : "", cardLab ? "downloaded in this lab" : ""].filter(Boolean).join(", ") + "." : null,
      "Out-of-fold AUROC " + D.nb7.oof_auroc.toFixed(3) + "; intended for education and research, not a medical device."));
    const ov = obj(all["p4:override"]), oD = field(ov, "decisions"), oO = field(ov, "overrides");
    rows.push(row("Human oversight", oD !== null ? plural(oD, "decision", "decisions") + " logged" + (oO !== null ? ", " + plural(oO, "override", "overrides") : "") : null,
      "Article 14 asks for human oversight, Article 12 for logs that make each decision traceable."));
    html.push(sectionHtml("p4", 4, "Discharge", "Part 4 · 11:30 to 11:50 · NB7", rows,
      "With " + a50.nW + " women, " + a50.w.pos + " of them with disease, the sensitivity interval for women runs from " + a50.ci.w.sens[0].toFixed(2) + " to " +
      a50.ci.w.sens[1].toFixed(2) + "; the data cannot settle the gap, and that uncertainty belongs in the model card."));

    /* Ward round */
    const tk = obj(all["lab:tasks"]) || {}, vis = obj(all.visited) || {}, op = obj(all.opened) || {};
    const nbPart = { NB1: "p1", NB2: "p2", NB3: "p2", NB4: "p3", NB5: "p3", NB6: "p3", NB7: "p4" };
    const nT = TASKS.filter(function (t) { return tk[t.id] === true; }).length;
    const nV = S.PAGES.filter(function (p) { return vis[p.id] === true; }).length;
    const nbs = Object.keys(S.NOTEBOOKS), nO = nbs.filter(function (k) { return op[k] === true; }).length;
    const chip = function (on, part, text, title) {
      return '<span class="dx-chip' + (on ? " on" : "") + '"' + (part ? ' data-part="' + part + '"' : "") + (title ? ' title="' + esc(title) + '"' : "") + ">" + text +
        '<span class="sr-only">' + (on ? ", done" : ", not done") + "</span></span>";
    };
    html.push('<section class="dx-sec" data-part="fin"><div class="dx-sec-head"><h3><span class="dx-n" aria-hidden="true">5</span>Ward round</h3><p>XAI Lab · 11:50 to 12:00</p></div>' +
      '<dl class="dx-trail"><dt>Tasks done</dt><dd>' + TASKS.map(function (t) { return chip(tk[t.id] === true, t.part === "fin" ? "" : t.part, t.tab, t.text); }).join("") + "</dd>" +
      "<dt>Pages visited</dt><dd>" + S.PAGES.map(function (p) { return chip(vis[p.id] === true, /^p[1-4]$/.test(p.id) ? p.id : "", p.label, p.title); }).join("") + "</dd>" +
      "<dt>Notebooks opened</dt><dd>" + nbs.map(function (k) { return chip(op[k] === true, nbPart[k], k, S.NOTEBOOKS[k].title); }).join("") + "</dd></dl>" +
      '<p class="dx-assess"><strong>Finding.</strong> ' + nT + " of " + TASKS.length + " ward round tasks done, " + nV + " of " + S.PAGES.length + " pages visited and " +
      nO + " of " + nbs.length + " notebooks opened in this browser.</p></section>");
    $("dx-body").innerHTML = html.join("");
    return { tasks: nT, pages: nV, notebooks: nO };
  }

  function renderMeta(counts) {
    const now = new Date();
    const items = [["Patient", "The model"], ["Ward", "IEEE CARS 2026 workshop, online session"], ["Session", "28 October 2026, 10:00 to 12:00"],
      ["Ward round", counts.tasks + " of " + TASKS.length + " tasks done"], ["Record", "Kept in this browser only"],
      ["Generated", dateText(now) + ", " + two(now.getHours()) + ":" + two(now.getMinutes())]];
    $("dx-meta").innerHTML = items.map(function (it) { return "<div><dt>" + it[0] + "</dt><dd>" + it[1] + "</dd></div>"; }).join("");
  }
  function renderLinks(all) {
    const op = obj(all.opened) || {}, nbs = $("dx-nbs"), more = $("dx-more");
    nbs.innerHTML = "";
    Object.keys(S.NOTEBOOKS).forEach(function (nb) {
      const li = S.el("li");
      const a = S.el("a", { href: S.colabUrl(nb), target: "_blank", rel: "noopener" }, "<strong>" + nb + "</strong> " + S.NOTEBOOKS[nb].title);
      a.addEventListener("click", function () { markOpened(nb); });
      li.appendChild(a);
      if (op[nb] === true) li.appendChild(S.el("span", { class: "op" }, "opened"));
      nbs.appendChild(li);
    });
    const repo = "https://github.com/" + S.REPO;
    more.innerHTML = [
      [repo, "The workshop repository on GitHub", "notebooks, data sources, the dashboard and this site"],
      [repo + "/blob/main/REFERENCES.md", "REFERENCES.md", "every reference cited in the workshop"],
      ["https://github.com/utkukose/xai-healthcare-NB-lecture", "Explainable AI in Healthcare", "the graduate course, 23 notebooks in six modules"],
      ["https://pypi.org/project/gemex/", "GEMEX on PyPI", "the geometric explainer used in Part 3"]
    ].map(function (l) { return '<li><a href="' + l[0] + '" target="_blank" rel="noopener">' + l[1] + '</a><br><span class="s">' + l[2] + "</span></li>"; }).join("");
  }

  let debriefPlayed = false, debriefRendered = false, delTimer = null;
  function fillDeletion(all) {
    const target = $("dx-del");
    if (!target) return;
    const ranked = deletionRanking();
    target.textContent = "For test patient " + references().p2.patient + ", the risk falls fastest in the " + ranked[0][1] + " order, then " +
      (ranked[1][0] === "random" ? ranked[1][1] : "the " + ranked[1][1] + " order") + ", then " + (ranked[2][0] === "random" ? ranked[2][1] : "the " + ranked[2][1] + " order") + ".";
    const del = answer(all, "p2-deletion"), v = $("dx-del-v");
    if (del && v) v.outerHTML = "<br>" + verdict(del.value.indexOf(ranked[0][0]) >= 0, "Agrees with the reference run.", "The reference run differs.");
  }
  function renderDebrief(animate) {
    const all = S.store.all(), R = references();
    const counts = renderSummary(all);
    renderMeta(counts);
    drawStrip(all, R);
    renderLinks(all);
    debriefRendered = true;
    const strip = $("dx-strip"), stampEl = $("dx-stamp");
    strip.classList.remove("armed", "go");
    stampEl.classList.remove("armed", "go");
    if (animate) {
      strip.classList.add("armed");
      stampEl.classList.add("armed");
      strip.querySelectorAll(".dx-beat").forEach(function (b, i) {
        const tr = b.querySelector(".tr");
        let len = 420;
        try { if (tr.getTotalLength) len = Math.ceil(tr.getTotalLength()) + 2; } catch (e) { len = 420; }
        tr.style.setProperty("--len", String(len));
        tr.style.setProperty("--d", (0.25 + i * 0.6) + "s");
        const brk = b.querySelector(".brk");
        if (brk) brk.style.setProperty("--d", (0.25 + i * 0.6) + "s");
        b.querySelector(".dx-ann").style.setProperty("--da", (0.55 + i * 0.6) + "s");
      });
      stampEl.style.setProperty("--d", "2.85s");
      void strip.offsetWidth;
      requestAnimationFrame(function () { requestAnimationFrame(function () { strip.classList.add("go"); stampEl.classList.add("go"); }); });
    }
    clearTimeout(delTimer);
    delTimer = setTimeout(function () { fillDeletion(all); }, animate ? 3400 : 30);
  }
  function openDebrief() {
    markTask("debrief");
    renderDebrief(!debriefPlayed && !reduceMotion);
    debriefPlayed = true;
  }

  $("dx-print").addEventListener("click", function () {
    if (!debriefRendered) renderDebrief(false);
    if (typeof window.print === "function") window.print();
  });
  $("dx-clear").addEventListener("click", function () {
    let ok = false;
    try { ok = window.confirm("Clear every answer and result of the workshop recorded in this browser? This cannot be undone."); } catch (e) { ok = false; }
    if (!ok) { $("dx-note").textContent = "Nothing was cleared."; return; }
    S.store.clear();
    $("dx-note").textContent = "Cleared. The page reloads with an empty record.";
    try { window.location.reload(); } catch (e) { /* reload unavailable */ }
  });
  /* The summary always prints on the paper theme. */
  let themeBeforePrint = null;
  window.addEventListener("beforeprint", function () {
    if (!debriefRendered) renderDebrief(false);
    themeBeforePrint = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", "light");
  });
  window.addEventListener("afterprint", function () {
    if (themeBeforePrint) document.documentElement.setAttribute("data-theme", themeBeforePrint);
    themeBeforePrint = null;
  });

  /* ---------- start: facts, the ward round, and the tab named in the address ---------- */
  fillFacts();
  buildTasks();
  function tabFromHash() {
    return tabs.filter(function (t) { return "#" + t.id.replace("tab-", "") === window.location.hash; })[0];
  }
  window.addEventListener("hashchange", function () {
    const t = tabFromHash();
    if (t && t.getAttribute("aria-selected") !== "true") { openTab(t); scrollToNode($("bench")); }
  });
  const first = tabFromHash();
  openTab(first || tabs[0]);
  if (first && $("bench").scrollIntoView) $("bench").scrollIntoView({ block: "start" });
})();
