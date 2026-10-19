/* Part 3: attacks on three medical alert models and the explanation-based signals that expose them.
   Uses window.LAB_DATA (site-data.js), window.XAICore (lab-core.js) and window.XAISite (site.js). */
(function () {
  "use strict";
  const S = window.XAISite, X = window.XAICore, D = window.LAB_DATA;
  if (!S || !X || !D || !D.cgm || !D.nb4 || !D.nb5 || !D.nb6) return;
  const G = D.cgm, N4 = D.nb4, N5 = D.nb5, N6 = D.nb6;
  const RM = S.reduceMotion, add = S.add;
  const $ = function (id) { return document.getElementById(id); };
  const MINUS = "−";

  /* ---------- numbers ---------- */
  function signed(v, d) { return (v < 0 ? MINUS : "+") + Math.abs(v).toFixed(d); }
  function percent(v, d) { return (100 * v).toFixed(d || 0); }
  function grouped(v) { return Math.round(v).toLocaleString("en-US"); }
  function round3(v) { return Math.round(v * 1000) / 1000; }
  function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function median(a) {
    if (!a.length) return null;
    const s = a.slice().sort(function (p, q) { return p - q; }), h = s.length >> 1;
    return s.length % 2 ? s[h] : 0.5 * (s[h - 1] + s[h]);
  }
  function quantile(a, p) {
    const s = a.slice().sort(function (x, y) { return x - y; }), h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.min(lo + 1, s.length - 1);
    return s[lo] + (s[hi] - s[lo]) * (h - lo);
  }
  function largestChange(a, b) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function ease(v) { return v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2; }
  function hoursText(n) { return n === 1 ? "1 hour" : n + " hours"; }
  function niceStep(span, target) {
    const raw = span / Math.max(1, target), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }
  function decimalsOf(step) {
    for (let d = 0; d < 4; d++) { const s = step * Math.pow(10, d); if (Math.abs(Math.round(s) - s) < 1e-9) return d; }
    return 3;
  }
  function ticks(lo, hi, target) {
    const st = niceStep(hi - lo, target || 4), out = [];
    for (let v = Math.ceil(lo / st - 1e-9) * st; v <= hi + 1e-9; v += st) out.push(Math.round(v / st) * st);
    out.dec = decimalsOf(st);
    return out;
  }
  function niceCeil(v) { const st = niceStep(v, 4); return Math.ceil(v / st - 1e-9) * st; }
  function pts(list) { return list.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "); }

  /* ---------- layout helpers: charts are drawn at their real width so text keeps its size ---------- */
  function boxWidth(node, fallback, lo, hi) {
    const w = node && node.clientWidth ? node.clientWidth : fallback;
    return Math.round(Math.max(lo, Math.min(hi, w)));
  }
  const resizers = [];
  let resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resizers.forEach(function (f) { f(); }); }, 160);
  });
  function onWidth(node, draw) {
    let last = node.clientWidth;
    resizers.push(function () { const w = node.clientWidth; if (Math.abs(w - last) > 2) { last = w; draw(); } });
  }
  function yGrid(svg, ys, values, x0, x1, fmt) {
    values.forEach(function (v) {
      add(svg, "line", { x1: x0, x2: x1, y1: ys(v), y2: ys(v), class: "gridline" });
      add(svg, "text", { x: x0 - 6, y: ys(v) + 4, "text-anchor": "end", class: "tick" }, fmt ? fmt(v) : v.toFixed(values.dec || 0));
    });
  }
  function xAxis(svg, xs, y, values, fmt, label, x0, x1) {
    add(svg, "line", { x1: x0, x2: x1, y1: y, y2: y, class: "axis" });
    values.forEach(function (v) {
      add(svg, "line", { x1: xs(v), x2: xs(v), y1: y, y2: y + 4, class: "axis" });
      add(svg, "text", { x: xs(v), y: y + 17, "text-anchor": "middle", class: "tick" }, fmt ? fmt(v) : String(v));
    });
    if (label) add(svg, "text", { x: (x0 + x1) / 2, y: y + 34, "text-anchor": "middle", class: "axis-label" }, label);
  }
  function scrollToId(id) {
    const t = $(id);
    if (t && t.scrollIntoView) t.scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "start" });
  }
  function setPressed(group, value) {
    group.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-value") === String(value))); });
  }

  /* ---------- predict first: the evidence below a poll opens once it is answered ---------- */
  function gate(key) {
    const box = document.querySelector('[data-gate="' + key + '"]'), note = document.querySelector('[data-gate-note="' + key + '"]');
    if (box) { box.classList.add("locked"); box.setAttribute("inert", ""); }
    return function open() {
      if (box) { box.classList.remove("locked"); box.removeAttribute("inert"); }
      if (note) note.hidden = true;
    };
  }

  /* ---------- the decision-based attack of lab-core.js, run in small steps so the page stays responsive ---------- */
  function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(s); }
  function norm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); }
  function* hsjaSteps(decide, x0, lower, upper, candidates, opts) {
    const rand = X.mulberry32(opts.seed || 7), nIter = opts.iterations || 12, nDirs = opts.directions || 40, d = x0.length;
    const st = { queries: 0, x: null, phase: "search" };
    const alert = function (z) { st.queries++; return decide(z); };
    const clip = function (z) { return z.map(function (v, i) { return Math.min(upper[i], Math.max(lower[i], v)); }); };
    const blend = function (b, t) { return x0.map(function (v, i) { return v + t * (b[i] - v); }); };
    let start = null, best = Infinity;
    for (const c0 of candidates) {
      const c = clip(c0);
      if (!alert(c)) { const dc = dist(c, x0); if (dc < best) { best = dc; start = c; } }
    }
    yield st;
    if (!start) return { success: false, queries: st.queries };
    st.x = start.slice(); st.phase = "start";
    yield st;
    const toBoundary = function (free) {
      let lo = 0, hi = 1;
      while (hi - lo > 1e-3) { const mid = 0.5 * (lo + hi); if (alert(blend(free, mid))) lo = mid; else hi = mid; }
      return blend(free, hi);
    };
    let xb = toBoundary(start);
    st.x = xb.slice(); st.phase = "boundary";
    yield st;
    for (let t = 1; t <= nIter; t++) {
      const dd = dist(xb, x0);
      if (dd < 1e-6) break;
      const radius = Math.max(0.1 * dd / Math.sqrt(t), 1e-3);
      const U = [], phi = [];
      for (let k = 0; k < nDirs; k++) {
        const u = [];
        for (let i = 0; i < d; i++) u.push(X.gaussian(rand));
        const nu = norm(u);
        for (let i = 0; i < d; i++) u[i] /= nu;
        U.push(u);
        phi.push(alert(clip(xb.map(function (v, i) { return v + radius * u[i]; }))) ? -1 : 1);
      }
      const avg = phi.reduce(function (a, b) { return a + b; }, 0) / nDirs;
      const v = new Array(d).fill(0);
      const varied = phi.some(function (p) { return p !== phi[0]; });
      for (let k = 0; k < nDirs; k++) {
        const c = varied ? phi[k] - avg : phi[0];
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
      st.x = xb.slice(); st.phase = "iteration";
      yield st;
    }
    let linf = 0;
    for (let i = 0; i < d; i++) linf = Math.max(linf, Math.abs(xb[i] - x0[i]));
    return { success: true, x: xb, queries: st.queries, linf: linf, l2: dist(xb, x0) };
  }
  function runSteps(gen, onStep, delay, onDone) {
    function next() {
      const r = gen.next();
      if (r.done) { onDone(r.value); return; }
      onStep(r.value);
      setTimeout(next, RM ? 0 : delay);
    }
    setTimeout(next, 0);
  }

  const SILENCE_LABELS = { rarely: "Rarely", sometimes: "Sometimes", mostly: "Most of the time" };
  const cgmRisk = function (w) { return X.proba(G.model, X.cgmFeatures(w)); };
  const cgmDecide = function (w) { return cgmRisk(w) >= G.threshold; };
  function cgmCandidates(x0, k) {
    const lower = x0.map(function (v) { return Math.max(40, v - G.budget); }), upper = x0.map(function (v) { return Math.min(400, v + G.budget); });
    const rand = X.mulberry32(1000 + k), cands = [upper, x0.map(function (v, i) { return v + (G.budget * i) / (x0.length - 1); })];
    for (let n = 0; n < 60; n++) cands.push(x0.map(function (_, i) { return lower[i] + rand() * (upper[i] - lower[i]); }));
    return { lower: lower, upper: upper, cands: cands };
  }

  /* =====================================================================================================
     Cold open: a correct alert on a bedside monitor, silenced by a real decision-based attack.
     ===================================================================================================== */
  function initColdOpen() {
    const box = $("p3-open-chart"), alarm = $("p3-open-alarm"), cap = $("p3-open-cap"), fig = box.parentNode;
    const prior = S.store.get("poll:p3-silence", null);
    if (prior && SILENCE_LABELS[prior]) {
      const p = $("p3-break-answer");
      p.textContent = "Your answer at the break: " + SILENCE_LABELS[prior];
      p.hidden = false;
    }
    /* The same hour and the same attack as the break screen. */
    let pick = null, spare = null;
    for (let k = 0; k < G.examples.length && !pick; k++) {
      const x0 = G.examples[k].past, c = cgmCandidates(x0, k);
      const res = X.hsja(cgmDecide, x0, c.lower, c.upper, c.cands, { seed: k + 1, iterations: 12, directions: 40 });
      if (!res.success) continue;
      const found = { ex: G.examples[k], adv: res.x };
      if (Math.min.apply(null, G.examples[k].future) < 60) pick = found; else if (!spare) spare = found;
    }
    pick = pick || spare;
    const ex = pick ? pick.ex : G.examples[0], truth = ex.past, fut = ex.future, adv = pick ? pick.adv : truth.slice();
    const n = truth.length;
    const times = truth.map(function (_, i) { return -5 * (n - 1 - i); }), ftimes = fut.map(function (_, i) { return 5 * (i + 1); });
    $("p3-open-thr").textContent = G.threshold.toFixed(3);
    cap.innerHTML = pick ? "The model was never touched.<span>One real hour of glucose monitoring that ended in a correct alert. The dashed amber line is what happened in the next 30 minutes.</span>"
      : "This alert held: no reading within the budget silenced it.";
    let geo = null, last = { sweep: 1, alpha: 1, future: 1, cap: true };

    function build() {
      const W = boxWidth(box, 600, 290, 640), H = W < 460 ? 240 : 280, m = { l: 40, r: 12, t: 14, b: 28 };
      const all = truth.concat(fut, adv);
      const lo = Math.max(40, Math.floor((Math.min.apply(null, all) - 12) / 10) * 10);
      const hi = Math.min(400, Math.ceil((Math.max.apply(null, all) + 12) / 10) * 10);
      const svg = S.svgRoot(box, W, H, "One hour of glucose readings that raised a correct alert, the same hour after the attack, and the next 30 minutes");
      const xs = function (t) { return m.l + ((t + 60) / 95) * (W - m.l - m.r); };
      const ys = function (v) { return H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b); };
      const tk = ticks(lo, hi, W < 460 ? 3 : 4);
      tk.forEach(function (v) { add(svg, "text", { x: m.l - 6, y: ys(v) + 4, "text-anchor": "end", class: "tick" }, String(v)); });
      [-60, -30, 0, 30].forEach(function (t) { add(svg, "text", { x: xs(t), y: H - 6, "text-anchor": "middle", class: "tick" }, t === 0 ? "now" : (t > 0 ? "+" : MINUS) + Math.abs(t) + " min"); });
      add(svg, "line", { x1: m.l, x2: W - m.r, y1: ys(70), y2: ys(70), class: "o-hypo" });
      add(svg, "text", { x: m.l + 4, y: ys(70) + 15, class: "tick o-hypo-l" }, "70 mg/dL");
      geo = {
        xs: xs, ys: ys,
        ghost: add(svg, "polyline", { points: "", class: "o-true" }),
        fline: add(svg, "polyline", { points: "", class: "o-fut" }),
        fdots: add(svg, "g", {}),
        rep: add(svg, "polyline", { points: "", class: "o-rep" }),
        head: add(svg, "circle", { r: 5, cx: -20, cy: -20, class: "o-head" })
      };
      render(last);
    }

    function render(st) {
      last = st;
      if (!geo) return;
      const a = ease(clamp01(st.alpha));
      const w = truth.map(function (v, i) { return v + a * (adv[i] - v); });
      const vis = clamp01(st.sweep) * (n - 1), line = [];
      for (let i = 0; i < n; i++) {
        if (i <= vis) line.push([geo.xs(times[i]), geo.ys(w[i])]);
        else {
          const f = vis - (i - 1);
          if (f > 0) line.push([geo.xs(times[i - 1] + 5 * f), geo.ys(w[i - 1] + f * (w[i] - w[i - 1]))]);
          break;
        }
      }
      geo.rep.setAttribute("points", pts(line));
      const tip = line[line.length - 1];
      geo.head.setAttribute("cx", st.sweep < 1 ? tip[0] : -20);
      geo.head.setAttribute("cy", st.sweep < 1 ? tip[1] : -20);
      geo.ghost.setAttribute("points", st.alpha > 0 ? pts(times.map(function (t, i) { return [geo.xs(t), geo.ys(truth[i])]; })) : "");
      geo.ghost.style.opacity = String(Math.min(1, 2 * clamp01(st.alpha)));
      const fv = clamp01(st.future) * fut.length, fl = [[geo.xs(0), geo.ys(truth[n - 1])]];
      geo.fdots.innerHTML = "";
      for (let i = 0; i < fut.length; i++) {
        const prevV = i === 0 ? truth[n - 1] : fut[i - 1], prevT = i === 0 ? 0 : ftimes[i - 1];
        if (fv >= i + 1) {
          fl.push([geo.xs(ftimes[i]), geo.ys(fut[i])]);
          add(geo.fdots, "rect", { x: geo.xs(ftimes[i]) - 3.5, y: geo.ys(fut[i]) - 3.5, width: 7, height: 7, class: "o-futdot" });
        } else {
          const f = fv - i;
          if (f > 0) fl.push([geo.xs(prevT + 5 * f), geo.ys(prevV + f * (fut[i] - prevV))]);
          break;
        }
      }
      geo.fline.setAttribute("points", fv > 0 ? pts(fl) : "");
      const r = cgmRisk(w), on = r >= G.threshold;
      alarm.className = "alarm " + (on ? "on" : "off");
      alarm.textContent = on ? "Low glucose soon" : "No alert";
      $("p3-open-risk").textContent = r.toFixed(3);
      $("p3-open-change").textContent = largestChange(w, truth).toFixed(1) + " mg/dL";
      cap.classList.toggle("shown", !!st.cap);
    }

    let raf = 0, replay = null;
    function play() {
      if (RM || !pick) { render({ sweep: 1, alpha: pick ? 1 : 0, future: 1, cap: true }); return; }
      cancelAnimationFrame(raf);
      if (replay) replay.style.visibility = "hidden";
      const t0 = performance.now();
      function frame(now) {
        const t = now - t0;
        render({ sweep: t / 1600, alpha: (t - 3000) / 1400, future: (t - 4700) / 1300, cap: t >= 6300 });
        if (t < 6400) raf = requestAnimationFrame(frame);
        else if (replay) replay.style.visibility = "visible";
      }
      raf = requestAnimationFrame(frame);
    }
    if (!RM && pick) {
      replay = S.el("button", { class: "btn open-replay", type: "button" }, "Replay");
      replay.style.visibility = "hidden";
      replay.addEventListener("click", play);
      fig.appendChild(replay);
      last = { sweep: 0, alpha: 0, future: 0, cap: false };
    }
    build();
    onWidth(box, build);
    play();
  }

  /* =====================================================================================================
     Station 1: three signal paths and where the attacker sits.
     ===================================================================================================== */
  function initLanes() {
    const box = $("lanes"), button = $("lanes-show");
    const lanes = [
      { target: "s-silence", title: "Continuous glucose monitor", nodes: ["Glucose monitor", "Phone app", "Model", "Low-glucose alert"],
        mode: "Decision-based attacker", sees: "sees only the alert", budget: G.budget + " mg/dL per reading",
        data: "200 older adults with type 1 diabetes", name: "the glucose alert" },
      { target: "s-sepsis", title: "ICU sepsis early warning", nodes: ["Bedside monitors", "Interface engine", "Model", "Sepsis warning"],
        mode: "Score-based attacker", sees: "reads the risk score", budget: "within routine measurement noise per vital sign",
        data: grouped(N5.patients) + " ICU patients, PhysioNet 2019 challenge", name: "the sepsis warning" },
      { target: "s-af", title: "Smartwatch rhythm check", nodes: ["Smartwatch", "Companion app", "Model", "AF notification"],
        mode: "Decision-based attacker", sees: "sees only the notification",
        budget: Math.min.apply(null, N6.budgets) + " to " + Math.max.apply(null, N6.budgets) + " ms per heartbeat interval",
        data: "MIT-BIH AF database, " + N6.records + " records", name: "the AF notification" }
    ];
    const charts = lanes.map(function (ln) {
      const b = S.el("button", { type: "button", class: "lane", "aria-label": ln.title + ": open the attack on " + ln.name });
      b.innerHTML = '<span class="lane-top"><span class="lane-title">' + ln.title + '</span><span class="lane-mode">' + ln.mode + "</span></span>" +
        '<span class="chart"></span><span class="lane-foot"><span>Attacker: <b>' + ln.sees + "</b></span><span>Budget: <b>" + ln.budget +
        "</b></span><span>Data: <b>" + ln.data + '</b></span><span class="lane-go">Open the attack</span></span>';
      b.addEventListener("click", function () { scrollToId(ln.target); });
      box.appendChild(b);
      return { lane: ln, holder: b.querySelector(".chart") };
    });

    function arrow(svg, x, y, dir) {
      const s = 7, p = dir === "right" ? [[x, y], [x - s * 1.4, y - s], [x - s * 1.4, y + s]]
        : dir === "down" ? [[x, y], [x - s, y - s * 1.4], [x + s, y - s * 1.4]] : [[x, y], [x + s * 1.4, y - s], [x + s * 1.4, y + s]];
      add(svg, "polygon", { points: pts(p), class: "ln-head" });
    }
    function node(svg, x, y, w, h, label, model) {
      const g = add(svg, "g", { class: "ln-node" + (model ? " model" : "") });
      add(g, "rect", { x: x, y: y, width: w, height: h, rx: 8 });
      add(g, "text", { x: x + w / 2, y: y + h / 2 + 5, "text-anchor": "middle" }, label);
    }
    function draw(c) {
      const ln = c.lane, W = boxWidth(c.holder, 1000, 260, 1120);
      if (W >= 720) {
        const H = 132, bw = Math.max(140, Math.min(176, (W - 170) / 4)), free = W - 4 * bw - 4, g1 = free * 0.2, g2 = free * 0.6;
        const x = [2, 2 + bw + g1, 2 + 2 * bw + g1 + g2, 2 + 3 * bw + 2 * g1 + g2], yT = 54, bh = 44, yc = yT + bh / 2;
        const svg = S.svgRoot(c.holder, W, H, ln.title + ": " + ln.nodes.join(", then ") + ". The attacker sits between the " + ln.nodes[1].toLowerCase() + " and the model and " + ln.sees + ".");
        [[x[0] + bw, x[1]], [x[1] + bw, x[2]], [x[2] + bw, x[3]]].forEach(function (s) {
          add(svg, "line", { x1: s[0], x2: s[1] - 9, y1: yc, y2: yc, class: "ln-wire" });
          arrow(svg, s[1] - 1, yc, "right");
        });
        ln.nodes.forEach(function (label, i) { node(svg, x[i], yT, bw, bh, label, i === 2); });
        const ax = x[1] + bw + g2 / 2, dx = x[3] + bw / 2;
        add(svg, "path", { d: "M" + dx + " " + (yT - 3) + " C" + dx + " 12, " + ax + " 12, " + ax + " " + (yc - 22), class: "ln-obs" });
        add(svg, "text", { x: (dx + ax) / 2, y: 14, "text-anchor": "middle", class: "ln-note ln-late" }, ln.sees);
        const att = add(svg, "g", { class: "ln-att" });
        add(att, "circle", { cx: ax, cy: yc, r: 15 });
        add(att, "text", { x: ax, y: yc + 38, "text-anchor": "middle" }, "Attacker");
        add(svg, "text", { x: x[2] + bw / 2, y: yT + bh + 20, "text-anchor": "middle", class: "ln-note ln-late" }, "not touched");
      } else {
        const bw = Math.min(250, W - 96), bh = 40, x0 = 2, gap = 26, ag = 86;
        const y = [2, 2 + bh + gap, 2 + 2 * bh + gap + ag, 2 + 3 * bh + 2 * gap + ag], H = y[3] + bh + 4, cx = x0 + bw / 2;
        const svg = S.svgRoot(c.holder, W, H, ln.title + ": " + ln.nodes.join(", then ") + ". The attacker sits between the " + ln.nodes[1].toLowerCase() + " and the model and " + ln.sees + ".");
        [[y[0] + bh, y[1]], [y[1] + bh, y[2]], [y[2] + bh, y[3]]].forEach(function (s) {
          add(svg, "line", { x1: cx, x2: cx, y1: s[0], y2: s[1] - 9, class: "ln-wire" });
          arrow(svg, cx, s[1] - 1, "down");
        });
        ln.nodes.forEach(function (label, i) { node(svg, x0, y[i], bw, bh, label, i === 2); });
        const ay = y[1] + bh + ag / 2, ex = x0 + bw, ey = y[3] + bh / 2, bend = Math.min(80, W - ex - 6);
        add(svg, "path", { d: "M" + ex + " " + ey + " C" + (ex + bend) + " " + ey + ", " + (ex + bend) + " " + ay + ", " + (cx + 20) + " " + ay, class: "ln-obs" });
        const att = add(svg, "g", { class: "ln-att" });
        add(att, "circle", { cx: cx, cy: ay, r: 14 });
        add(att, "text", { x: cx - 22, y: ay + 5, "text-anchor": "end" }, "Attacker");
      }
    }
    function drawAll() { charts.forEach(draw); }
    drawAll();
    charts.forEach(function (c) { onWidth(c.holder, function () { draw(c); }); });
    button.addEventListener("click", function () {
      const on = !box.classList.contains("armed");
      box.classList.toggle("armed", on);
      button.setAttribute("aria-pressed", String(on));
      button.textContent = on ? "Hide the attackers" : "Show the attackers";
      if (on) S.reveal($("s1-take"));
    });
  }

  /* =====================================================================================================
     Station 2: silence a correct CGM alert by hand or with the decision-based attacker.
     ===================================================================================================== */
  function initSilence() {
    const B = G.budget, tau = G.threshold, E = G.examples;
    const chart = $("cgm-chart"), note = $("cgm-note"), study = $("cgm-study"), alarm = $("cgm-alarm");
    const controls = ["cgm-prev", "cgm-next", "cgm-attack", "cgm-reveal", "cgm-reset"].map($);
    const open = gate("p3-silence");
    S.poll($("poll-silence"), "p3-silence", function () { open(); });
    $("cgm-legend").innerHTML = '<span><i style="background:var(--ink)"></i>reported to the model: drag a reading</span>' +
      '<span><i style="background:var(--muted)"></i>true readings</span><span><i style="background:var(--muted);opacity:0.35"></i>within ' + B +
      ' mg/dL of the truth</span><span><i style="background:var(--amber)"></i>what happened next</span>';
    let k = 0, truth = null, reported = null, revealed = false, queries = 0, busy = false, view = null, drag = -1, shownStudy = false;
    const tries = {};

    function load(i) {
      k = (i + E.length) % E.length;
      truth = E[k].past.slice();
      reported = truth.slice();
      queries = 0;
      revealed = false;
      $("cgm-reveal").setAttribute("aria-pressed", "false");
      note.textContent = "";
      $("cgm-label").textContent = "Example " + (k + 1) + " of " + E.length;
      build();
      refresh();
    }
    function build() {
      const W = boxWidth(chart, 660, 290, 720), narrow = W < 480, H = narrow ? 300 : 340, m = { l: 44, r: 14, t: 22, b: 46 };
      const all = truth.concat(E[k].future);
      const lo = Math.max(40, Math.floor((Math.min.apply(null, all) - B - 6) / 10) * 10);
      const hi = Math.min(400, Math.ceil((Math.max.apply(null, all) + B + 6) / 10) * 10);
      const svg = S.svgRoot(chart, W, H, "Glucose readings of the last hour as reported to the model, the true readings and the next 30 minutes");
      const xs = function (t) { return m.l + ((t + 60) / 95) * (W - m.l - m.r); };
      const ys = function (v) { return H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b); };
      yGrid(svg, ys, ticks(lo, hi, narrow ? 4 : 5), m.l, W - m.r);
      xAxis(svg, xs, H - m.b, narrow ? [-60, -30, 0, 30] : [-60, -45, -30, -15, 0, 15, 30], function (t) { return t === 0 ? "now" : String(t); },
        "minutes relative to the alert decision", m.l, W - m.r);
      add(svg, "line", { x1: xs(0), x2: xs(0), y1: m.t, y2: H - m.b, class: "guide" });
      add(svg, "line", { x1: m.l, x2: W - m.r, y1: ys(70), y2: ys(70), class: "hypo" });
      add(svg, "text", { x: W - m.r - 2, y: ys(70) - 6, "text-anchor": "end", class: "hypo-l" }, "70 mg/dL");
      const times = truth.map(function (_, i) { return -5 * (truth.length - 1 - i); });
      const band = times.map(function (t, i) { return [xs(t), ys(Math.min(400, truth[i] + B))]; })
        .concat(times.slice().reverse().map(function (t, r) { const i = truth.length - 1 - r; return [xs(t), ys(Math.max(40, truth[i] - B))]; }));
      add(svg, "polygon", { points: pts(band), class: "band" });
      add(svg, "polyline", { points: pts(times.map(function (t, i) { return [xs(t), ys(truth[i])]; })), class: "line s-muted dashed" });
      const future = add(svg, "g", {});
      const fut = E[k].future, ft = fut.map(function (_, i) { return 5 * (i + 1); });
      add(future, "polyline", { points: pts([[xs(0), ys(truth[truth.length - 1])]].concat(ft.map(function (t, i) { return [xs(t), ys(fut[i])]; }))), class: "line s-amber dashed" });
      ft.forEach(function (t, i) { add(future, "rect", { x: xs(t) - 4, y: ys(fut[i]) - 4, width: 8, height: 8, class: "f-amber" }); });
      add(future, "text", { x: xs(17.5), y: m.t + 2, "text-anchor": "middle", class: "strong" }, "what happened next");
      const rep = add(svg, "polyline", { points: "", class: "line s-ink" });
      const handles = times.map(function (t, i) {
        const g = add(svg, "g", { class: "handle-g", tabindex: "0", role: "slider",
          "aria-label": "Reading reported " + (t === 0 ? "at the alert decision" : -t + " minutes before the alert decision"),
          "aria-valuemin": String(Math.max(40, truth[i] - B)), "aria-valuemax": String(Math.min(400, truth[i] + B)) });
        const hit = add(g, "circle", { cx: xs(t), cy: ys(truth[i]), r: 16, class: "hit" });
        const c = add(g, "circle", { cx: xs(t), cy: ys(truth[i]), r: 6.5, class: "handle" });
        g.addEventListener("pointerdown", function (e) {
          if (busy) return;
          drag = i;
          try { svg.setPointerCapture(e.pointerId); } catch (err) { /* capture unavailable */ }
          e.preventDefault();
        });
        g.addEventListener("keydown", function (e) {
          if (busy || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          e.preventDefault();
          setReading(i, reported[i] + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 5 : 1));
          handEdit();
        });
        return { g: g, hit: hit, c: c };
      });
      svg.addEventListener("pointermove", function (e) {
        if (drag < 0) return;
        const rect = svg.getBoundingClientRect();
        if (!rect.height) return;
        const yy = ((e.clientY - rect.top) / rect.height) * H;
        setReading(drag, lo + ((H - m.b - yy) / (H - m.t - m.b)) * (hi - lo));
        refresh();
      });
      const end = function () { if (drag >= 0) { drag = -1; handEdit(); } };
      svg.addEventListener("pointerup", end);
      svg.addEventListener("pointercancel", end);
      view = { xs: xs, ys: ys, times: times, rep: rep, handles: handles, future: future };
    }
    function setReading(i, v) {
      reported[i] = Math.round(Math.min(Math.min(400, truth[i] + B), Math.max(Math.max(40, truth[i] - B), v)));
    }
    function refresh() {
      view.rep.setAttribute("points", pts(view.times.map(function (t, i) { return [view.xs(t), view.ys(reported[i])]; })));
      view.handles.forEach(function (h, i) {
        const cy = view.ys(reported[i]);
        h.c.setAttribute("cy", cy);
        h.hit.setAttribute("cy", cy);
        h.c.setAttribute("class", "handle" + (Math.abs(reported[i] - truth[i]) > 1e-6 ? " moved" : ""));
        h.g.setAttribute("aria-valuenow", String(Math.round(reported[i])));
        h.g.setAttribute("aria-valuetext", Math.round(reported[i]) + " mg/dL");
      });
      view.future.style.display = revealed ? "" : "none";
      const r = cgmRisk(reported), on = r >= tau;
      alarm.className = "alarm " + (on ? "on" : "off");
      alarm.textContent = on ? "Low glucose soon" : "No alert";
      $("cgm-risk").textContent = r.toFixed(3);
      $("cgm-risk").className = on ? "hot" : "";
      $("cgm-thr").textContent = tau.toFixed(3);
      $("cgm-queries").textContent = grouped(queries);
      const ch = largestChange(reported, truth);
      $("cgm-change").textContent = ch.toFixed(1) + " mg/dL";
      $("cgm-change").className = ch > 0 ? "warm" : "";
      const flag = $("cgm-flag");
      if (on) {
        $("cgm-margin").textContent = "not applicable while the alert is on";
        $("cgm-margin").className = "";
        flag.textContent = "";
        flag.className = "flag";
      } else {
        const mg = X.marginLower(cgmDecide, reported, 20, 0.2), close = mg < G.margin_cut;
        $("cgm-margin").textContent = mg >= 20 ? "more than 20 mg/dL" : mg.toFixed(1) + " mg/dL";
        $("cgm-margin").className = close ? "warm" : "";
        flag.textContent = close ? "Suspicious: fewer than 5 percent of genuine near-threshold hours are this close to an alert."
          : "The silence is not unusually close to the alert boundary.";
        flag.className = "flag" + (close ? " warn" : "");
      }
      return on;
    }
    function record(silenced, linf) {
      const prev = tries[k];
      if (!prev || silenced || !prev.silenced) tries[k] = { silenced: silenced, linf: silenced ? linf : null };
      const all = Object.keys(tries).map(function (key) { return tries[key]; }), ok = all.filter(function (t) { return t.silenced; });
      S.store.set("p3:silenced", { tried: all.length, silenced: ok.length,
        medianLinf: ok.length ? Math.round(median(ok.map(function (t) { return t.linf; })) * 10) / 10 : null });
    }
    function handEdit() {
      const on = refresh();
      if (!on) {
        const ch = largestChange(reported, truth);
        note.textContent = "Silenced by hand with a largest change of " + ch.toFixed(1) + " mg/dL. Show what happened next.";
        record(true, ch);
        S.reveal($("s2-take"));
      } else note.textContent = "";
    }
    function showStudy() {
      if (shownStudy) return;
      shownStudy = true;
      const ans = S.store.get("poll:p3-silence", null);
      study.innerHTML = "<p>Across <strong>" + N4.attacks + "</strong> correct alerts, the attacker silenced <strong>" + percent(N4.success_rate) +
        " percent</strong>, with a median largest change of <strong>" + N4.median_linf.toFixed(1) + " mg/dL</strong> and a median of <strong>" +
        grouped(N4.median_queries) + "</strong> yes-or-no queries. One silenced alert was followed by glucose of <strong>" +
        Math.round(N4.lowest_after_silenced) + " mg/dL</strong>.</p>" +
        (ans && SILENCE_LABELS[ans] ? "<p>Your prediction: " + SILENCE_LABELS[ans] + ".</p>" : "");
      study.hidden = false;
    }
    function setBusy(on) { busy = on; controls.forEach(function (b) { b.disabled = on; }); }

    $("cgm-prev").addEventListener("click", function () { if (!busy) load(k - 1); });
    $("cgm-next").addEventListener("click", function () { if (!busy) load(k + 1); });
    $("cgm-reset").addEventListener("click", function () { if (busy) return; reported = truth.slice(); queries = 0; note.textContent = ""; refresh(); });
    $("cgm-reveal").addEventListener("click", function () {
      revealed = !revealed;
      $("cgm-reveal").setAttribute("aria-pressed", String(revealed));
      refresh();
    });
    $("cgm-attack").addEventListener("click", function () {
      if (busy) return;
      const x0 = truth.slice();
      if (!cgmDecide(x0)) { note.textContent = "The alert is not active for the true readings."; return; }
      const c = cgmCandidates(x0, k);
      reported = x0.slice();
      queries = 0;
      refresh();
      setBusy(true);
      note.textContent = "The attacker asks only one question: alert or no alert?";
      runSteps(hsjaSteps(cgmDecide, x0, c.lower, c.upper, c.cands, { seed: k + 1, iterations: 12, directions: 40 }), function (st) {
        queries = st.queries;
        if (st.x) reported = st.x.slice();
        refresh();
      }, 170, function (res) {
        setBusy(false);
        queries = res.queries;
        if (res.success) {
          reported = res.x.slice();
          refresh();
          note.textContent = "Silenced after " + grouped(res.queries) + " yes-or-no queries, with a largest change of " + res.linf.toFixed(1) +
            " mg/dL per reading. Show what happened next.";
          record(true, res.linf);
        } else {
          reported = x0.slice();
          refresh();
          note.textContent = "No silent input exists among the attacker's starting points: this alert survives a budget of " + B + " mg/dL.";
          record(false, null);
        }
        showStudy();
        S.reveal($("s2-take"));
      });
    });
    load(0);
    onWidth(chart, function () { if (truth) { build(); refresh(); } });
  }

  /* =====================================================================================================
     Station 3: which explanation exposes the manipulation, with a movable detection threshold.
     ===================================================================================================== */
  const CGM_NAMES = { glucose_now: "glucose now", mean_60min: "mean over 60 min", min_60min: "lowest in 60 min", max_60min: "highest in 60 min",
    sd_60min: "variability (SD)", slope_15min: "trend, last 15 min", slope_30min: "trend, last 30 min", change_5min: "change, last 5 min",
    change_60min: "change over 60 min", trend_change: "trend acceleration" };

  function initDetect() {
    const open = gate("p3-signal");
    S.poll($("poll-signal"), "p3-signal", function () { open(); $("det-why").hidden = false; });
    const panels = {
      shap: { gen: N4.shap_genuine, man: N4.shap_manipulated, auroc: N4.auroc_shap, bin: 0.5, high: true, unit: "",
        axis: "SHAP anomaly score", key: "shap", id: "det-shap" },
      margin: { gen: N4.margin_genuine, man: N4.margin_manipulated, auroc: N4.auroc_margin, bin: 1, high: false, unit: " mg/dL",
        axis: "decrease needed to trigger the alert (mg/dL)", key: "margin", id: "det-margin" }
    };
    Object.keys(panels).forEach(function (key) {
      const P = panels[key];
      P.box = $(P.id + "-chart"); P.slider = $(P.id + "-thr"); P.out = $(P.id + "-out"); P.thrOut = $(P.id + "-throut");
      P.lo = 0;
      P.hi = Math.ceil(Math.max(Math.max.apply(null, P.gen), Math.max.apply(null, P.man)) / P.bin - 1e-9) * P.bin;
      P.slider.min = "0";
      P.slider.max = String(P.hi);
      $(P.id + "-auroc").textContent = "AUROC " + P.auroc.toFixed(3) + ", from " + P.man.length + " manipulated and " + P.gen.length + " genuine windows";
      const nb = Math.round((P.hi - P.lo) / P.bin), binOf = function (v) { return Math.min(nb - 1, Math.max(0, Math.floor((v - P.lo) / P.bin))); };
      P.cg = new Array(nb).fill(0); P.cm = new Array(nb).fill(0);
      P.gen.forEach(function (v) { P.cg[binOf(v)] += 1 / P.gen.length; });
      P.man.forEach(function (v) { P.cm[binOf(v)] += 1 / P.man.length; });
      P.nb = nb;
      build(P);
      P.slider.addEventListener("input", function () { update(P, true); });
      onWidth(P.box, function () { build(P); });
    });

    function build(P) {
      const W = boxWidth(P.box, 520, 270, 640), H = W < 420 ? 220 : 240, m = { l: 44, r: 14, t: 16, b: 46 };
      const svg = S.svgRoot(P.box, W, H, "Histogram of the " + P.axis + " for genuine and manipulated windows, with the detection threshold");
      svg.setAttribute("class", "det-svg");
      const xs = function (v) { return m.l + ((v - P.lo) / (P.hi - P.lo)) * (W - m.l - m.r); };
      const top = niceCeil(Math.max(Math.max.apply(null, P.cg), Math.max.apply(null, P.cm)));
      const ys = function (v) { return H - m.b - (v / top) * (H - m.t - m.b); };
      const zone = add(svg, "rect", { x: m.l, y: m.t, width: 0, height: H - m.t - m.b, class: "flag-zone" });
      const tk = ticks(0, top, 4);
      yGrid(svg, ys, tk, m.l, W - m.r, function (v) { return percent(v) + "%"; });
      const bw = (W - m.l - m.r) / P.nb, half = Math.max(1, bw / 2 - 1);
      for (let b = 0; b < P.nb; b++) {
        const x = xs(P.lo + b * P.bin);
        if (P.cg[b] > 0) add(svg, "rect", { x: x + 0.5, y: ys(P.cg[b]), width: half, height: Math.max(1, H - m.b - ys(P.cg[b])), rx: 1.5, class: "f-safe" });
        if (P.cm[b] > 0) add(svg, "rect", { x: x + bw / 2 + 0.5, y: ys(P.cm[b]), width: half, height: Math.max(1, H - m.b - ys(P.cm[b])), rx: 1.5, class: "f-amber" });
      }
      xAxis(svg, xs, H - m.b, ticks(P.lo, P.hi, W < 420 ? 4 : 5), null, P.axis, m.l, W - m.r);
      const line = add(svg, "line", { x1: 0, x2: 0, y1: m.t, y2: H - m.b, class: "threshold" });
      const grip = add(svg, "polygon", { points: "0,0", class: "thr-grip" });
      P.geo = { svg: svg, xs: xs, W: W, H: H, m: m, zone: zone, line: line, grip: grip };
      let dragging = false;
      const setFrom = function (e) {
        const rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        const x = ((e.clientX - rect.left) / rect.width) * W;
        const v = P.lo + ((x - m.l) / (W - m.l - m.r)) * (P.hi - P.lo);
        P.slider.value = String(Math.max(P.lo, Math.min(P.hi, Math.round(v * 10) / 10)));
        update(P, true);
      };
      svg.addEventListener("pointerdown", function (e) { dragging = true; try { svg.setPointerCapture(e.pointerId); } catch (err) { /* capture unavailable */ } setFrom(e); });
      svg.addEventListener("pointermove", function (e) { if (dragging) setFrom(e); });
      svg.addEventListener("pointerup", function () { dragging = false; });
      svg.addEventListener("pointercancel", function () { dragging = false; });
      update(P, false);
    }
    function update(P, store) {
      const t = parseFloat(P.slider.value), g = P.geo;
      const hit = function (v) { return P.high ? v >= t : v <= t; };
      const det = P.man.filter(hit).length / P.man.length, fa = P.gen.filter(hit).length / P.gen.length;
      P.thrOut.textContent = t.toFixed(1) + P.unit;
      P.out.innerHTML = "Detected: <b>" + percent(det) + " percent</b> <span>of manipulated windows</span><br>False alarms: <b>" +
        percent(fa, fa > 0 && fa < 0.1 ? 1 : 0) + " percent</b> <span>of genuine windows</span>";
      const x = g.xs(t);
      g.line.setAttribute("x1", x); g.line.setAttribute("x2", x);
      g.grip.setAttribute("points", pts([[x - 7, g.m.t - 9], [x + 7, g.m.t - 9], [x, g.m.t + 1]]));
      if (P.high) { g.zone.setAttribute("x", x); g.zone.setAttribute("width", Math.max(0, g.W - g.m.r - x)); }
      else { g.zone.setAttribute("x", g.m.l); g.zone.setAttribute("width", Math.max(0, x - g.m.l)); }
      if (store) {
        S.store.set("p3:detect", { signal: P.key, detected: round3(det), falseAlarms: round3(fa) });
        S.reveal($("s3-take"));
      }
    }

    /* Mean attribution shift of manipulated windows. */
    const box = $("det-shift");
    function drawShift() {
      const rows = N4.shift.features.map(function (f, i) { return { label: CGM_NAMES[f] || f, v: N4.shift.mean_diff[i] }; })
        .sort(function (a, b) { return b.v - a.v; });
      const W = boxWidth(box, 700, 290, 760), narrow = W < 480, rowH = 26, m = { l: narrow ? 126 : 170, r: 62, t: 8, b: 40 };
      const H = rows.length * rowH + m.t + m.b, maxAbs = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.v); })) * 1.05;
      const svg = S.svgRoot(box, W, H, "Mean SHAP value of manipulated windows minus genuine windows for each feature");
      const xs = function (v) { return m.l + ((v + maxAbs) / (2 * maxAbs)) * (W - m.l - m.r); };
      add(svg, "line", { x1: xs(0), x2: xs(0), y1: m.t, y2: H - m.b + 4, class: "axis" });
      rows.forEach(function (r, i) {
        const y = m.t + i * rowH, x0 = xs(0), x1 = xs(r.v);
        add(svg, "text", { x: m.l - 8, y: y + 17, "text-anchor": "end" }, r.label);
        add(svg, "rect", { x: Math.min(x0, x1), y: y + 6, width: Math.max(1, Math.abs(x1 - x0)), height: 14, rx: 2, class: r.v >= 0 ? "f-alert" : "f-safe" });
        add(svg, "text", { x: W - 4, y: y + 17, "text-anchor": "end", class: "val" }, signed(r.v, 3));
      });
      add(svg, "text", { x: xs(0) - 8, y: H - m.b + 22, "text-anchor": "end", class: "tick" }, "towards no alert");
      add(svg, "text", { x: xs(0) + 8, y: H - m.b + 22, "text-anchor": "start", class: "tick" }, "towards the alert");
    }
    drawShift();
    onWidth(box, drawShift);
  }

  /* =====================================================================================================
     Station 4: a stream of near-threshold windows watched by the Page-Hinkley test of NB4.
     ===================================================================================================== */
  function initCampaign() {
    const L = 400, BASE = 200, DELTA = 0.05, RUNS = 100, RATES = { slow: 8, normal: 25, fast: 80 };
    const SIG = {
      margin: { gen: N4.margin_genuine.map(function (v) { return -v; }), man: N4.margin_manipulated.map(function (v) { return -v; }), name: "counterfactual margin, sign flipped", short: "counterfactual margin" },
      shap: { gen: N4.shap_genuine.slice(), man: N4.shap_manipulated.slice(), name: "SHAP anomaly score", short: "SHAP anomaly" }
    };
    /* The test watches flags: a window is flagged when its score lies above the 95th percentile of genuine scores. */
    function walk(s, c, share, rand, stopAtAlarm) {
      let mu = 0, cum = 0, cmin = 0, worst = 0, alarm = null;
      for (let t = 1; t <= L; t++) {
        const man = c !== null && t - 1 >= c && rand() < share, pool = man ? s.fm : s.fg, x = pool[Math.floor(rand() * pool.length)];
        mu += (x - mu) / t; cum += x - mu - DELTA;
        if (cum < cmin) cmin = cum;
        const stat = cum - cmin;
        if (stat > worst) worst = stat;
        if (alarm === null && stat > s.lam) { alarm = t - 1; if (stopAtAlarm) break; }
      }
      return { worst: worst, alarm: alarm };
    }
    Object.keys(SIG).forEach(function (key, idx) {
      const s = SIG[key];
      s.med = quantile(s.gen, 0.5);
      s.iqr = quantile(s.gen, 0.75) - quantile(s.gen, 0.25) + 1e-9;
      const z = function (v) { return (v - s.med) / s.iqr; };
      s.zg = s.gen.map(z); s.zm = s.man.map(z);
      s.cut = quantile(s.gen, 0.95); s.zcut = z(s.cut);
      s.fg = s.gen.map(function (v) { return v > s.cut ? 1 : 0; });
      s.fm = s.man.map(function (v) { return v > s.cut ? 1 : 0; });
      /* Alarm threshold: 1.1 times the largest statistic over 30 attack-free streams of the same length. */
      s.lam = Infinity;
      const rand = X.mulberry32(2026 + idx);
      let worst = 0;
      for (let r = 0; r < 30; r++) worst = Math.max(worst, walk(s, null, 0, rand, false).worst);
      s.lam = 1.1 * worst;
      const allz = s.zg.concat(s.zm), lo = Math.min.apply(null, allz), hi = Math.max.apply(null, allz), pad = 0.08 * (hi - lo);
      s.zlo = lo - pad; s.zhi = hi + pad;
    });
    const box = $("camp-chart"), out = $("camp-out"), startBtn = $("camp-start"), campBtn = $("camp-campaign"), shareIn = $("camp-share");
    let sigKey = "margin", rate = "normal", runs = 0, st = null, timer = null, V = null;

    function fresh() {
      runs++;
      clearTimeout(timer);
      st = { t: 0, z: [], flag: [], man: [], stat: [], mu: 0, cum: 0, cmin: 0, camp: null, alarm: null, running: false, done: false, rand: X.mulberry32(9000 + runs) };
      startBtn.textContent = "Start the stream";
      startBtn.disabled = false;
      campBtn.disabled = true;
      campBtn.textContent = "Start the campaign";
      out.textContent = "Genuine near-threshold windows arrive first. Start the stream.";
      drawAll();
    }
    function share() { return parseInt(shareIn.value, 10) / 100; }
    function stepOnce() {
      const s = SIG[sigKey], t = st.t;
      const isMan = st.camp !== null && t >= st.camp && st.rand() < share();
      const k = Math.floor(st.rand() * (isMan ? s.zm : s.zg).length), x = isMan ? s.zm[k] : s.zg[k], f = isMan ? s.fm[k] : s.fg[k];
      const n = t + 1;
      st.mu += (f - st.mu) / n;
      st.cum += f - st.mu - DELTA;
      if (st.cum < st.cmin) st.cmin = st.cum;
      const stat = st.cum - st.cmin;
      st.z.push(x); st.flag.push(f); st.man.push(isMan); st.stat.push(stat); st.t = n;
      if (st.alarm === null && stat > s.lam) st.alarm = t;
      appendPoint(t);
    }
    function drawAll() {
      const s = SIG[sigKey], W = boxWidth(box, 1000, 300, 1100), small = W < 560;
      const H = small ? 360 : 380, m = { l: 44, r: small ? 10 : 18, t: 30, b: 44 }, gap = 44;
      const inner = H - m.t - m.b - gap, topH = inner * 0.52, botH = inner * 0.48;
      const svg = S.svgRoot(box, W, H, "Stream of standardised detection scores and the Page-Hinkley statistic with its alarm threshold");
      const xs = function (i) { return m.l + (i / (L - 1)) * (W - m.l - m.r); };
      const y1 = function (v) { return m.t + (1 - (v - s.zlo) / (s.zhi - s.zlo)) * topH; };
      const y2top = m.t + topH + gap, statMax = s.lam * 1.4;
      const y2 = function (v) { return y2top + (1 - Math.min(v, statMax) / statMax) * botH; };
      add(svg, "text", { x: m.l, y: m.t - 12, class: "axis-label" }, small ? "score of each window" : "standardised score of each window (" + s.name + ")");
      yGrid(svg, y1, ticks(s.zlo, s.zhi, 4), m.l, W - m.r);
      add(svg, "line", { x1: m.l, x2: W - m.r, y1: y1(s.zcut), y2: y1(s.zcut), class: "cut" });
      add(svg, "text", { x: W - m.r, y: y1(s.zcut) - 6, "text-anchor": "end", class: "tick" }, "flagged above this line");
      add(svg, "text", { x: m.l, y: y2top - 12, class: "axis-label" }, "Page-Hinkley statistic of the flags");
      yGrid(svg, y2, ticks(0, statMax, 3), m.l, W - m.r);
      add(svg, "line", { x1: m.l, x2: W - m.r, y1: y2(s.lam), y2: y2(s.lam), class: "lam" });
      add(svg, "text", { x: W - m.r, y: y2(s.lam) - 6, "text-anchor": "end", class: "tick" }, "alarm threshold " + s.lam.toFixed(1));
      xAxis(svg, xs, H - m.b, ticks(0, L, small ? 4 : 8), null, "window in the stream", m.l, W - m.r);
      const markers = add(svg, "g", {}), dots = add(svg, "g", {}), path = add(svg, "path", { d: "", class: "ph-line" });
      V = { svg: svg, xs: xs, y1: y1, y2: y2, y2top: y2top, H: H, W: W, m: m, dots: dots, path: path, markers: markers, d: "", small: small };
      for (let i = 0; i < st.t; i++) appendPoint(i);
      drawMarkers();
    }
    function appendPoint(i) {
      if (!V) return;
      add(V.dots, "circle", { cx: V.xs(i).toFixed(1), cy: V.y1(st.z[i]).toFixed(1), r: st.flag[i] ? 4 : st.man[i] ? 3.4 : 2.4,
        class: (st.man[i] ? "dot-man" : "dot-gen") + (st.flag[i] ? " dot-flag" : "") });
      V.d += (i ? " L" : "M") + V.xs(i).toFixed(1) + " " + V.y2(st.stat[i]).toFixed(1);
      V.path.setAttribute("d", V.d);
      if (i === st.camp || i === st.alarm) drawMarkers();
    }
    function drawMarkers() {
      if (!V) return;
      V.markers.innerHTML = "";
      const lines = add(V.markers, "g", {}), labels = add(V.markers, "g", { class: "marker-labels" });
      const label = function (x, y, text, cls) {
        const wide = text.length * (cls.indexOf("tick") >= 0 ? 6.4 : 7.4), right = V.W - V.m.r - x < wide + 10;
        add(labels, "text", { x: right ? x - 7 : x + 7, y: y, "text-anchor": right ? "end" : "start", class: cls }, text);
      };
      if (st.camp !== null && st.t > st.camp) {
        const x = V.xs(st.camp);
        add(lines, "line", { x1: x, x2: x, y1: V.m.t - 4, y2: V.H - V.m.b, class: "camp-mark" });
        label(x, V.y2top - 12, "campaign starts", "tick strong");
      }
      if (st.alarm !== null) {
        const x = V.xs(st.alarm), after = st.camp !== null && st.alarm >= st.camp ? st.alarm - st.camp : null;
        add(lines, "line", { x1: x, x2: x, y1: V.m.t - 4, y2: V.H - V.m.b, class: "alarm-mark" });
        label(x, V.y2top + 14, after !== null ? "alarm after " + after + " windows" : "false alarm", "strong");
      }
    }
    function status() {
      const s = SIG[sigKey], last = st.stat.length ? st.stat[st.stat.length - 1] : 0;
      const manCount = st.man.filter(Boolean).length, flags = st.flag.reduce(function (a, b) { return a + b; }, 0);
      let text = "Window " + st.t + " of " + L + ". ";
      if (st.camp === null) text += "All genuine, " + flags + " flagged by chance. ";
      else if (st.t <= st.camp) text += "The campaign starts at window " + st.camp + ". ";
      else text += manCount + " manipulated so far, " + flags + " flagged in all. ";
      out.textContent = text + "Statistic " + last.toFixed(1) + ", alarm above " + s.lam.toFixed(1) + ".";
    }
    /* The same test on many streams with the same signal, share and start, so one run is read in context. */
    function context(c, sh) {
      const s = SIG[sigKey], rand = X.mulberry32(77 + Math.round(100 * sh) + (sigKey === "shap" ? 1000 : 0) + c);
      let hits = 0, early = 0;
      const after = [];
      for (let r = 0; r < RUNS; r++) {
        const a = walk(s, c, sh, rand, true).alarm;
        if (a === null) continue;
        if (a < c) early++; else { hits++; after.push(a - c); }
      }
      return " Across " + RUNS + " simulated streams with the " + s.short + " at " + Math.round(100 * sh) + " percent, the alarm came in " + hits +
        (hits ? ", after a median of " + Math.round(median(after)) + " windows" : "") + (early ? "; " + early + " raised a false alarm first." : ".");
    }
    function finish() {
      st.running = false;
      st.done = true;
      clearTimeout(timer);
      startBtn.textContent = "Run again";
      startBtn.disabled = false;
      campBtn.disabled = true;
      const sh = share();
      if (st.alarm !== null && st.camp !== null && st.alarm >= st.camp) {
        const after = st.alarm - st.camp;
        out.textContent = "Alarm after " + after + " windows of the campaign." + context(st.camp, sh);
        S.store.set("p3:campaign", { signal: sigKey, share: sh, alarmAfter: after });
        S.reveal($("s4-take"));
      } else if (st.alarm !== null) {
        out.textContent = "False alarm at window " + st.alarm + ", before any manipulation." + (st.camp !== null ? context(st.camp, sh) : "");
      } else if (st.camp !== null) {
        out.textContent = "No alarm in this stream." + context(st.camp, sh);
        S.store.set("p3:campaign", { signal: sigKey, share: sh, alarmAfter: null });
        S.reveal($("s4-take"));
      } else {
        out.textContent = "No alarm in " + L + " genuine windows: without an attack the test stays quiet.";
      }
    }
    function tick() {
      timer = null;
      if (!st.running) return;
      const per = rate === "fast" ? 3 : 1;
      for (let i = 0; i < per && st.t < L && st.alarm === null; i++) stepOnce();
      status();
      if (st.alarm !== null || st.t >= L) { finish(); return; }
      timer = setTimeout(tick, (1000 * per) / RATES[rate]);
    }
    startBtn.addEventListener("click", function () {
      if (st.done) fresh();
      if (st.running) {
        st.running = false;
        clearTimeout(timer);
        startBtn.textContent = "Resume the stream";
        return;
      }
      st.running = true;
      startBtn.textContent = "Pause the stream";
      if (st.camp === null) campBtn.disabled = false;
      tick();
    });
    campBtn.addEventListener("click", function () {
      if (st.camp !== null || st.done) return;
      st.camp = Math.max(st.t, BASE);
      campBtn.disabled = true;
      campBtn.textContent = st.camp > st.t ? "Campaign from window " + st.camp : "Campaign running";
      status();
    });
    $("camp-reset").addEventListener("click", fresh);
    $("camp-signal").addEventListener("click", function (e) {
      const b = e.target.closest ? e.target.closest("button[data-value]") : null;
      if (!b) return;
      sigKey = b.getAttribute("data-value");
      setPressed($("camp-signal"), sigKey);
      fresh();
    });
    $("camp-speed").addEventListener("click", function (e) {
      const b = e.target.closest ? e.target.closest("button[data-value]") : null;
      if (!b) return;
      rate = b.getAttribute("data-value");
      setPressed($("camp-speed"), rate);
      if (st.running) { clearTimeout(timer); tick(); }
    });
    shareIn.addEventListener("input", function () { $("camp-share-out").textContent = shareIn.value + "%"; });
    fresh();
    onWidth(box, drawAll);
  }

  /* =====================================================================================================
     Station 5: hour-by-hour replays of ICU stays attacked with a score-based attack.
     ===================================================================================================== */
  const VITAL_NAMES = { HR: ["Heart rate", "bpm"], O2Sat: ["Oxygen saturation", "%"], Temp: ["Temperature", "°C"],
    SBP: ["Systolic pressure", "mmHg"], MAP: ["Mean arterial pressure", "mmHg"], Resp: ["Respiratory rate", "per min"] };

  function initSepsis() {
    const R = N5.replays, tau = N5.threshold, VN = N5.vitals;
    const open = gate("p3-sepsis");
    S.poll($("poll-sepsis"), "p3-sepsis", function () { open(); });
    const select = $("sep-stay"), scrub = $("sep-scrub"), playBtn = $("sep-play");
    const delayOf = function (r) { return r.attacked_alert === null ? null : r.attacked_alert - r.clean_alert; };
    R.forEach(function (r, i) {
      const d = delayOf(r), o = document.createElement("option");
      o.value = String(i);
      o.textContent = "Patient " + r.patient + ": " + (d === null ? "alert suppressed for the whole stay" : d === 0 ? "alert on time" : "alert " + hoursText(d) + " later");
      select.appendChild(o);
    });
    const vbox = $("sep-vitals");
    const vcharts = VN.map(function (key) {
      const nm = VITAL_NAMES[key] || [key, ""];
      const wrap = S.el("div", { class: "vital" }, "<h4>" + nm[0] + " (" + nm[1] + ")</h4>");
      const holder = S.el("div", { class: "chart paper" });
      wrap.appendChild(holder);
      vbox.appendChild(wrap);
      return holder;
    });
    let cur = 0, pos = 0, timer = null, geo = null;

    function fmtVital(key, v) { return key === "Temp" ? v.toFixed(1) : String(Math.round(v)); }
    function buildRisk() {
      const r = R[cur], n = r.risk_clean.length, h0 = r.start_hour, box = $("sep-risk");
      const W = boxWidth(box, 640, 290, 720), small = W < 480, H = small ? 250 : 280, m = { l: 46, r: 14, t: 30, b: 44 };
      const ymax = niceCeil(Math.max(tau * 1.6, Math.max.apply(null, r.risk_clean), Math.max.apply(null, r.risk_attacked)) * 1.05);
      const svg = S.svgRoot(box, W, H, "Sepsis risk of the genuine and the manipulated record, hour by hour, against the alert threshold");
      const xs = function (h) { return m.l + ((h - h0) / Math.max(1, n - 1)) * (W - m.l - m.r); };
      const ys = function (v) { return H - m.b - (v / ymax) * (H - m.t - m.b); };
      yGrid(svg, ys, ticks(0, ymax, 4), m.l, W - m.r);
      xAxis(svg, xs, H - m.b, ticks(h0, h0 + n - 1, small ? 4 : 7), null, "hour in the ICU", m.l, W - m.r);
      add(svg, "line", { x1: m.l, x2: W - m.r, y1: ys(tau), y2: ys(tau), class: "threshold" });
      const inView = r.onset >= h0 && r.onset <= h0 + n - 1;
      if (inView) {
        const x = xs(r.onset), right = x > W - m.r - 110;
        add(svg, "line", { x1: x, x2: x, y1: m.t - 6, y2: H - m.b, class: "onset" });
        add(svg, "text", { x: right ? x - 6 : x + 6, y: m.t - 10, "text-anchor": right ? "end" : "start", class: "tick strong" }, "clinical onset");
      }
      geo = {
        xs: xs, ys: ys, h0: h0, n: n,
        gen: add(svg, "polyline", { points: "", class: "line s-ink" }),
        att: add(svg, "polyline", { points: "", class: "line s-amber" }),
        marks: add(svg, "g", {}),
        head: add(svg, "line", { x1: 0, x2: 0, y1: m.t, y2: H - m.b, class: "guide" }),
        inView: inView
      };
    }
    function buildVitals() {
      const r = R[cur], n = r.vitals_clean.length;
      vcharts.forEach(function (holder, j) {
        const key = VN[j], bound = N5.bounds[j];
        const W = boxWidth(holder, 240, 150, 400), H = 112, m = { l: 40, r: 8, t: 8, b: 20 };
        let lo = Infinity, hi = -Infinity;
        for (let t = 0; t < n; t++) {
          [r.vitals_clean[t][j], r.vitals_attacked[t][j]].forEach(function (v) { if (v !== null && v !== undefined) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
        }
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        lo -= bound * 1.2; hi += bound * 1.2;
        const svg = S.svgRoot(holder, W, H, (VITAL_NAMES[key] || [key])[0] + ", genuine and manipulated");
        const xs = function (t) { return m.l + (t / Math.max(1, n - 1)) * (W - m.l - m.r); };
        const ys = function (v) { return H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b); };
        const tk = ticks(lo, hi, 2);
        tk.forEach(function (v) {
          add(svg, "line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), class: "gridline" });
          add(svg, "text", { x: m.l - 5, y: ys(v) + 4, "text-anchor": "end", class: "tick" }, fmtVital(key, v));
        });
        let seg = [];
        const flush = function () {
          if (seg.length > 1) {
            const poly = seg.map(function (p) { return [xs(p[0]), ys(p[1] + bound)]; }).concat(seg.slice().reverse().map(function (p) { return [xs(p[0]), ys(p[1] - bound)]; }));
            add(svg, "polygon", { points: pts(poly), class: "vband" });
          }
          seg = [];
        };
        for (let t = 0; t < n; t++) { const v = r.vitals_clean[t][j]; if (v === null || v === undefined) flush(); else seg.push([t, v]); }
        flush();
        add(svg, "text", { x: m.l, y: H - 5, class: "tick" }, "hour " + r.start_hour);
        add(svg, "text", { x: W - m.r, y: H - 5, "text-anchor": "end", class: "tick" }, "hour " + (r.start_hour + n - 1));
        holder.geo = { xs: xs, ys: ys, gen: add(svg, "polyline", { points: "", class: "line s-ink" }), att: add(svg, "polyline", { points: "", class: "line s-amber" }) };
      });
    }
    function lineUpTo(series, upto, getX, getY) {
      const out = [];
      for (let t = 0; t <= upto; t++) { const v = series[t]; if (v !== null && v !== undefined) out.push([getX(t), getY(v)]); }
      return pts(out);
    }
    function render() {
      const r = R[cur], n = r.risk_clean.length, hour = r.start_hour + pos;
      geo.gen.setAttribute("points", lineUpTo(r.risk_clean, pos, function (t) { return geo.xs(r.start_hour + t); }, geo.ys));
      geo.att.setAttribute("points", lineUpTo(r.risk_attacked, pos, function (t) { return geo.xs(r.start_hour + t); }, geo.ys));
      geo.head.setAttribute("x1", geo.xs(hour)); geo.head.setAttribute("x2", geo.xs(hour));
      geo.head.style.display = pos < n - 1 ? "" : "none";
      geo.marks.innerHTML = "";
      const placed = [];
      const mark = function (h, value, cls, text) {
        const x = geo.xs(h), y = geo.ys(value), wide = text.length * 6.6;
        add(geo.marks, "circle", { cx: x, cy: y, r: 5.5, class: cls });
        const right = x + 10 + wide > geo.xs(r.start_hour + n - 1);
        const x0 = right ? x - 10 - wide : x + 10;
        let ty = Math.max(14, y - 10);
        placed.forEach(function (b) { if (x0 < b.x1 && x0 + wide > b.x0 && Math.abs(ty - b.y) < 15) ty = b.y + 16; });
        placed.push({ x0: x0, x1: x0 + wide, y: ty });
        add(geo.marks, "text", { x: right ? x - 10 : x + 10, y: ty, "text-anchor": right ? "end" : "start", class: "tick strong" }, text);
      };
      if (r.clean_alert <= hour) mark(r.clean_alert, r.risk_clean[r.clean_alert - r.start_hour], "f-ink", "genuine alert");
      if (r.attacked_alert !== null && r.attacked_alert <= hour) mark(r.attacked_alert, r.risk_attacked[r.attacked_alert - r.start_hour], "f-amber", "alert under attack");
      vcharts.forEach(function (holder, j) {
        const g = holder.geo;
        g.gen.setAttribute("points", lineUpTo(r.vitals_clean.map(function (row) { return row[j]; }), pos, g.xs, g.ys));
        g.att.setAttribute("points", lineUpTo(r.vitals_attacked.map(function (row) { return row[j]; }), pos, g.xs, g.ys));
      });
      scrub.value = String(pos);
      $("sep-hour").textContent = "ICU hour " + hour;
      const d = delayOf(r), atEnd = pos >= n - 1;
      const attText = r.attacked_alert !== null && r.attacked_alert <= hour
        ? "alert at hour " + r.attacked_alert + (d === 0 ? ", on time" : ", " + hoursText(d) + " later")
        : atEnd ? "no alert in the whole stay" : "no alert yet";
      $("sep-status").innerHTML = '<span><i style="background:var(--ink)"></i>Genuine record: ' + (r.clean_alert <= hour ? "alert at hour " + r.clean_alert : "no alert yet") + "</span>" +
        '<span><i style="background:var(--amber)"></i>Manipulated record: ' + attText + "</span>" +
        '<span><i style="background:var(--violet)"></i>Clinical onset: hour ' + r.onset + (geo.inView ? "" : ", beyond this view") + "</span>" +
        '<span><i class="dash"></i>Alert threshold: risk ' + tau.toFixed(3) + "</span>";
    }
    function choose(i) {
      stop();
      cur = i;
      const n = R[cur].risk_clean.length;
      scrub.max = String(n - 1);
      pos = n - 1;
      buildRisk();
      buildVitals();
      render();
    }
    function remember() {
      const r = R[cur];
      S.store.set("p3:sepsis", { patient: r.patient, delayHours: delayOf(r) });
      S.reveal($("s5-take"));
    }
    function stop() { clearTimeout(timer); timer = null; playBtn.textContent = "Play the stay"; }
    function play() {
      if (timer) { stop(); return; }
      const n = R[cur].risk_clean.length;
      if (RM) { pos = n - 1; render(); remember(); return; }
      if (pos >= n - 1) pos = 0;
      playBtn.textContent = "Pause";
      const step = function () {
        render();
        if (pos >= n - 1) { stop(); remember(); return; }
        pos++;
        timer = setTimeout(step, 110);
      };
      step();
    }
    select.addEventListener("change", function () { choose(parseInt(select.value, 10)); remember(); });
    scrub.addEventListener("input", function () {
      stop();
      pos = parseInt(scrub.value, 10);
      render();
      if (pos >= R[cur].risk_clean.length - 1) remember();
    });
    playBtn.addEventListener("click", play);
    choose(0);
    onWidth($("sep-risk"), function () { buildRisk(); render(); });
    onWidth(vcharts[0], function () { buildVitals(); render(); });

    /* Cohort result, reported exactly as measured. */
    const nSup = Math.round(N5.suppressed_share * N5.attacked);
    const tile = function (v, l, tone) { return '<div class="stat' + (tone ? " " + tone : "") + '"><span class="v">' + v + '</span><span class="l">' + l + "</span></div>"; };
    $("sep-summary").innerHTML = tile(N5.attacked, "septic stays attacked") +
      tile(percent(N5.suppressed_share) + "%", "alert suppressed for the whole stay (" + nSup + " of " + N5.attacked + ")", "alert") +
      tile((N5.median_delay_h === null ? "none" : N5.median_delay_h + " h"), "median delay when the alert still fired", "amber") +
      tile(N5.lost_early_alerts, "stays whose alert no longer came before clinical onset", "alert") +
      tile(grouped(N5.median_queries), "median score queries per stay") +
      tile(N5.test_auroc.toFixed(3), "hourly AUROC on genuine records", "safe") +
      tile(percent(N5.early_share) + "%", "of septic test patients alerted before onset, without attack", "safe");
    const delayText = N5.median_delay_h === 0 ? "In most attacked stays the alert still fires on time: the median delay is 0 hours."
      : N5.median_delay_h === null ? "" : "When the alert still fires, the median delay is " + hoursText(N5.median_delay_h) + ".";
    $("sep-honest").textContent = "The attack does not always work. " + delayText + " In " + nSup + " of " + N5.attacked +
      " stays the alert never fires, and " + N5.lost_early_alerts + " lose an alert that would have come before clinical onset. The " + R.length +
      " replays are the stays where the attack gained most. When it works, a patient loses the warning while the AUROC of " +
      N5.test_auroc.toFixed(3) + " stays exactly as reported.";
    $("sep-shift").innerHTML = "<thead><tr><th>Vital sign</th><th>Allowed per hour</th><th>Largest change reached</th></tr></thead><tbody>" +
      VN.map(function (key, j) {
        const nm = VITAL_NAMES[key] || [key, ""], b = N5.bounds[j], mx = N5.max_shift[j];
        const f = function (v) { return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + " " + nm[1]; };
        return "<tr><td>" + nm[0] + "</td><td>" + f(b) + '</td><td class="' + (mx > b ? "over" : "") + '">' + f(mx) + "</td></tr>";
      }).join("") + "</tbody>";
  }

  /* =====================================================================================================
     Station 6: hide atrial fibrillation from a decision-only smartwatch notification.
     ===================================================================================================== */
  function initAF() {
    const E = N6.examples, BUD = N6.budgets;
    const pAF = function (w) { return X.proba(N6.model, X.rrFeatures(w)); };
    const decide = function (w) { return pAF(w) >= 0.5; };
    const select = $("af-example"), segBox = $("af-budget"), note = $("af-note");
    let j = Math.min(2, E.length - 1), budget = BUD.indexOf(60) >= 0 ? 60 : BUD[0], truth = null, reported = null, queries = 0, busy = false;
    E.forEach(function (e, i) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = "AF window " + (i + 1) + ", " + Math.round(60000 / mean(e.rr)) + " bpm";
      select.appendChild(o);
    });
    select.value = String(j);
    BUD.forEach(function (b) {
      const btn = S.el("button", { type: "button", "data-value": String(b), "aria-pressed": "false" }, String(b));
      segBox.appendChild(btn);
    });
    setPressed(segBox, budget);
    /* A steady non-AF window for comparison: the one closest in mean rate among those without abrupt rate changes. */
    const steady = N6.normals.filter(function (w) { for (let i = 1; i < w.length; i++) if (Math.abs(w[i] - w[i - 1]) > 150) return false; return true; });
    function normalFor(w) {
      const mw = mean(w), pool = steady.length ? steady : N6.normals;
      return pool.slice().sort(function (a, b) { return Math.abs(mean(a) - mw) - Math.abs(mean(b) - mw); })[0];
    }
    function load(i) {
      j = i;
      truth = E[j].rr.slice();
      reported = truth.slice();
      queries = 0;
      note.textContent = "";
      draw();
    }
    function draw() {
      const compare = $("af-compare").checked, normal = normalFor(truth), moved = largestChange(reported, truth) > 1e-6;
      const shown = truth.concat(reported, compare ? normal : []), bandLo = truth.map(function (v) { return Math.max(300, v - budget); }), bandHi = truth.map(function (v) { return Math.min(2000, v + budget); });
      const lo = Math.max(250, Math.floor((Math.min.apply(null, shown.concat(bandLo)) - 20) / 50) * 50);
      const hi = Math.min(2100, Math.ceil((Math.max.apply(null, shown.concat(bandHi)) + 20) / 50) * 50);
      /* Tachogram */
      const tb = $("af-tacho"), W = boxWidth(tb, 420, 260, 560), H = 240, m = { l: 46, r: 10, t: 12, b: 42 };
      const s1 = S.svgRoot(tb, W, H, "Tachogram: interval between successive beats for the AF window" + (moved ? ", the manipulated window" : "") + (compare ? " and a non-AF window" : ""));
      const xs = function (i) { return m.l + (i / (truth.length - 1)) * (W - m.l - m.r); };
      const ys = function (v) { return H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b); };
      yGrid(s1, ys, ticks(lo, hi, 4), m.l, W - m.r);
      xAxis(s1, xs, H - m.b, [0, 9, 19, 29], function (i) { return String(i + 1); }, "beat", m.l, W - m.r);
      add(s1, "polygon", { points: pts(truth.map(function (_, i) { return [xs(i), ys(bandHi[i])]; }).concat(truth.map(function (_, i) { return [xs(i), ys(bandLo[i])]; }).reverse())), class: "band" });
      if (compare) add(s1, "polyline", { points: pts(normal.map(function (v, i) { return [xs(i), ys(v)]; })), class: "line s-safe" });
      add(s1, "polyline", { points: pts(truth.map(function (v, i) { return [xs(i), ys(v)]; })), class: "line s-ink" });
      truth.forEach(function (v, i) { add(s1, "circle", { cx: xs(i), cy: ys(v), r: 3, class: "f-ink" }); });
      if (moved) {
        add(s1, "polyline", { points: pts(reported.map(function (v, i) { return [xs(i), ys(v)]; })), class: "line s-amber" });
        reported.forEach(function (v, i) { add(s1, "circle", { cx: xs(i), cy: ys(v), r: 3.4, class: "f-amber" }); });
      }
      /* Poincare plot */
      const pb = $("af-poincare"), P = boxWidth(pb, 320, 240, 400), pm = { l: 56, r: 12, t: 12, b: 42 };
      const s2 = S.svgRoot(pb, P, P, "Poincare plot: each interval against the next");
      const px = function (v) { return pm.l + ((v - lo) / (hi - lo)) * (P - pm.l - pm.r); };
      const py = function (v) { return P - pm.b - ((v - lo) / (hi - lo)) * (P - pm.t - pm.b); };
      const tk = ticks(lo, hi, 3);
      yGrid(s2, py, tk, pm.l, P - pm.r);
      xAxis(s2, px, P - pm.b, tk, null, "interval n (ms)", pm.l, P - pm.r);
      add(s2, "line", { x1: px(lo), y1: py(lo), x2: px(hi), y2: py(hi), class: "diag" });
      const pairs = function (w) { const o = []; for (let i = 0; i + 1 < w.length; i++) o.push([w[i], w[i + 1]]); return o; };
      if (compare) pairs(normal).forEach(function (p) { add(s2, "circle", { cx: px(p[0]), cy: py(p[1]), r: 3, class: "f-safe" }); });
      const pg = pairs(truth), pr = pairs(reported);
      if (moved) pg.forEach(function (p, i) { add(s2, "line", { x1: px(p[0]), y1: py(p[1]), x2: px(pr[i][0]), y2: py(pr[i][1]), class: "guide" }); });
      pg.forEach(function (p) { add(s2, "circle", { cx: px(p[0]), cy: py(p[1]), r: 3.4, class: "f-ink" }); });
      if (moved) pr.forEach(function (p) { add(s2, "circle", { cx: px(p[0]), cy: py(p[1]), r: 3.6, class: "f-amber" }); });
      const yl = (pm.t + P - pm.b) / 2;
      add(s2, "text", { x: 12, y: yl, "text-anchor": "middle", class: "axis-label", transform: "rotate(-90 12 " + yl + ")" }, "interval n + 1 (ms)");
      /* Watch */
      const p = pAF(reported), on = p >= 0.5;
      $("af-state").className = "alarm " + (on ? "on" : "off");
      $("af-state").textContent = on ? "Possible atrial fibrillation" : "No notification";
      $("af-prob").textContent = p.toFixed(3);
      $("af-prob").className = on ? "hot" : "";
      $("af-budget-val").textContent = budget + " ms";
      const ch = largestChange(reported, truth);
      $("af-change").textContent = Math.round(ch) + " ms";
      $("af-change").className = ch > 0 ? "warm" : "";
      $("af-queries").textContent = grouped(queries);
      drawCurve();
    }
    function drawCurve() {
      const cb = $("af-curve"), W = boxWidth(cb, 380, 240, 460), H = 210, m = { l: 46, r: 14, t: 14, b: 42 };
      const xmax = BUD[BUD.length - 1] + 10;
      const svg = S.svgRoot(cb, W, H, "Share of correct AF notifications silenced with at most each budget per beat");
      const xs = function (b) { return m.l + (b / xmax) * (W - m.l - m.r); };
      const ys = function (v) { return H - m.b - v * (H - m.t - m.b); };
      yGrid(svg, ys, [0, 0.25, 0.5, 0.75, 1], m.l, W - m.r, function (v) { return percent(v) + "%"; });
      xAxis(svg, xs, H - m.b, [0].concat(BUD.filter(function (b, i) { return W > 330 || i % 2 === 1; })), null, "change allowed per beat (ms)", m.l, W - m.r);
      let d = "M" + xs(0) + " " + ys(0), prev = 0;
      N6.curve.forEach(function (c) { d += " H" + xs(c.budget).toFixed(1) + " V" + ys(c.share).toFixed(1); prev = c.share; });
      d += " H" + xs(xmax).toFixed(1) + " V" + ys(prev).toFixed(1);
      add(svg, "path", { d: d, class: "line s-amber" });
      const c = N6.curve.filter(function (q) { return q.budget === budget; })[0];
      if (c) {
        add(svg, "line", { x1: xs(budget), x2: xs(budget), y1: m.t, y2: H - m.b, class: "guide" });
        add(svg, "circle", { cx: xs(budget), cy: ys(c.share), r: 5, class: "f-amber" });
        const right = xs(budget) > W - m.r - 120;
        add(svg, "text", { x: right ? xs(budget) - 9 : xs(budget) + 9, y: ys(c.share) + (c.share > 0.85 ? 18 : -9), "text-anchor": right ? "end" : "start", class: "strong" },
          percent(c.share) + "% at " + budget + " ms");
        $("af-curve-note").textContent = "Share of " + N6.attacked + " correct AF notifications in NB6 silenced with at most this much change per beat.";
      }
    }
    function nbText() {
      const b = E[j].budget;
      return b === null || b === undefined ? " In the NB6 run, no budget up to " + BUD[BUD.length - 1] + " ms silenced this window."
        : " In the NB6 run, this window first fell silent at " + b + " ms.";
    }
    function smoothed(x0, lo, hi) {
      const n = x0.length, p = [x0[0], x0[0]].concat(x0, [x0[n - 1], x0[n - 1]]);
      return x0.map(function (_, i) { return Math.min(hi[i], Math.max(lo[i], (p[i] + p[i + 1] + p[i + 2] + p[i + 3] + p[i + 4]) / 5)); });
    }
    function setBusy(on) {
      busy = on;
      ["af-attack", "af-reset", "af-example"].forEach(function (id) { $(id).disabled = on; });
      segBox.querySelectorAll("button").forEach(function (b) { b.disabled = on; });
    }
    $("af-attack").addEventListener("click", function () {
      if (busy) return;
      const x0 = truth.slice(), b = budget;
      if (!decide(x0)) { note.textContent = "The model does not notify for this window."; return; }
      const lo = x0.map(function (v) { return Math.max(v - b, 300); }), hi = x0.map(function (v) { return Math.min(v + b, 2000); });
      const mu = mean(x0), seed = 101 + 13 * j + b;
      const cands = [x0.map(function (v) { return v + Math.max(-b, Math.min(b, mu - v)); }), smoothed(x0, lo, hi)];
      const rand = X.mulberry32(seed);
      for (let n = 0; n < 100; n++) cands.push(x0.map(function (_, i) { return lo[i] + rand() * (hi[i] - lo[i]); }));
      reported = x0.slice();
      queries = 0;
      draw();
      setBusy(true);
      note.textContent = "The attacker sees only whether the watch notifies.";
      runSteps(hsjaSteps(decide, x0, lo, hi, cands, { seed: seed, iterations: 15, directions: 60 }), function (st) {
        queries = st.queries;
        if (st.x) reported = st.x.slice();
        draw();
      }, 150, function (res) {
        setBusy(false);
        queries = res.queries;
        reported = res.success ? res.x.slice() : x0.slice();
        draw();
        note.textContent = (res.success
          ? "Silenced with at most " + b + " ms per beat: largest change " + Math.round(res.linf) + " ms after " + grouped(res.queries) + " yes-or-no queries."
          : "Not silenced at " + b + " ms: none of the " + res.queries + " starting points within the budget silences the notification.") + nbText();
        S.store.set("p3:af", { budget: b, silenced: !!res.success });
        S.reveal($("s6-take"));
      });
    });
    $("af-reset").addEventListener("click", function () { if (!busy) load(j); });
    select.addEventListener("change", function () { if (!busy) load(parseInt(select.value, 10)); });
    $("af-compare").addEventListener("change", draw);
    segBox.addEventListener("click", function (e) {
      const b = e.target.closest ? e.target.closest("button[data-value]") : null;
      if (!b || busy) return;
      budget = parseInt(b.getAttribute("data-value"), 10);
      setPressed(segBox, budget);
      reported = truth.slice();
      queries = 0;
      note.textContent = "";
      draw();
    });
    load(j);
    onWidth($("af-tacho"), draw);
  }

  [initColdOpen, initLanes, initSilence, initDetect, initCampaign, initSepsis, initAF].forEach(function (init) {
    try { init(); } catch (e) { if (window.console) console.error(e); }
  });
})();
