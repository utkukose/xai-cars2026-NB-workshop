/* XAI Lab user interface. Depends on lab-data.js (window.LAB_DATA) and lab-core.js (window.XAICore). */
(function () {
  "use strict";
  const D = window.LAB_DATA, X = window.XAICore;
  const NS = "http://www.w3.org/2000/svg";
  const $ = function (id) { return document.getElementById(id); };
  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : true;

  /* ---------- small drawing helpers ---------- */
  function svgRoot(container, w, h, label) {
    container.innerHTML = "";
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 " + w + " " + h);
    s.setAttribute("role", "img");
    if (label) s.setAttribute("aria-label", label);
    container.appendChild(s);
    return s;
  }

  function add(parent, tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    parent.appendChild(e);
    return e;
  }

  function signed(v, d) { return (v >= 0 ? "+" : "\u2212") + Math.abs(v).toFixed(d); }
  function pct(v) { return (100 * v).toFixed(1) + "%"; }

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

  /* ---------- theme and tabs ---------- */
  const themeButton = $("theme");
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    themeButton.textContent = t === "dark" ? "Paper view" : "Monitor view";
    themeButton.setAttribute("aria-pressed", String(t === "dark"));
  }
  applyTheme(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  themeButton.addEventListener("click", function () {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  const tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  const init = { deploy: initDeploy, explain: initExplain, shapley: initShapley, spoof: initSpoof };
  const started = {};
  function openTab(tab, focus) {
    tabs.forEach(function (t) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    });
    const key = tab.id.replace("tab-", "");
    if (!started[key]) { started[key] = true; init[key](); }
    if (focus) tab.focus();
    if (window.history && history.replaceState) history.replaceState(null, "", "#" + key);
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { openTab(t); });
    t.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      openTab(tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length], true);
    });
  });

  /* ---------- 1. Deploy? ---------- */
  function initDeploy() {
    const y = D.wdbc.y, p = D.wdbc.p, slider = $("thr");
    function update() {
      const t = parseFloat(slider.value);
      $("thr-out").textContent = t.toFixed(2);
      let tp = 0, fp = 0, fn = 0, tn = 0;
      for (let i = 0; i < y.length; i++) {
        const pos = p[i] >= t;
        if (pos && y[i]) tp++; else if (pos) fp++; else if (y[i]) fn++; else tn++;
      }
      const stat = function (v, l, tone) {
        return '<div class="stat' + (tone ? " " + tone : "") + '"><span class="v">' + v + '</span><span class="l">' + l + "</span></div>";
      };
      $("deploy-stats").innerHTML = stat(pct((tp + tn) / y.length), "accuracy") + stat(fn, "cancers missed", "alert") +
        stat(fp, "unnecessary work-ups", "amber") + stat(pct(tp / (tp + fn)), "sensitivity") + stat(pct(tn / (tn + fp)), "specificity");
      drawHist(t);
      drawErrors(t);
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
      return "<li>Biopsy " + e.i + " is " + (y[e.i] ? "malignant" : "benign") + "; the model gave P(malignant) = " +
        p[e.i].toFixed(3) + "</li>";
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
    [["p", "c-alert", "neural network"], ["p_lr", "c-safe", "logistic regression"]].forEach(function (spec) {
      const p = D.wdbc[spec[0]], order = p.map(function (_, i) { return i; }).sort(function (a, b) { return p[a] - p[b]; });
      const pts = [];
      for (let b = 0; b < 8; b++) {
        const chunk = order.slice(Math.floor(b * order.length / 8), Math.floor((b + 1) * order.length / 8));
        const mp = chunk.reduce(function (a, i) { return a + p[i]; }, 0) / chunk.length;
        const my = chunk.reduce(function (a, i) { return a + D.wdbc.y[i]; }, 0) / chunk.length;
        pts.push(xs(mp) + "," + ys(my));
      }
      add(s, "polyline", { points: pts.join(" "), class: "line " + spec[1] });
      pts.forEach(function (pt) { const c = pt.split(","); add(s, "circle", { cx: c[0], cy: c[1], r: 3.5, class: "dot " + spec[1] }); });
    });
    legend(s, [["neural network", "f-alert"], ["logistic regression", "f-safe"]], m.l + 8, m.t + 4);
    $("calib-note").textContent = "Expected calibration error: neural network " + X.ece(D.wdbc.y, D.wdbc.p).toFixed(3) +
      ", logistic regression " + X.ece(D.wdbc.y, D.wdbc.p_lr).toFixed(3) + ". Points on the diagonal mean that stated and observed frequencies agree.";
  }

  /* ---------- shared heart-model helpers ---------- */
  const HD = D.heart;
  const heartRisk = function (z) { return X.proba(HD.model, z); };
  function valueText(feat, v) {
    if (feat.type === "cat") {
      const o = feat.options.filter(function (op) { return op[0] === v; })[0];
      return o ? o[1] : String(v);
    }
    return (Math.round(v * 10) / 10) + (feat.unit ? " " + feat.unit : "");
  }
  function fillPatients(select) {
    HD.patients.forEach(function (x, i) {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = "Test patient " + (i + 1) + ": " + (HD.labels[i] ? "disease" : "no disease") + ", risk " + heartRisk(x).toFixed(2);
      select.appendChild(o);
    });
  }

  /* ---------- 2. Explain a patient ---------- */
  function initExplain() {
    const F = HD.features, select = $("patient"), box = $("feature-controls");
    let current = HD.patients[0].slice(), lastShap = null, limeSeed = 1, lastTop = null;
    fillPatients(select);
    const inputs = F.map(function (feat, j) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const label = document.createElement("label");
      label.htmlFor = "fx-" + feat.key;
      label.textContent = feat.label + (feat.unit ? " (" + feat.unit + ")" : "");
      wrap.appendChild(label);
      let input;
      if (feat.type === "num") {
        const row = document.createElement("div");
        row.className = "slider-row";
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
      $("risk").className = "risk " + (r >= 0.5 ? "hi" : "lo");
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
      const top = w.map(function (v, j) { return [Math.abs(v), j]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, 5).map(function (p) { return p[1]; });
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
      if (p0 < 0.5) { out.textContent = "The model already predicts no disease for these values."; return; }
      const res = X.counterfactual(heartRisk, current, { kind: F.map(function (ft) { return ft.cf; }), lo: HD.lo, hi: HD.hi, scale: HD.scale, target: 0.5 });
      if (!res.success) { out.textContent = "No counterfactual exists within the plausible ranges of the variables that may change."; return; }
      const rows = F.map(function (ft, j) { return { ft: ft, a: current[j], b: res.x[j] }; }).filter(function (c) { return c.a !== c.b; })
        .map(function (c) { return "<tr><td>" + c.ft.label + "</td><td>" + valueText(c.ft, c.a) + "</td><td>" + valueText(c.ft, c.b) + "</td></tr>"; }).join("");
      out.innerHTML = "<table><thead><tr><th>Variable</th><th>Now</th><th>Counterfactual</th></tr></thead><tbody>" + rows +
        "</tbody></table><p>Risk " + p0.toFixed(2) + " becomes " + res.p.toFixed(2) + ". Only resting blood pressure, cholesterol, maximum heart rate, ST depression, exercise-induced angina and the vessel count may change, within the range seen in the training data. A very small change that flips the prediction reveals a sharp step in the model.</p>";
    });
    load(0);
  }

  /* ---------- 3. Shapley by hand ---------- */
  function initShapley() {
    const F = HD.features, psel = $("sh-patient"), sels = [$("sh-a"), $("sh-b"), $("sh-c")];
    fillPatients(psel);
    const defaults = ["chest_pain_type", "thallium_scan", "major_vessels"];
    sels.forEach(function (s, k) {
      F.forEach(function (ft, j) { const o = document.createElement("option"); o.value = j; o.textContent = ft.label; s.appendChild(o); });
      s.value = F.map(function (ft) { return ft.key; }).indexOf(defaults[k]);
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
      for (let S = 0; S < 8; S++) {
        const members = names.filter(function (_, p) { return (S >> p) & 1; });
        html += "<tr><td>" + (members.length ? members.join(", ") : "nobody") + "</td><td>" + g.values[S].toFixed(3) + "</td></tr>";
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
      $("alarm").className = "alarm " + (on ? "on" : "off");
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
        $("m-flag").className = "flag";
      } else {
        const margin = X.marginLower(decide, reported, 20, 0.2);
        $("m-margin").textContent = margin >= 20 ? "more than 20 mg/dL" : margin.toFixed(1) + " mg/dL lower would trigger it";
        const suspicious = margin < G.margin_cut;
        $("m-flag").textContent = suspicious
          ? "Suspicious: fewer than 5% of genuine near-threshold hours are this close to an alert."
          : "The silence is not unusually close to the alert boundary.";
        $("m-flag").className = "flag" + (suspicious ? " warn" : "");
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
        $("attack-note").textContent = "No silent input exists among the attacker's starting points; this alert survives a budget of " + B + " mg/dL.";
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

  /* ---------- start on the tab named in the address, and follow later changes of it ---------- */
  function tabFromHash() {
    return tabs.filter(function (t) { return "#" + t.id.replace("tab-", "") === window.location.hash; })[0];
  }
  window.addEventListener("hashchange", function () {
    const t = tabFromHash();
    if (t && t.getAttribute("aria-selected") !== "true") openTab(t);
  });
  openTab(tabFromHash() || tabs[0]);
})();
