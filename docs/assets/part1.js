/* Part 1 of the workshop site: the black box problem (Admission).
   A cold open and five stations on the data of NB1. Every number on the page is computed at run time
   from window.LAB_DATA; only the regulatory milestones and the true or false statements are static facts. */
(function () {
  "use strict";
  const S = window.XAISite, X = window.XAICore, D = window.LAB_DATA;
  if (!S || !X || !D || !D.wdbc || !D.nb1) return;

  const $ = function (id) { return document.getElementById(id); };
  const Y = D.wdbc.y, P = D.wdbc.p, PL = D.wdbc.p_lr, N = Y.length;
  const MINUS = "−";

  /* ---------- formatting ---------- */
  function pct(v) { return (100 * v).toFixed(1) + "%"; }
  function grouped(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function count(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function signed(v, d) { return (v < 0 ? MINUS : "+") + Math.abs(v).toFixed(d); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------- shared helpers ---------- */
  function confusion(p, t) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (let i = 0; i < N; i++) {
      const pos = p[i] >= t;
      if (pos && Y[i]) tp++; else if (pos) fp++; else if (Y[i]) fn++; else tn++;
    }
    return { tp: tp, fp: fp, fn: fn, tn: tn, acc: (tp + tn) / N, sens: tp / Math.max(1, tp + fn), spec: tn / Math.max(1, tn + fp) };
  }
  function ease(k) { return 1 - Math.pow(1 - k, 3); }
  function tween(ms, frame) {
    if (S.reduceMotion || typeof window.requestAnimationFrame !== "function") { frame(1); return Promise.resolve(); }
    return new Promise(function (resolve) {
      const t0 = performance.now();
      function step(now) {
        const k = Math.min(1, Math.max(0, (now - t0) / ms));
        frame(k);
        if (k < 1) window.requestAnimationFrame(step); else resolve();
      }
      window.requestAnimationFrame(step);
    });
  }
  /* Charts are drawn at the width they occupy, so their text keeps its size from phone to projector. */
  function widthOf(node, fallback) {
    const w = node ? node.clientWidth : 0;
    return Math.round(w > 120 ? w : fallback);
  }
  const redraws = [];
  let resizeTimer = null, lastWidth = window.innerWidth;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (Math.abs(window.innerWidth - lastWidth) < 2) return;
      lastWidth = window.innerWidth;
      redraws.forEach(function (f) { f(); });
    }, 150);
  });
  function axisX(s, xs, y, ticks, label, fmt) {
    S.add(s, "line", { x1: xs(ticks[0]), x2: xs(ticks[ticks.length - 1]), y1: y, y2: y, class: "axis" });
    ticks.forEach(function (v) {
      S.add(s, "line", { x1: xs(v), x2: xs(v), y1: y, y2: y + 4, class: "axis" });
      S.add(s, "text", { x: xs(v), y: y + 19, class: "tick", "text-anchor": "middle" }, fmt ? fmt(v) : String(v));
    });
    if (label) S.add(s, "text", { x: (xs(ticks[0]) + xs(ticks[ticks.length - 1])) / 2, y: y + 39, class: "axis-label", "text-anchor": "middle" }, label);
  }
  function axisLabelY(s, x, yMid, text) {
    S.add(s, "text", { transform: "translate(" + x + "," + yMid + ") rotate(-90)", class: "axis-label", "text-anchor": "middle" }, text);
  }
  /* Horizontal bar between a and b with a rounded data end and a square baseline end at a. */
  function hbar(a, b, y, h, r) {
    const w = Math.abs(b - a), rr = Math.min(r, w, h / 2), dir = b >= a ? 1 : -1, e = a + dir * w;
    if (w < 0.01) return "M" + a + " " + y + "H" + a + "V" + (y + h) + "Z";
    return "M" + a + " " + y + "H" + (e - dir * rr) + "Q" + e + " " + y + " " + e + " " + (y + rr) +
      "V" + (y + h - rr) + "Q" + e + " " + (y + h) + " " + (e - dir * rr) + " " + (y + h) + "H" + a + "Z";
  }
  function tile(v, label, tone) {
    return '<div class="stat' + (tone ? " " + tone : "") + '"><span class="v">' + v + '</span><span class="l">' + label + "</span></div>";
  }
  function titled(node, text) { S.add(node, "title", {}, text); return node; }

  /* ---------- cold open: the headline number and what it hides ---------- */
  function coldOpen() {
    const c = confusion(P, 0.5), target = 100 * c.acc;
    const num = $("hook-acc"), miss = $("hook-miss"), key = $("field-key");
    num.textContent = "0.0";
    document.querySelector(".p1-hero .hook").classList.add("ready");
    $("hook-n").textContent = grouped(N);
    $("hook-fn").textContent = count(c.fn, "cancer", "cancers") + " missed";
    $("key-fn").textContent = count(c.fn, "missed cancer", "missed cancers");
    $("key-fp").textContent = count(c.fp, "unnecessary work-up", "unnecessary work-ups");
    const cols = 24, rows = Math.ceil(N / cols), pitch = 20;
    const svg = S.svgRoot($("field"), cols * pitch, rows * pitch, "All " + N + " biopsies, one dot each. Red: the " + c.fn +
      " cancers the network called benign. Amber: the " + c.fp + " benign biopsies it sent to a work-up.");
    const dots = [], ok = [];
    for (let i = 0; i < N; i++) {
      const called = P[i] >= 0.5, kind = called === (Y[i] === 1) ? "ok" : Y[i] ? "fn" : "fp";
      const e = S.add(svg, "circle", { cx: (i % cols) * pitch + pitch / 2, cy: Math.floor(i / cols) * pitch + pitch / 2, r: 6.6, class: "cell" });
      dots.push({ e: e, kind: kind });
      if (kind === "ok") ok.push(e);
      else titled(e, "Biopsy " + i + ": " + (Y[i] ? "malignant" : "benign") + ", predicted probability of malignancy " + P[i].toFixed(3));
    }
    let lit = 0;
    function light(n) { for (; lit < n; lit++) ok[lit].setAttribute("class", "cell on"); }
    function finish() {
      light(ok.length);
      num.textContent = target.toFixed(1);
      dots.forEach(function (d) { if (d.kind !== "ok") d.e.setAttribute("class", "cell " + d.kind); });
      miss.classList.add("on");
      key.classList.add("on");
    }
    if (S.reduceMotion) { finish(); return; }
    S.wait(450)
      .then(function () {
        return tween(2100, function (k) {
          const e = ease(k);
          num.textContent = (target * e).toFixed(1);
          light(Math.round(e * ok.length));
        });
      })
      .then(function () { return S.wait(180); })
      .then(finish);
  }

  /* ---------- station 1: the threshold console ---------- */
  function station1() {
    const box = $("s1-console"), slider = $("thr"), out = $("thr-out"), live = $("thr-live"), stats = $("thr-stats"), chart = $("hist");
    let t = parseFloat(slider.value) || 0.5, shown = false, view = null, dragging = false;
    $("deploy-acc").textContent = (100 * confusion(P, 0.5).acc).toFixed(1);

    function update() {
      const c = confusion(P, t);
      out.textContent = t.toFixed(2);
      live.textContent = "At " + t.toFixed(2) + ": " + count(c.fn, "cancer", "cancers") + " missed, " +
        count(c.fp, "unnecessary work-up", "unnecessary work-ups") + ".";
      stats.innerHTML = tile(pct(c.acc), "accuracy", "wide") + tile(c.fn, "cancers missed", "alert") +
        tile(c.fp, "unnecessary work-ups", "amber") + tile(pct(c.sens), "sensitivity", "") + tile(pct(c.spec), "specificity", "");
      if (view) view.move(t);
    }
    function setT(v) {
      if (!isFinite(v)) return;
      t = Math.min(0.99, Math.max(0.01, Math.round(v * 100) / 100));
      slider.value = t.toFixed(2);
      update();
    }
    function commit() {
      const c = confusion(P, t);
      S.store.set("p1:threshold", { t: t, missed: c.fn, workups: c.fp });
      S.reveal($("s1-take"));
    }
    function draw() {
      const w = widthOf(chart, 700), h = Math.round(Math.min(360, Math.max(270, w * 0.52)));
      const m = { l: 54, r: 16, t: 36, b: 54 }, bins = 25;
      const s = S.svgRoot(chart, w, h, "Predicted probability of malignancy for all " + N + " biopsies by true diagnosis, with the decision threshold");
      const ben = new Array(bins).fill(0), mal = new Array(bins).fill(0);
      const benMax = new Array(bins).fill(-1), malMin = new Array(bins).fill(2);
      for (let i = 0; i < N; i++) {
        const k = Math.min(bins - 1, Math.floor(P[i] * bins));
        if (Y[i]) { mal[k]++; malMin[k] = Math.min(malMin[k], P[i]); }
        else { ben[k]++; benMax[k] = Math.max(benMax[k], P[i]); }
      }
      const maxC = Math.max.apply(null, ben.concat(mal));
      const xs = function (v) { return m.l + v * (w - m.l - m.r); };
      const ys = function (n) { return h - m.b - Math.sqrt(n / maxC) * (h - m.t - m.b); };
      const zone = S.add(s, "rect", { x: xs(t), y: m.t, width: 0, height: h - m.t - m.b, class: "zone" });
      [1, 10, 50, 100, 200, 300].filter(function (n) { return n <= maxC; }).forEach(function (n) {
        S.add(s, "line", { x1: m.l, x2: w - m.r, y1: ys(n), y2: ys(n), class: "gridline" });
        S.add(s, "text", { x: m.l - 8, y: ys(n) + 4, class: "tick", "text-anchor": "end" }, String(n));
      });
      axisLabelY(s, 15, (m.t + h - m.b) / 2, "biopsies, square-root scale");
      const bw = (w - m.l - m.r) / bins, half = Math.max(1, (bw - 4) / 2), bars = [];
      for (let k = 0; k < bins; k++) {
        const x0 = xs(k / bins) + 1.5, range = (k / bins).toFixed(2) + " to " + ((k + 1) / bins).toFixed(2);
        if (ben[k]) bars.push({ edge: benMax[k], mal: false,
          e: titled(S.add(s, "rect", { x: x0, y: ys(ben[k]), width: half, height: h - m.b - ys(ben[k]), rx: 1.5, class: "f-safe" }),
            count(ben[k], "benign biopsy", "benign biopsies") + " scored " + range) });
        if (mal[k]) bars.push({ edge: malMin[k], mal: true,
          e: titled(S.add(s, "rect", { x: x0 + half + 1, y: ys(mal[k]), width: half, height: h - m.b - ys(mal[k]), rx: 1.5, class: "f-alert" }),
            count(mal[k], "malignant biopsy", "malignant biopsies") + " scored " + range) });
      }
      axisX(s, xs, h - m.b, [0, 0.25, 0.5, 0.75, 1], "predicted probability of malignancy");
      const line = S.add(s, "line", { y1: m.t - 6, y2: h - m.b, class: "threshold" });
      const left = S.add(s, "text", { y: m.t - 14, "text-anchor": "end", class: "zone-label" }, "called benign");
      const right = S.add(s, "text", { y: m.t - 14, "text-anchor": "start", class: "zone-label" }, "called malignant");
      view = {
        w: w, m: m,
        move: function (tt) {
          const x = xs(tt);
          zone.setAttribute("x", x);
          zone.setAttribute("width", Math.max(0, xs(1) - x));
          line.setAttribute("x1", x);
          line.setAttribute("x2", x);
          left.setAttribute("x", x - 10);
          right.setAttribute("x", x + 10);
          left.style.display = x - m.l > 108 ? "" : "none";
          right.style.display = xs(1) - x > 128 ? "" : "none";
          /* A bar whose biopsies are all classified correctly at this threshold is drawn pale, so the errors stand out. */
          bars.forEach(function (b) {
            const correct = b.mal ? b.edge >= tt : b.edge < tt;
            b.e.setAttribute("class", (b.mal ? "f-alert" : "f-safe") + (correct ? " ok" : ""));
          });
        }
      };
      view.move(t);
    }
    function fromPointer(e) {
      if (!view) return;
      const r = chart.getBoundingClientRect();
      if (!r.width) return;
      const x = ((e.clientX - r.left) / r.width) * view.w;
      setT((x - view.m.l) / (view.w - view.m.l - view.m.r));
    }
    slider.addEventListener("input", function () { setT(parseFloat(slider.value)); });
    slider.addEventListener("change", function () { setT(parseFloat(slider.value)); commit(); });
    chart.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true;
      fromPointer(e);
      try { if (chart.setPointerCapture && e.pointerId !== undefined) chart.setPointerCapture(e.pointerId); } catch (err) { /* capture unavailable */ }
    });
    chart.addEventListener("pointermove", function (e) { if (dragging) fromPointer(e); });
    function endDrag() { if (dragging) { dragging = false; commit(); } }
    chart.addEventListener("pointerup", endDrag);
    chart.addEventListener("pointercancel", endDrag);
    redraws.push(function () { if (shown) draw(); });
    S.poll($("poll-deploy"), "p1-deploy", function () {
      if (shown) return;
      shown = true;
      box.hidden = false;
      box.classList.add("rise");
      draw();
      update();
    });
  }

  /* ---------- station 2: wrong and sure ---------- */
  function station2() {
    const cards = D.nb1.cards, grid = $("cards"), status = $("cards-status"), btnReveal = $("cards-reveal"), btnAgain = $("cards-again");
    const keys = D.nb1.card_features || ["mean radius", "mean concave points", "worst area"];
    const FEAT = {
      "mean radius": ["radius", function (v) { return v.toFixed(1); }],
      "mean concave points": ["concave points", function (v) { return v.toFixed(2); }],
      "worst area": ["area", grouped]
    };
    const nMal = cards.filter(function (c) { return c.truth === 1; }).length;
    /* The stated confidence is rounded down, so a card never claims more certainty than the model gave. */
    function sure(c) { return Math.min(99.9, Math.floor((1 - c.p) * 1000 + 1e-6) / 10); }
    $("cards-min").textContent = Math.min.apply(null, cards.map(sure)).toFixed(1);
    $("cards-n").textContent = String(cards.length);
    $("cards-mal").textContent = String(nMal);
    let revealed = false;

    const items = cards.map(function (c) {
      const feats = keys.map(function (k) {
        const spec = FEAT[k] || [k, function (v) { return String(v); }];
        return '<span><span class="k">' + esc(spec[0]) + '</span><span class="num">' + esc(spec[1](c.features[k])) + "</span></span>";
      }).join("");
      const b = S.el("button", { type: "button", class: "bcard", "aria-pressed": "false" },
        '<span class="bcard-in">' +
          '<span class="face front">' +
            '<span class="b-top"><span class="b-id">Biopsy ' + c.id + '</span><span class="b-flag">suspect</span></span>' +
            '<span class="b-verdict"><span class="b-chip">benign</span><span class="b-sure">' + sure(c).toFixed(1) + "% sure</span></span>" +
            '<span class="b-feats">' + feats + "</span>" +
            '<span class="b-act">Mark as suspect</span>' +
          "</span>" +
          '<span class="face back ' + (c.truth ? "mal" : "ben") + '" aria-hidden="true">' +
            '<span class="b-top"><span class="b-id">Biopsy ' + c.id + "</span></span>" +
            '<span class="b-truth"><strong>' + (c.truth ? "Malignant:" : "Benign:") + "</strong> " + (c.truth ? "missed by the model" : "correct") + "</span>" +
            '<span class="b-model">The network was ' + sure(c).toFixed(1) + "% sure it was benign.</span>" +
            '<span class="b-you"></span>' +
          "</span>" +
        "</span>");
      const it = { c: c, b: b, inner: b.querySelector(".bcard-in"), front: b.querySelector(".front"), back: b.querySelector(".back"),
                   act: b.querySelector(".b-act"), you: b.querySelector(".b-you") };
      b.addEventListener("click", function () {
        if (revealed) return;
        const on = b.getAttribute("aria-pressed") !== "true";
        b.setAttribute("aria-pressed", String(on));
        it.act.textContent = on ? "Marked as suspect" : "Mark as suspect";
        showCount();
      });
      grid.appendChild(b);
      return it;
    });
    function isMarked(it) { return it.b.getAttribute("aria-pressed") === "true"; }
    function showCount() {
      const k = items.filter(isMarked).length;
      status.textContent = k ? count(k, "biopsy", "biopsies") + " marked as suspect." : "No biopsy marked yet.";
    }
    function reveal() {
      if (revealed) return;
      revealed = true;
      let found = 0, falseMarks = 0;
      items.forEach(function (it, i) {
        const m = isMarked(it);
        if (m && it.c.truth) found++;
        if (m && !it.c.truth) falseMarks++;
        it.you.textContent = m ? "You marked it as suspect." : "Not marked.";
        it.inner.style.transitionDelay = S.reduceMotion ? "0ms" : i * 90 + "ms";
        it.b.classList.add("flipped");
        it.b.setAttribute("aria-disabled", "true");
        it.front.setAttribute("aria-hidden", "true");
        it.back.removeAttribute("aria-hidden");
      });
      status.textContent = "You marked " + found + " of the " + nMal + " cancers, and " +
        (falseMarks === 1 ? "1 benign biopsy" : falseMarks + " benign biopsies") + ".";
      status.classList.add("score");
      S.store.set("p1:cards", { found: found, of: nMal, falseMarks: falseMarks });
      btnReveal.hidden = true;
      btnAgain.hidden = false;
      S.reveal($("s2-take"));
    }
    function reset() {
      revealed = false;
      items.forEach(function (it) {
        it.inner.style.transitionDelay = "0ms";
        it.b.classList.remove("flipped");
        it.b.setAttribute("aria-pressed", "false");
        it.b.removeAttribute("aria-disabled");
        it.front.removeAttribute("aria-hidden");
        it.back.setAttribute("aria-hidden", "true");
        it.act.textContent = "Mark as suspect";
      });
      status.classList.remove("score");
      btnAgain.hidden = true;
      btnReveal.hidden = false;
      showCount();
      btnReveal.focus();
    }
    btnReveal.addEventListener("click", reveal);
    btnAgain.addEventListener("click", reset);
    showCount();
  }

  /* ---------- station 3: calibration ---------- */
  function station3() {
    const box = $("s3-console"), slider = $("band"), out = $("band-out"), rel = $("rel"), cols = $("band-cols");
    const models = [
      { name: "Neural network", cls: "ink", shape: "circle", p: P },
      { name: "Logistic regression", cls: "violet", shape: "square", p: PL }
    ];
    models.forEach(function (md) {
      md.ece = X.ece(Y, md.p);
      md.curve = quantileCurve(md.p, 8);
      md.bands = bandStats(md.p);
    });
    $("rel-n").textContent = grouped(N);
    let band = parseInt(slider.value, 10), shown = false, geom = null;

    function quantileCurve(p, bins) {
      const order = p.map(function (_, i) { return i; }).sort(function (a, b) { return p[a] - p[b]; });
      const res = [];
      for (let b = 0; b < bins; b++) {
        const chunk = order.slice(Math.floor((b * order.length) / bins), Math.floor(((b + 1) * order.length) / bins));
        let sp = 0, sy = 0;
        chunk.forEach(function (i) { sp += p[i]; sy += Y[i]; });
        res.push({ x: sp / chunk.length, y: sy / chunk.length, n: chunk.length });
      }
      return res;
    }
    function bandStats(p) {
      const res = [];
      for (let b = 0; b < 10; b++) res.push({ n: 0, k: 0, s: 0 });
      for (let i = 0; i < N; i++) {
        const b = Math.min(9, Math.floor(p[i] * 10));
        res[b].n++;
        res[b].k += Y[i];
        res[b].s += p[i];
      }
      res.forEach(function (o) { o.mean = o.n ? o.s / o.n : null; o.obs = o.n ? o.k / o.n : null; });
      return res;
    }
    function marker(s, md, x, y, r, hollow) {
      const cls = hollow ? "hollow s-" + md.cls : "f-" + md.cls + " ring";
      if (md.shape === "circle") return S.add(s, "circle", { cx: x, cy: y, r: r, class: cls });
      return S.add(s, "rect", { x: x - r * 0.9, y: y - r * 0.9, width: r * 1.8, height: r * 1.8, rx: 1.5, class: cls });
    }
    function drawRel() {
      const w = widthOf(rel, 540), h = Math.round(Math.min(460, Math.max(300, w * 0.82)));
      const m = { l: 58, r: 18, t: 16, b: 56 };
      const s = S.svgRoot(rel, w, h, "Reliability diagram: mean predicted probability against the observed share of malignant biopsies, eight quantile bins per model");
      const xs = function (v) { return m.l + v * (w - m.l - m.r); };
      const ys = function (v) { return h - m.b - v * (h - m.t - m.b); };
      geom = { w: w, m: m };
      S.add(s, "rect", { x: xs(band / 10), y: m.t, width: xs((band + 1) / 10) - xs(band / 10), height: h - m.t - m.b, class: "bandhl" });
      [0.25, 0.5, 0.75, 1].forEach(function (v) {
        S.add(s, "line", { x1: m.l, x2: w - m.r, y1: ys(v), y2: ys(v), class: "gridline" });
        S.add(s, "line", { x1: xs(v), x2: xs(v), y1: m.t, y2: h - m.b, class: "gridline" });
      });
      [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
        S.add(s, "text", { x: m.l - 8, y: ys(v) + 4, class: "tick", "text-anchor": "end" }, String(v));
      });
      S.add(s, "line", { x1: m.l, x2: m.l, y1: m.t, y2: h - m.b, class: "axis" });
      axisLabelY(s, 16, (m.t + h - m.b) / 2, "observed share malignant");
      S.add(s, "line", { x1: xs(0), y1: ys(0), x2: xs(1), y2: ys(1), class: "diag" });
      axisX(s, xs, h - m.b, [0, 0.25, 0.5, 0.75, 1], "mean predicted probability");
      models.forEach(function (md) {
        S.add(s, "polyline", { points: md.curve.map(function (c) { return xs(c.x) + "," + ys(c.y); }).join(" "), class: "line s-" + md.cls });
      });
      models.forEach(function (md) {
        md.curve.forEach(function (c) {
          titled(marker(s, md, xs(c.x), ys(c.y), 5.5, false), md.name + ": mean score " + c.x.toFixed(3) + ", observed " + c.y.toFixed(3) + " (" + c.n + " biopsies)");
        });
      });
    }
    function drawDumbbell(el, md, b, lo, hi) {
      const w = widthOf(el, 220), h = 52, g = { l: 9, r: 9 }, y = 17;
      const s = S.svgRoot(el, w, h, md.name + ": mean score " + b.mean.toFixed(2) + ", observed share malignant " + b.obs.toFixed(2));
      const xs = function (v) { return g.l + v * (w - g.l - g.r); };
      S.add(s, "rect", { x: xs(lo), y: 4, width: xs(hi) - xs(lo), height: 26, class: "bandhl" });
      S.add(s, "line", { x1: xs(0), x2: xs(1), y1: y, y2: y, class: "gridline" });
      [0, 0.5, 1].forEach(function (v) {
        S.add(s, "line", { x1: xs(v), x2: xs(v), y1: y - 4, y2: y + 4, class: "gridline" });
        S.add(s, "text", { x: xs(v), y: h - 3, class: "tick", "text-anchor": v === 0 ? "start" : v === 1 ? "end" : "middle" }, String(v));
      });
      S.add(s, "line", { x1: xs(b.mean), x2: xs(b.obs), y1: y, y2: y, class: "line s-" + md.cls });
      marker(s, md, xs(b.mean), y, 6, true);
      marker(s, md, xs(b.obs), y, 6, false);
    }
    function drawBand() {
      const lo = band / 10, hi = (band + 1) / 10;
      out.textContent = lo.toFixed(1) + " to " + hi.toFixed(1);
      $("band-h").textContent = "Among biopsies each model scored between " + lo.toFixed(1) + " and " + hi.toFixed(1);
      cols.innerHTML = "";
      models.forEach(function (md) {
        const b = md.bands[band];
        const col = S.el("div", { class: "bandcol c-" + md.cls });
        col.innerHTML = '<p class="bc-name"><span class="sw' + (md.shape === "circle" ? " dot" : "") + '" aria-hidden="true"></span>' + md.name + "</p>" +
          (b.n ? '<p class="bc-big">' + b.k + " of " + b.n + '</p><p class="bc-sub">were malignant</p>'
               : '<p class="bc-big">none</p><p class="bc-sub">no biopsy in this band</p>');
        cols.appendChild(col);
        if (!b.n) return;
        const ch = S.el("div", { class: "chart bc-chart" });
        col.appendChild(ch);
        col.appendChild(S.el("p", { class: "bc-vals" },
          '<span><span class="mk-key hollow" aria-hidden="true"></span>mean score ' + b.mean.toFixed(2) + "</span>" +
          '<span><span class="mk-key" aria-hidden="true"></span>observed ' + b.obs.toFixed(2) + "</span>"));
        drawDumbbell(ch, md, b, lo, hi);
      });
    }
    function setBand(b, settle) {
      band = Math.min(9, Math.max(0, b));
      slider.value = String(band);
      drawRel();
      drawBand();
      if (settle) S.reveal($("s3-take"));
    }
    function writeEce() {
      $("ece").innerHTML = models.map(function (md) {
        return tile(md.ece.toFixed(3), "expected calibration error, " + md.name.toLowerCase(), "");
      }).join("");
      const a = models[0], b = models[1], better = a.ece <= b.ece ? a : b, worse = better === a ? b : a;
      let text = Math.abs(a.ece - b.ece) < 0.005
        ? "Both models have a similar expected calibration error."
        : better.name + " has the lower expected calibration error, " + better.ece.toFixed(3) + " against " + worse.ece.toFixed(3) + ".";
      const mid = function (p) { return p.filter(function (v) { return v >= 0.1 && v < 0.9; }).length; };
      const mn = mid(P), ml = mid(PL);
      text += mn < ml
        ? " The network pushes its scores to the extremes: only " + mn + " of " + grouped(N) + " lie between 0.1 and 0.9, against " + ml + " for logistic regression."
        : " Scores between 0.1 and 0.9: " + mn + " of " + grouped(N) + " for the network, " + ml + " for logistic regression.";
      $("cal-text").textContent = text;
    }
    slider.addEventListener("input", function () { setBand(parseInt(slider.value, 10), false); });
    slider.addEventListener("change", function () { setBand(parseInt(slider.value, 10), true); });
    rel.addEventListener("click", function (e) {
      if (!geom) return;
      const r = rel.getBoundingClientRect();
      if (!r.width) return;
      const v = (((e.clientX - r.left) / r.width) * geom.w - geom.m.l) / (geom.w - geom.m.l - geom.m.r);
      if (v < 0 || v > 1) return;
      setBand(Math.floor(v * 10), true);
    });
    redraws.push(function () { if (shown) { drawRel(); drawBand(); } });
    S.poll($("poll-cal"), "p1-calibration", function () {
      if (shown) return;
      shown = true;
      box.hidden = false;
      box.classList.add("rise");
      writeEce();
      drawRel();
      drawBand();
    });
  }

  /* ---------- station 4: the shortcut ---------- */
  function station4() {
    const sc = D.nb1.shortcut, box = $("s4-console"), aucEl = $("auc"), impEl = $("imp");
    const MODELS = { with_site: "Model may use the site", without_site: "Model without the site" };
    const ROWS = [["internal", "Internal test"], ["external", "External hospital"]];
    let shown = false, model = "with_site", aucView = null, cur = null, impShown = false;

    function drawWaffles() {
      const host = $("hosps"), colsN = 20, pitch = 10;
      const H = [["development", "Development hospital"], ["external", "External hospital"]];
      let maxRows = 0;
      H.forEach(function (hh) {
        [0, 1].forEach(function (site) {
          const c = sc.counts[hh[0]];
          maxRows = Math.max(maxRows, Math.ceil((c["site" + site + "_benign"] + c["site" + site + "_malignant"]) / colsN));
        });
      });
      host.innerHTML = "";
      H.forEach(function (hh) {
        const c = sc.counts[hh[0]];
        const n = c.site0_benign + c.site0_malignant + c.site1_benign + c.site1_malignant;
        const fig = S.el("figure", { class: "hosp" }, "<figcaption><strong>" + hh[1] + "</strong><span>" + grouped(n) + ' biopsies</span></figcaption><div class="sites"></div>');
        const sites = fig.querySelector(".sites");
        [0, 1].forEach(function (site) {
          const mal = c["site" + site + "_malignant"], ben = c["site" + site + "_benign"], total = mal + ben;
          const cell = S.el("div", { class: "site" });
          const wf = S.el("div", { class: "waffle" });
          cell.appendChild(wf);
          cell.appendChild(S.el("p", { class: "site-l" }, "<strong>site " + site + "</strong><span>" + mal + " of " + total + " malignant</span>"));
          sites.appendChild(cell);
          const s = S.svgRoot(wf, colsN * pitch, maxRows * pitch, hh[1] + ", site " + site + ": " + mal + " malignant and " + ben + " benign biopsies");
          for (let k = 0; k < total; k++) {
            const col = k % colsN, row = Math.floor(k / colsN);
            S.add(s, "circle", { cx: col * pitch + pitch / 2, cy: (maxRows - 1 - row) * pitch + pitch / 2, r: 3.9, class: k < mal ? "f-alert" : "f-safe" });
          }
        });
        host.appendChild(fig);
      });
    }
    function drawAuc() {
      const w = widthOf(aucEl, 640), rowH = 64, m = { l: 4, r: 64, t: 6, b: 50 }, h = m.t + ROWS.length * rowH + m.b;
      const s = S.svgRoot(aucEl, w, h, "AUROC on the internal test set and at the external hospital");
      const xs = function (v) { return m.l + ((v - 0.5) / 0.5) * (w - m.l - m.r); };
      [0.6, 0.7, 0.8, 0.9, 1].forEach(function (v) {
        S.add(s, "line", { x1: xs(v), x2: xs(v), y1: m.t, y2: h - m.b, class: "gridline" });
      });
      axisX(s, xs, h - m.b, [0.5, 0.6, 0.7, 0.8, 0.9, 1], "AUROC, from 0.5 (chance) to 1", function (v) { return v.toFixed(1); });
      const rows = ROWS.map(function (r, i) {
        const y = m.t + i * rowH;
        S.add(s, "text", { x: m.l, y: y + 17, class: "rowlabel" }, r[1]);
        S.add(s, "rect", { x: xs(0.5), y: y + 26, width: xs(1) - xs(0.5), height: 24, rx: 3, class: "track" });
        const bar = S.add(s, "path", { d: hbar(xs(0.5), xs(0.5), y + 26, 24, 4), class: "f-ink" });
        const val = S.add(s, "text", { x: xs(0.5) + 8, y: y + 43, class: "val strong big" }, "");
        return { y: y, bar: bar, val: val };
      });
      const ghost = S.add(s, "line", { y1: rows[1].y + 22, y2: rows[1].y + 54, class: "ghost" });
      const ghostLabel = S.add(s, "text", { y: rows[1].y + 17, "text-anchor": "middle", class: "tick" }, "internal");
      aucView = {
        set: function (vals) {
          rows.forEach(function (r, i) {
            const v = Math.max(0.5, vals[i]);
            r.bar.setAttribute("d", hbar(xs(0.5), xs(v), r.y + 26, 24, 4));
            r.val.setAttribute("x", xs(v) + 8);
            r.val.textContent = vals[i].toFixed(3);
          });
          const gx = xs(Math.max(0.5, vals[0]));
          ghost.setAttribute("x1", gx);
          ghost.setAttribute("x2", gx);
          ghostLabel.setAttribute("x", gx);
        }
      };
      if (cur) aucView.set(cur);
    }
    function setModel(k, animate) {
      model = k;
      box.querySelectorAll("[data-model]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-model") === k)); });
      const target = [sc.internal[k], sc.external[k]], from = cur || [0.5, 0.5];
      const d = target[1] - target[0];
      const note = $("auc-note");
      note.innerHTML = MODELS[k] + ". " + (d < 0 ? "Drop" : "Change") + " at the external hospital: <strong>" + signed(d, 3) + "</strong>.";
      note.className = "auc-note" + (d <= -0.05 ? " bad" : "");
      if (!animate) { cur = target; aucView.set(cur); return; }
      tween(700, function (q) {
        const e = ease(q);
        cur = [from[0] + (target[0] - from[0]) * e, from[1] + (target[1] - from[1]) * e];
        aucView.set(cur);
      }).then(function () { cur = target; aucView.set(cur); });
    }
    function drawImp(animate) {
      const rows = sc.importance.slice().sort(function (a, b) { return b.mean - a.mean; });
      const w = widthOf(impEl, 640), rowH = 31, lab = Math.min(200, Math.round(w * 0.42));
      const m = { l: lab, r: 24, t: 8, b: 56 }, h = m.t + rows.length * rowH + m.b;
      const hiV = Math.max.apply(null, rows.map(function (r) { return r.mean + r.std; }));
      const loV = Math.min(0, Math.min.apply(null, rows.map(function (r) { return r.mean - r.std; })));
      const step = hiV > 0.2 ? 0.1 : hiV > 0.1 ? 0.05 : 0.02, top = Math.ceil(hiV / step) * step;
      const s = S.svgRoot(impEl, w, h, "Permutation importance of the site-aware model: drop in internal test AUROC when each feature is shuffled");
      const xs = function (v) { return m.l + ((v - loV) / (top - loV)) * (w - m.l - m.r); };
      const ticks = [];
      for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
      ticks.forEach(function (v) { S.add(s, "line", { x1: xs(v), x2: xs(v), y1: m.t, y2: h - m.b, class: "gridline" }); });
      S.add(s, "line", { x1: xs(0), x2: xs(0), y1: m.t, y2: h - m.b, class: "axis" });
      axisX(s, xs, h - m.b, ticks, "drop in internal test AUROC when shuffled", function (v) { return String(v); });
      const bars = rows.map(function (r, i) {
        const y = m.t + i * rowH, site = r.feature === "acquisition_site";
        S.add(s, "text", { x: m.l - 10, y: y + 20, "text-anchor": "end", class: site ? "strong" : "" }, r.feature);
        const bar = titled(S.add(s, "path", { d: hbar(xs(0), xs(0), y + 6, 19, 4), class: site ? "f-alert" : "f-muted" }),
          r.feature + ": " + r.mean.toFixed(4) + " plus or minus " + r.std.toFixed(4));
        const err = S.add(s, "g", { class: "err" });
        S.add(err, "line", { x1: xs(r.mean - r.std), x2: xs(r.mean + r.std), y1: y + 15.5, y2: y + 15.5 });
        S.add(err, "line", { x1: xs(r.mean - r.std), x2: xs(r.mean - r.std), y1: y + 10.5, y2: y + 20.5 });
        S.add(err, "line", { x1: xs(r.mean + r.std), x2: xs(r.mean + r.std), y1: y + 10.5, y2: y + 20.5 });
        if (i === 0) S.add(s, "text", { x: xs(r.mean + r.std) + 8, y: y + 20, class: "val strong" }, r.mean.toFixed(3));
        return { r: r, y: y, bar: bar, err: err };
      });
      const grow = function (k) {
        bars.forEach(function (b) { b.bar.setAttribute("d", hbar(xs(0), xs(0) + (xs(b.r.mean) - xs(0)) * k, b.y + 6, 19, 4)); });
      };
      if (!animate) { grow(1); return; }
      bars.forEach(function (b) { b.err.style.opacity = "0"; });
      tween(800, function (q) { grow(ease(q)); }).then(function () { bars.forEach(function (b) { b.err.style.opacity = ""; }); });
    }
    function impNote() {
      const rows = sc.importance.slice().sort(function (a, b) { return b.mean - a.mean; });
      const a = rows[0], b = rows[1];
      $("imp-note").textContent = a.feature === "acquisition_site" && b && b.mean > 0
        ? "Shuffling acquisition_site lowers the internal AUROC by " + a.mean.toFixed(3) + ", " + (a.mean / b.mean).toFixed(1) +
          " times as much as the next variable, " + b.feature + "."
        : "The largest drop in internal AUROC comes from " + a.feature + ".";
    }
    box.querySelectorAll("[data-model]").forEach(function (b) {
      b.addEventListener("click", function () { if (b.getAttribute("data-model") !== model) setModel(b.getAttribute("data-model"), true); });
    });
    $("open-box").addEventListener("click", function () {
      if (impShown) return;
      impShown = true;
      $("blackbox").hidden = true;
      $("imp-wrap").hidden = false;
      $("imp-wrap").classList.add("rise");
      impNote();
      drawImp(true);
      S.reveal($("s4-take"));
    });
    drawWaffles();
    redraws.push(function () {
      if (shown) drawAuc();
      if (impShown) drawImp(false);
    });
    S.poll($("poll-site"), "p1-shortcut", function () {
      if (shown) return;
      shown = true;
      box.hidden = false;
      box.classList.add("rise");
      drawAuc();
      setModel(model, true);
    });
  }

  /* ---------- station 5: the mandates (static facts, checked on 28 September 2026) ---------- */
  const KINDS = { act: "EU AI Act", gdpr: "GDPR and courts", fda: "FDA", today: "Today" };
  const WORKSHOP = "2026-10-28";
  const MILESTONES = [
    { d: "2016-05-04", date: "4 May 2016", day: "4 May", short: "GDPR published", k: "gdpr",
      text: "GDPR, Regulation (EU) 2016/679, published; applies from 25 May 2018. Article 22 restricts decisions based solely on automated processing; Articles 13 to 15 require meaningful information about the logic involved." },
    { d: "2023-12-07", date: "7 December 2023", day: "7 December", short: "SCHUFA judgment", k: "gdpr",
      text: "Court of Justice, case C-634/21 SCHUFA: A score on which a decision strongly relies can itself be an automated decision." },
    { d: "2024-06", date: "June 2024", day: "June", short: "Transparency principles", k: "fda",
      text: "FDA, Health Canada and MHRA guiding principles on transparency for machine learning-enabled medical devices." },
    { d: "2024-07-12", date: "12 July 2024", day: "12 July", short: "AI Act published", k: "act",
      text: "EU AI Act, Regulation (EU) 2024/1689, published. Article 13 requires high-risk systems to be transparent enough for deployers to interpret and use their output." },
    { d: "2024-12", date: "December 2024", day: "December", short: "Change control plans", k: "fda",
      text: "FDA final guidance on predetermined change control plans for AI-enabled device software functions." },
    { d: "2025-01", date: "January 2025", day: "January", short: "Lifecycle draft", k: "fda",
      text: "FDA draft guidance on lifecycle management of AI-enabled device software functions (still a draft in September 2026)." },
    { d: "2025-02-02", date: "2 February 2025", day: "2 February", short: "Prohibitions apply", k: "act",
      text: "Prohibited AI practices under the AI Act apply." },
    { d: "2025-02-27", date: "27 February 2025", day: "27 February", short: "Dun & Bradstreet", k: "gdpr",
      text: "Court of Justice, case C-203/22 Dun & Bradstreet Austria: The logic of an automated decision must be explained in an intelligible way." },
    { d: "2026-02", date: "February 2026", day: "February", short: "Cyber\u00ADsecurity guidance", k: "fda",
      text: "FDA final guidance on cybersecurity in medical devices." },
    { d: "2026-07-27", date: "27 July 2026", day: "27 July", short: "Digital Omnibus", k: "act",
      text: "Digital Omnibus on AI, Regulation (EU) 2026/1744, in force; it moved the start of the high-risk obligations." },
    { d: "2026-08-02", date: "2 August 2026", day: "2 August", short: "Article 50 applies", k: "act",
      text: "AI Act transparency obligations of Article 50 apply." },
    { d: "2026-10-28", date: "28 October 2026", day: "28 October", short: "Today", k: "today", text: "This workshop." },
    { d: "2027-12-02", date: "2 December 2027", day: "2 December", short: "Annex III high-risk", k: "act", id: "annex3",
      text: "High-risk obligations for Annex III systems apply." },
    { d: "2028-08-02", date: "2 August 2028", day: "2 August", short: "Medical devices, Annex I", k: "act", id: "annex1",
      text: "High-risk obligations for AI in medical devices (Annex I) apply." }
  ];
  const STATEMENTS = [
    { q: "If a clinician can always override the tool, the EU AI Act does not apply.", a: false,
      why: "AI that is, or is a safety component of, a medical device needing a notified body is high-risk through Annex I, and human oversight (Article 14) is itself one of its obligations." },
    { q: "For clinical decision support software to fall outside the FDA's device definition, the professional must be able to review the basis of its recommendation independently.", a: true,
      why: "This is one of the criteria in section 520(o)(1)(E) of the FD&C Act." },
    { q: "A clinician in the loop removes every GDPR duty to explain.", a: false,
      why: "A human decision narrows Article 22, but the information duties of Articles 13 to 15 remain, and the Court of Justice has read them broadly." }
  ];

  /* Whole months from date a to date b, both written as YYYY-MM-DD. */
  function monthsBetween(a, b) {
    const A = a.split("-").map(Number), B = b.split("-").map(Number);
    let n = (B[0] - A[0]) * 12 + (B[1] - A[1]);
    if (B[2] < A[2]) n--;
    return n;
  }

  function station5() {
    const tl = $("tl"), card = $("tl-card"), pos = $("tl-pos"), prev = $("tl-prev"), next = $("tl-next");
    const years = [2016, "gap", 2023, 2024, 2025, 2026, 2027, 2028];
    const byId = {};
    MILESTONES.forEach(function (m) { if (m.id) byId[m.id] = m; });
    let sel = -1;
    const nowYear = Number(WORKSHOP.slice(0, 4));
    const t0 = Date.UTC(nowYear, 0, 1), t1 = Date.UTC(nowYear + 1, 0, 1);
    const w = WORKSHOP.split("-").map(Number), at = ((Date.UTC(w[0], w[1] - 1, w[2]) - t0) / (t1 - t0)).toFixed(3);
    years.forEach(function (y) {
      const gap = y === "gap", ahead = !gap && y > nowYear, now = y === nowYear;
      const col = S.el("div", { class: "tl-col" + (gap ? " gap" : "") + (ahead ? " ahead" : "") + (now ? " now" : "") },
        '<p class="tl-y">' + (gap ? "2017 to 2022" : y) + '</p><div class="tl-axis" aria-hidden="true">' + (now ? '<span class="tl-now"></span>' : "") +
        '</div><div class="tl-items"></div>');
      if (now) col.style.setProperty("--at", at);
      const list = col.querySelector(".tl-items");
      if (!gap) {
        MILESTONES.forEach(function (m, i) {
          if (Number(m.d.slice(0, 4)) !== y) return;
          const b = S.el("button", { type: "button", class: "ms " + m.k + (m.d > WORKSHOP ? " future" : ""), "aria-pressed": "false",
                                     "aria-label": m.date + ", " + KINDS[m.k] + ": " + m.short.replace(/\u00AD/g, "") },
            '<span class="mk" aria-hidden="true"></span><span class="ms-d">' + esc(m.day) + '</span><span class="ms-t">' + esc(m.short) + "</span>");
          b.addEventListener("click", function () { select(i); });
          list.appendChild(b);
          m.btn = b;
        });
      }
      tl.appendChild(col);
    });
    function select(i) {
      sel = Math.max(0, Math.min(MILESTONES.length - 1, i));
      const m = MILESTONES[sel];
      MILESTONES.forEach(function (x, j) { x.btn.setAttribute("aria-pressed", String(j === sel)); });
      let when = "";
      if (m.d > WORKSHOP) {
        when = "About " + count(monthsBetween(WORKSHOP, m.d), "month", "months") + " after this workshop.";
      } else if (m.k === "today" && byId.annex3 && byId.annex1) {
        when = "Annex III obligations apply in about " + count(monthsBetween(WORKSHOP, byId.annex3.d), "month", "months") +
          ", those for medical devices in about " + count(monthsBetween(WORKSHOP, byId.annex1.d), "month", "months") + ".";
      }
      card.className = "tl-card " + m.k;
      card.innerHTML = '<p class="tl-meta"><span class="tl-kind"><span class="mk" aria-hidden="true"></span>' + KINDS[m.k] + '</span><span class="tl-date">' +
        esc(m.date) + '</span></p><p class="tl-text">' + esc(m.text) + "</p>" + (when ? '<p class="tl-when">' + esc(when) + "</p>" : "");
      pos.textContent = (sel + 1) + " of " + MILESTONES.length;
      prev.disabled = sel === 0;
      next.disabled = sel === MILESTONES.length - 1;
    }
    prev.addEventListener("click", function () { select(sel - 1); });
    next.addEventListener("click", function () { select(sel + 1); });
    select(0);

    const list = $("tf"), scoreEl = $("tf-score");
    let answered = 0, score = 0;
    STATEMENTS.forEach(function (st, i) {
      const li = S.el("li", { class: "tf-item" },
        '<p class="tf-q">' + esc(st.q) + '</p><div class="tf-a" role="group" aria-label="Statement ' + (i + 1) + '">' +
        '<button type="button" class="btn" data-a="true" aria-pressed="false">True</button><button type="button" class="btn" data-a="false" aria-pressed="false">False</button></div>' +
        '<p class="tf-r" aria-live="polite"></p>');
      const buttons = Array.prototype.slice.call(li.querySelectorAll("button[data-a]")), res = li.querySelector(".tf-r");
      buttons.forEach(function (b) {
        b.addEventListener("click", function () {
          if (li.classList.contains("done")) return;
          li.classList.add("done");
          const ok = (b.getAttribute("data-a") === "true") === st.a;
          b.setAttribute("aria-pressed", "true");
          buttons.forEach(function (x) { x.setAttribute("aria-disabled", "true"); });
          if (ok) score++;
          answered++;
          li.classList.add(ok ? "right" : "wrong");
          res.innerHTML = '<span class="tf-v">' + (ok ? "Correct." : "Not quite.") + "</span> <strong>" + (st.a ? "True:" : "False:") + "</strong> " + esc(st.why);
          if (answered === STATEMENTS.length) {
            scoreEl.textContent = score + " of " + STATEMENTS.length + " correct.";
            S.store.set("p1:mandates", { score: score, of: STATEMENTS.length });
            S.reveal($("s5-take"));
          }
        });
      });
      list.appendChild(li);
    });
  }

  coldOpen();
  station1();
  station2();
  station3();
  station4();
  station5();
})();
