/* Part 4 (Discharge): the discharge checklist, the risk tiers of the EU AI Act, the subgroup audit of NB7,
   the model card and a miniature clinician dashboard with an audit log.
   Depends on site-data.js (window.LAB_DATA), lab-core.js (window.XAICore) and site.js (window.XAISite). */
(function () {
  "use strict";
  const S = window.XAISite, D = window.LAB_DATA, X = window.XAICore;
  if (!S || !D || !X) return;
  const $ = function (id) { return document.getElementById(id); };
  const store = S.store, H = D.heart, N7 = D.nb7, MINUS = "−", STORE_KEY = "xai-cars2026-workshop";
  const heartRisk = function (z) { return X.proba(H.model, z); };

  /* ---------- formatting and small statistics ---------- */
  function pct(v, d) { return (100 * v).toFixed(d || 0) + "%"; }
  function signed(v, d) { return (v >= 0 ? "+" : MINUS) + Math.abs(v).toFixed(d); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function thousands(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function lowerFirst(s) { return s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s; }
  function listText(items) { return items.length < 2 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function today() { return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }

  function auroc(y, p) {
    const n = y.length, idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    idx.sort(function (a, b) { return p[a] - p[b]; });
    let pos = 0, rankSum = 0;
    for (let i = 0; i < n;) {
      let j = i;
      while (j + 1 < n && p[idx[j + 1]] === p[idx[i]]) j++;
      const r = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) if (y[idx[k]] === 1) { pos++; rankSum += r; }
      i = j + 1;
    }
    const neg = n - pos;
    return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : NaN;
  }
  function metrics(y, p, thr) {
    let tp = 0, fn = 0, fp = 0, tn = 0, sp = 0;
    for (let i = 0; i < y.length; i++) {
      const hit = p[i] >= thr;
      if (y[i] === 1) { if (hit) tp++; else fn++; } else if (hit) fp++; else tn++;
      sp += p[i];
    }
    return { auroc: auroc(y, p), sens: tp / Math.max(tp + fn, 1), spec: tn / Math.max(tn + fp, 1), prev: (tp + fn) / y.length,
             mean: sp / y.length, tp: tp, fn: fn, fp: fp, tn: tn };
  }
  function quantile(sorted, q) {
    const pos = q * (sorted.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function binIndex(v, lo, bw, nb) { return Math.max(0, Math.min(nb - 1, Math.floor((v - lo) / bw + 1e-9))); }
  function chartWidth(box, fallback, lo, hi) {
    const w = box ? box.clientWidth : 0;
    return w > 0 ? Math.max(lo, Math.min(hi, Math.round(w))) : fallback;
  }
  function axisX(s, xs, y, dom, ticks, label, fmt) {
    S.add(s, "line", { x1: xs(dom[0]), x2: xs(dom[1]), y1: y, y2: y, class: "axis" });
    ticks.forEach(function (v) {
      S.add(s, "line", { x1: xs(v), x2: xs(v), y1: y, y2: y + 4, class: "axis" });
      S.add(s, "text", { x: xs(v), y: y + 17, class: "tick", "text-anchor": "middle" }, fmt ? fmt(v) : String(v));
    });
    if (label) S.add(s, "text", { x: (xs(dom[0]) + xs(dom[1])) / 2, y: y + 35, class: "axis-label", "text-anchor": "middle" }, label);
  }
  const CHECK_SVG = '<svg viewBox="0 0 28 28" aria-hidden="true"><rect x="2" y="2" width="24" height="24" rx="4"/><path d="M7.5 14.5 L12 19 L20.5 9"/></svg>';
  function filed(id, what) {
    const p = $(id);
    p.innerHTML = CHECK_SVG + '<span>Filed in the discharge papers: ' + what + '. <a href="#papers-open">See the papers</a></span>';
    p.hidden = false;
  }

  /* ---------- groups of the NB7 audit ---------- */
  const groups = [{ key: "women", label: "Women", cls: "violet", idx: [] }, { key: "men", label: "Men", cls: "ink", idx: [] }];
  N7.sex_male.forEach(function (s, i) { groups[s === 1 ? 1 : 0].idx.push(i); });
  groups.forEach(function (g) {
    g.y = g.idx.map(function (i) { return N7.y[i]; });
    g.p = g.idx.map(function (i) { return N7.p_oof[i]; });
    g.point = metrics(g.y, g.p, 0.5);
    g.nosex = metrics(g.y, g.idx.map(function (i) { return N7.p_oof_nosex[i]; }), 0.5);
  });
  const overall = metrics(N7.y, N7.p_oof, 0.5);
  function flipShare() {
    let n = 0;
    for (let i = 0; i < N7.p_full.length; i++) if ((N7.p_flip[i] >= 0.5) !== (N7.p_full[i] >= 0.5)) n++;
    return { share: n / N7.p_full.length, n: n, total: N7.p_full.length };
  }
  document.querySelectorAll("[data-n]").forEach(function (el) {
    const k = el.getAttribute("data-n");
    el.textContent = String(k === "all" ? N7.y.length : k === "women" ? groups[0].y.length : k === "bg" ? H.background.length : "");
  });

  /* ---------- cold open: the discharge papers fill in from the evidence of the morning ---------- */
  const OBL = [
    { key: "a9", art: "Article 9", name: "Risk management", go: ["part1.html", "Part 1"] },
    { key: "a10", art: "Article 10", name: "Data and bias examination", go: ["#s-audit", "Station 2"] },
    { key: "a12", art: "Article 12", name: "Record keeping", go: ["#s-dashboard", "Station 4"] },
    { key: "a13", art: "Article 13", name: "Transparency and instructions for use", go: ["#s-card", "Station 3"] },
    { key: "a14", art: "Article 14", name: "Human oversight", go: ["#s-dashboard", "Station 4"] },
    { key: "a15", art: "Article 15", name: "Accuracy, robustness and cybersecurity", go: ["part3.html", "Part 3"] }
  ];
  function evidence() {
    const v = store.get("visited", {}) || {}, sil = store.get("p3:silenced", null), ov = store.get("p4:override", null), e = {};
    if (v.p1 && v.p3) e.a9 = "shortcut exposed in Part 1, attacks in Part 3";
    else if (v.p1) e.a9 = "shortcut exposed in Part 1";
    else if (v.p3) e.a9 = "attack risks exposed in Part 3";
    if (store.get("p4:audit", null)) e.a10 = "subgroup audit with intervals, station 2";
    if (store.get("p4:card", null)) e.a13 = "model card written, station 3";
    if (ov && ov.overrides > 0) {
      e.a12 = "audit log of " + plural(ov.decisions, "decision", "decisions") + ", station 4";
      e.a14 = plural(ov.overrides, "override", "overrides") + " with a reason, station 4";
    }
    if (sil && typeof sil.silenced === "number" && typeof sil.tried === "number" && sil.tried > 0) e.a15 = "attack test in Part 3: " + sil.silenced + " of " + sil.tried + " alerts silenced";
    else if (sil || v.p3) e.a15 = "attacks tested in Part 3";
    return e;
  }
  const rowEls = OBL.map(function (o) {
    const li = S.el("li", { class: "prow" }, '<svg class="pbox" viewBox="0 0 28 28" aria-hidden="true"><rect x="2" y="2" width="24" height="24" rx="4"/>' +
      '<path class="tick" d="M7.5 14.5 L12 19 L20.5 9"/></svg><span class="art">' + o.art + '</span><span class="obl">' + o.name + '</span><span class="ev"></span>');
    $("papers-rows").appendChild(li);
    return li;
  });
  const meter = $("papers-meter");
  OBL.forEach(function () { meter.appendChild(S.el("i")); });
  $("papers-date").textContent = today();
  let shownEv = null, papersVisible = true, papersQueued = false;

  function countOf(ev) { return OBL.filter(function (o) { return ev[o.key]; }).length; }
  function setRow(i, ev) {
    const o = OBL[i], li = rowEls[i], text = ev[o.key];
    li.classList.toggle("ok", !!text);
    li.classList.toggle("missing", !text);
    li.querySelector(".ev").innerHTML = text ? esc(text) : '<span class="miss">missing</span><a class="chip" href="' + o.go[0] + '">' + o.go[1] + "</a>";
  }
  function setFoot(count, final, slam) {
    $("papers-count").innerHTML = "<strong>" + count + " of " + OBL.length + "</strong> obligations documented";
    Array.prototype.forEach.call(meter.children, function (seg, k) { seg.classList.toggle("on", k < count); });
    if (!final) return;
    const st = $("papers-stamp"), done = count === OBL.length, wasHidden = st.hidden;
    st.textContent = done ? "Ready for discharge" : "Discharge on hold";
    st.classList.toggle("ok", done);
    st.hidden = false;
    if ((slam || wasHidden) && !S.reduceMotion) { st.classList.remove("slam"); void st.offsetWidth; st.classList.add("slam"); }
  }
  function flash(li, delay) {
    if (S.reduceMotion) return;
    setTimeout(function () { li.classList.remove("fresh"); void li.offsetWidth; li.classList.add("fresh"); }, delay);
  }
  function applyPapers() {
    const ev = evidence(), before = shownEv || {};
    let k = 0;
    OBL.forEach(function (o, i) {
      if (ev[o.key] === before[o.key] && shownEv) return;
      setRow(i, ev);
      if (ev[o.key] && !before[o.key] && shownEv) flash(rowEls[i], 120 * k++);
    });
    const changed = !shownEv || countOf(ev) !== countOf(before);
    shownEv = ev;
    setFoot(countOf(ev), true, changed);
  }
  function refreshPapers() {
    if (!shownEv) return;
    if (papersVisible) applyPapers(); else papersQueued = true;
  }
  async function openPapers() {
    const ev = evidence();
    if (S.reduceMotion) { applyPapers(); return; }
    await S.wait(500);
    let count = 0;
    for (let i = 0; i < OBL.length; i++) {
      rowEls[i].classList.add("checking");
      await S.wait(300);
      setRow(i, ev);
      rowEls[i].classList.remove("checking");
      if (ev[OBL[i].key]) count++;
      setFoot(count, false);
      await S.wait(130);
    }
    shownEv = null;
    applyPapers();
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      papersVisible = entries[entries.length - 1].isIntersecting;
      if (papersVisible && papersQueued && shownEv) { papersQueued = false; applyPapers(); }
    }, { threshold: 0.2 }).observe($("papers"));
  }

  /* ---------- station 1: the risk tiers of the EU AI Act ---------- */
  const TIERS = [
    { name: ["Unacceptable"], label: "Unacceptable", say: "unacceptable risk", c: "var(--red)" },
    { name: ["High risk"], label: "High risk", say: "high risk", c: "var(--amber)" },
    { name: ["Transparency", "obligations"], label: "Transparency obligations", say: "transparency obligations", c: "var(--violet)" },
    { name: ["Minimal risk"], label: "Minimal risk", say: "minimal risk", c: "var(--teal)" }
  ];
  const SYSTEMS = [
    { text: "Sepsis early-warning software that is part of a CE-marked medical device", tier: 1,
      why: "AI in a medical device that needs a notified body is high-risk through Annex I; obligations apply from 2 August 2028." },
    { text: "Emergency call triage that decides which ambulance is dispatched first", tier: 1,
      why: "Annex III lists the evaluation and classification of emergency calls and emergency healthcare patient triage; obligations apply from 2 December 2027." },
    { text: "AI used by a public authority to evaluate who is eligible for public healthcare benefits and services", tier: 1,
      why: "Annex III lists this use; obligations apply from 2 December 2027." },
    { text: "A hospital chatbot that answers visitors' questions about parking and visiting hours", tier: 2,
      why: "People must be told they are interacting with an AI system (Article 50, from 2 August 2026)." },
    { text: "A generator of synthetic patient images for a hospital marketing campaign", tier: 2,
      why: "Generated content must be marked as such (Article 50)." },
    { text: "Software that schedules the cleaning of operating theatres", tier: 3,
      why: "No specific obligations; voluntary codes of conduct." },
    { text: "Emotion recognition that monitors the mood of hospital staff during shifts", tier: 0,
      why: "Emotion recognition in the workplace is prohibited (Article 5), except for medical or safety reasons; banned since 2 February 2025." },
    { text: "Social scoring of citizens by a public authority that restricts their access to care", tier: 0,
      why: "Social scoring leading to detrimental treatment is prohibited (Article 5)." }
  ];
  const assign = SYSTEMS.map(function () { return -1; });
  let selected = 0, checked = false, pyr = null;
  function hint(t) { $("sort-hint").textContent = t; }
  function nextUnplaced(from) {
    for (let d = 1; d <= SYSTEMS.length; d++) { const k = (from + d) % SYSTEMS.length; if (assign[k] < 0) return k; }
    return -1;
  }
  function buildPyramid() {
    const box = $("pyr"), w = box.clientWidth, mode = w > 0 && w < 470 ? "narrow" : "wide";
    if (pyr && pyr.mode === mode) return;
    const g = mode === "narrow" ? { W: 360, H: 330, cx: 118, top: 3, bot: 327, hwT: 30, hwB: 114, lx: 246 }
                                : { W: 520, H: 380, cx: 180, top: 3, bot: 377, hwT: 42, hwB: 172, lx: 372 };
    const s = S.svgRoot(box, g.W, g.H, "The risk pyramid of the EU AI Act; choose a tier to place the selected system");
    s.setAttribute("role", "group");
    const th = (g.bot - g.top) / TIERS.length;
    const hw = function (y) { return g.hwT + ((y - g.top) / (g.bot - g.top)) * (g.hwB - g.hwT); };
    const counts = [];
    TIERS.forEach(function (t, i) {
      const y0 = g.top + i * th, y1 = y0 + th, a = y0 + 1.5, b = y1 - 1.5, mid = (y0 + y1) / 2;
      const grp = S.add(s, "g", { class: "tier", role: "button", tabindex: "0", style: "--c:" + t.c, "aria-label": "Place the selected system in the tier " + t.label });
      S.add(grp, "rect", { class: "hit", x: 0, y: y0, width: g.W, height: th });
      S.add(grp, "polygon", { class: "shape", points: [[g.cx - hw(a), a], [g.cx + hw(a), a], [g.cx + hw(b), b], [g.cx - hw(b), b]]
        .map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") });
      S.add(grp, "line", { x1: g.cx + hw(mid) + 8, x2: g.lx - 10, y1: mid, y2: mid, class: "guide" });
      const first = mid - (t.name.length * 17 + 15) / 2 + 13;
      t.name.forEach(function (ln, r) { S.add(grp, "text", { x: g.lx, y: first + r * 17, class: "tname" }, ln); });
      counts.push(S.add(grp, "text", { x: g.lx, y: first + t.name.length * 17 + 1, class: "tcount" }, ""));
      grp.addEventListener("click", function () { placeOn(i); });
      grp.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); placeOn(i); } });
    });
    const toks = SYSTEMS.map(function (sys, k) {
      const tg = S.add(s, "g", { class: "tok", "aria-hidden": "true" });
      S.add(tg, "circle", { r: 11.5 });
      S.add(tg, "text", { y: 4.3, "text-anchor": "middle" }, String(k + 1));
      tg.style.display = "none";
      return tg;
    });
    pyr = { mode: mode, g: g, th: th, hw: hw, toks: toks, counts: counts, shown: toks.map(function () { return false; }) };
  }
  function moveToken(k, x, y) {
    const tg = pyr.toks[k], tr = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px)";
    if (pyr.shown[k]) { tg.style.transform = tr; return; }
    tg.style.transition = "none";
    tg.style.display = "";
    tg.style.transform = tr;
    void tg.getBoundingClientRect();
    tg.style.transition = "";
    pyr.shown[k] = true;
    if (!S.reduceMotion) tg.classList.add("pop");
  }
  function tokenRows(n, y0, y1, spacing) {
    const list = [];
    let left = n;
    for (let r = 0; left > 0; r++) {
      const y = y1 - 17 - r * 26;
      if (y < y0 + 12) break;
      const take = Math.min(left, Math.max(1, Math.floor((2 * pyr.hw(y) - 18) / spacing)));
      list.push({ y: y, n: take });
      left -= take;
    }
    return { list: list, left: left };
  }
  function layoutTokens() {
    if (!pyr) return;
    const g = pyr.g;
    pyr.toks.forEach(function (tg, k) {
      let cls = "tok";
      if (checked) cls += assign[k] === SYSTEMS[k].tier ? " ok" : " bad";
      else if (selected === k) cls += " sel";
      tg.setAttribute("class", cls);
      if (assign[k] < 0) { tg.style.display = "none"; pyr.shown[k] = false; }
    });
    TIERS.forEach(function (t, i) {
      const members = [];
      assign.forEach(function (a, k) { if (a === i) members.push(k); });
      pyr.counts[i].textContent = members.length ? plural(members.length, "system", "systems") : "empty";
      if (!members.length) return;
      const y0 = g.top + i * pyr.th, y1 = y0 + pyr.th;
      let spacing = 27, rows = tokenRows(members.length, y0, y1, spacing);
      while (rows.left > 0 && spacing > 19) { spacing -= 2; rows = tokenRows(members.length, y0, y1, spacing); }
      if (rows.left > 0) rows.list[0].n += rows.left;
      let m = 0;
      rows.list.forEach(function (row) {
        for (let j = 0; j < row.n; j++) moveToken(members[m++], g.cx + (j - (row.n - 1) / 2) * spacing, row.y);
      });
    });
  }
  const cardEls = SYSTEMS.map(function (sys, k) {
    const li = S.el("li", { class: "sys-card" });
    const b = S.el("button", { type: "button", class: "sys", "aria-pressed": "false" }, '<span class="n">' + (k + 1) + "</span><span>" + esc(sys.text) + "</span>");
    const sel = S.el("select", { "aria-label": "Tier for system " + (k + 1) }, '<option value="-1">Choose a tier</option>' +
      TIERS.map(function (t, i) { return '<option value="' + i + '">' + t.label + "</option>"; }).join(""));
    const verdict = S.el("p", { class: "verdict", hidden: "" });
    li.appendChild(b); li.appendChild(sel); li.appendChild(verdict);
    $("systems").appendChild(li);
    b.addEventListener("click", function () { if (checked) return; selected = k; updateSort(); });
    sel.addEventListener("change", function () {
      if (checked) return;
      assign[k] = parseInt(sel.value, 10);
      if (selected === k && assign[k] >= 0) selected = nextUnplaced(k);
      updateSort();
    });
    return { li: li, b: b, sel: sel, verdict: verdict };
  });
  function placeOn(t) {
    if (checked) return;
    if (selected < 0) { hint("Choose a system first, then its tier."); return; }
    assign[selected] = t;
    selected = nextUnplaced(selected);
    updateSort();
  }
  function updateSort() {
    cardEls.forEach(function (c, k) {
      c.li.classList.toggle("sel", selected === k);
      c.b.setAttribute("aria-pressed", String(selected === k));
      c.sel.value = String(assign[k]);
    });
    $("sort").classList.toggle("picking", selected >= 0 && !checked);
    layoutTokens();
    const placed = assign.filter(function (a) { return a >= 0; }).length;
    $("sort-progress").textContent = placed + " of " + SYSTEMS.length + " placed";
    if (checked) hint("");
    else if (selected >= 0) hint("System " + (selected + 1) + " selected. Click its tier in the pyramid.");
    else if (placed === SYSTEMS.length) hint("All eight placed. Check the answers.");
    else hint("Choose a system, then its tier.");
  }
  function checkSort() {
    if (!assign.some(function (a) { return a >= 0; })) { hint("Place at least one system first."); return; }
    checked = true;
    selected = -1;
    let score = 0;
    SYSTEMS.forEach(function (sys, k) {
      const a = assign[k], ok = a === sys.tier, c = cardEls[k], right = TIERS[sys.tier].say;
      if (ok) score++;
      c.li.classList.add(ok ? "ok" : "bad");
      c.verdict.innerHTML = "<strong>" + (ok ? "Correct: " + right : a < 0 ? "Not placed: " + right : cap(right) + ", not " + TIERS[a].say) + ".</strong> " + esc(sys.why);
      c.verdict.hidden = false;
      c.b.disabled = true;
      c.sel.disabled = true;
    });
    updateSort();
    $("sort-score-n").textContent = String(score);
    $("sort-score-of").textContent = String(SYSTEMS.length);
    $("sort-score").hidden = false;
    $("sort-check").hidden = true;
    $("sort-again").hidden = false;
    store.set("p4:quiz", { score: score, of: SYSTEMS.length });
    S.reveal($("take-tiers"));
  }
  function resetSort() {
    checked = false;
    selected = 0;
    for (let k = 0; k < assign.length; k++) assign[k] = -1;
    cardEls.forEach(function (c) {
      c.li.classList.remove("ok", "bad");
      c.verdict.hidden = true;
      c.b.disabled = false;
      c.sel.disabled = false;
    });
    $("sort-score").hidden = true;
    $("sort-check").hidden = false;
    $("sort-again").hidden = true;
    updateSort();
  }
  $("sort-check").addEventListener("click", checkSort);
  $("sort-again").addEventListener("click", resetSort);
  buildPyramid();
  updateSort();

  /* ---------- station 2: subgroup audit with a bootstrap in the browser ---------- */
  const NBOOT = 1000, SEED = 42, MKEYS = ["auroc", "sens", "spec", "prev", "mean"];
  const BOOT = { lo: 0.2, hi: 1.0, bw: 0.02 };
  let boot = null, bootShown = 0, bootRunning = false, auditDone = false;
  function runBootstrap() {
    if (boot) return boot;
    const rand = X.mulberry32(SEED), nb = Math.round((BOOT.hi - BOOT.lo) / BOOT.bw);
    boot = groups.map(function (g) {
      const n = g.y.length, samples = [];
      for (let guard = 0; samples.length < NBOOT && guard < 3 * NBOOT; guard++) {
        const yy = new Array(n), pp = new Array(n);
        let pos = 0;
        for (let i = 0; i < n; i++) { const k = Math.floor(rand() * n); yy[i] = g.y[k]; pp[i] = g.p[k]; pos += yy[i]; }
        if (pos > 0 && pos < n) samples.push(metrics(yy, pp, 0.5));
      }
      const ci = {};
      MKEYS.forEach(function (key) {
        const v = samples.map(function (s) { return s[key]; }).sort(function (a, b) { return a - b; });
        ci[key] = [quantile(v, 0.025), quantile(v, 0.975)];
      });
      const h = new Array(nb).fill(0);
      samples.forEach(function (s) { h[binIndex(s.sens, BOOT.lo, BOOT.bw, nb)]++; });
      return { samples: samples, ci: ci, maxBin: Math.max.apply(null, h) };
    });
    const d = boot[0].samples.map(function (s, i) { return s.sens - boot[1].samples[i].sens; }).sort(function (a, b) { return a - b; });
    boot.diff = [quantile(d, 0.025), quantile(d, 0.975)];
    boot.maxBin = Math.max(boot[0].maxBin, boot[1].maxBin);
    return boot;
  }
  $("sens-pair").innerHTML = groups.map(function (g) {
    return '<div class="stat ' + g.cls + '"><span class="v">' + pct(g.point.sens) + '</span><span class="l">sensitivity for ' + g.key + ": " +
      g.point.tp + " of " + (g.point.tp + g.point.fn) + " with disease found</span></div>";
  }).join("");
  function pollVerdict(answer) {
    const w = groups[0].point.sens, m = groups[1].point.sens, gap = w - m;
    const truth = Math.abs(gap) < 0.05 ? "same" : gap < 0 ? "lower" : "higher";
    const phrase = truth === "same" ? "about the same as" : truth === "lower" ? "lower than" : "higher than";
    $("poll-verdict").innerHTML = "<strong>" + (answer === truth ? "Matches the point estimate." : "The point estimate says otherwise.") +
      "</strong> Sensitivity for women is " + phrase + " for men: " + pct(w) + " against " + pct(m) + ". Resample to see how certain that is.";
  }
  function drawBoot(shown) {
    const box = $("boot-chart"), W = chartWidth(box, 660, 260, 860), Hh = 320, m = { l: 22, r: 22, t: 6, b: 50 }, narrow = W < 440;
    const s = S.svgRoot(box, W, Hh, "Sensitivity for women and for men in " + thousands(NBOOT) + " bootstrap resamples, with 95 percent intervals");
    const lo = BOOT.lo, hi = BOOT.hi, nb = Math.round((hi - lo) / BOOT.bw), done = !!boot && shown >= NBOOT;
    const xs = function (v) { return m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r); };
    const panelH = (Hh - m.t - m.b) / 2, bwpx = xs(lo + BOOT.bw) - xs(lo);
    [0.4, 0.6, 0.8].forEach(function (v) { S.add(s, "line", { x1: xs(v), x2: xs(v), y1: m.t + 22, y2: Hh - m.b, class: "gridline" }); });
    groups.forEach(function (g, gi) {
      const top = m.t + gi * panelH, base = top + panelH - 30, barTop = top + 28, pt = g.point.sens, ci = done ? boot[gi].ci.sens : null;
      S.add(s, "text", { x: m.l, y: top + 16, class: "strong" }, g.label + ", n = " + g.y.length);
      S.add(s, "text", { x: W - m.r, y: top + 16, "text-anchor": "end", class: "val" },
        ci ? (narrow ? pct(pt) + " [" + Math.round(100 * ci[0]) + ", " + Math.round(100 * ci[1]) + "]" : pct(pt) + ", 95% interval " + Math.round(100 * ci[0]) + " to " + pct(ci[1]))
           : (narrow ? pct(pt) : "point estimate " + pct(pt)));
      if (boot && shown > 0) {
        const h = new Array(nb).fill(0);
        for (let i = 0; i < shown; i++) h[binIndex(boot[gi].samples[i].sens, lo, BOOT.bw, nb)]++;
        h.forEach(function (c, b) {
          if (!c) return;
          const hgt = (c / boot.maxBin) * (base - barTop), x0 = lo + b * BOOT.bw;
          const r = S.add(s, "rect", { x: xs(x0) + 1, y: base - hgt, width: Math.max(1, bwpx - 2), height: hgt, rx: 1.5, class: "f-" + g.cls });
          S.add(r, "title", {}, Math.round(100 * x0) + " to " + Math.round(100 * (x0 + BOOT.bw)) + "%: " + c + " resamples");
        });
      } else {
        S.add(s, "text", { x: (xs(lo) + xs(hi)) / 2, y: base - 22, "text-anchor": "middle", class: "muted" }, thousands(NBOOT) + " resamples will appear here");
      }
      S.add(s, "line", { x1: m.l, x2: W - m.r, y1: base, y2: base, class: "gridline" });
      S.add(s, "line", { x1: xs(pt), x2: xs(pt), y1: barTop - 2, y2: base + 16, class: "guide" });
      if (ci) {
        S.add(s, "line", { x1: xs(ci[0]), x2: xs(ci[1]), y1: base + 16, y2: base + 16, class: "line s-" + g.cls, style: "stroke-width:5px" });
        [ci[0], ci[1]].forEach(function (v) { S.add(s, "line", { x1: xs(v), x2: xs(v), y1: base + 9, y2: base + 23, class: "line s-" + g.cls }); });
      }
      S.add(s, "circle", { cx: xs(pt), cy: base + 16, r: 6.5, class: "f-" + g.cls, style: "stroke:var(--panel);stroke-width:2px" });
    });
    axisX(s, xs, Hh - m.b + 10, [lo, hi], [0.2, 0.4, 0.6, 0.8, 1], "sensitivity at threshold 0.5", function (v) { return pct(v); });
  }
  function drawFlip() {
    const box = $("flip-chart"), W = chartWidth(box, 600, 280, 860), Hh = 252, m = { l: 22, r: 22, t: 6, b: 50 };
    const s = S.svgRoot(box, W, Hh, "Change in predicted risk when only the recorded sex is flipped, for women and for men");
    const lo = -0.6, hi = 0.45, bw = 0.025, nb = Math.round((hi - lo) / bw);
    const xs = function (v) { return m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r); };
    const data = groups.map(function (g) {
      const h = new Array(nb).fill(0);
      let cross = 0;
      g.idx.forEach(function (i) {
        h[binIndex(N7.p_flip[i] - N7.p_full[i], lo, bw, nb)]++;
        if ((N7.p_flip[i] >= 0.5) !== (N7.p_full[i] >= 0.5)) cross++;
      });
      return { h: h, cross: cross };
    });
    const maxC = Math.max.apply(null, data[0].h.concat(data[1].h)), panelH = (Hh - m.t - m.b) / 2, bwpx = xs(lo + bw) - xs(lo);
    S.add(s, "line", { x1: xs(0), x2: xs(0), y1: m.t + 22, y2: Hh - m.b + 10, class: "guide" });
    groups.forEach(function (g, gi) {
      const top = m.t + gi * panelH, base = top + panelH - 6, barTop = top + 26;
      S.add(s, "text", { x: m.l, y: top + 16, class: "strong" }, (gi === 0 ? "Women recorded as men: " : "Men recorded as women: ") +
        plural(data[gi].cross, "decision changes", "decisions change"));
      data[gi].h.forEach(function (c, b) {
        if (!c) return;
        const hgt = (c / maxC) * (base - barTop), x0 = lo + b * bw;
        const r = S.add(s, "rect", { x: xs(x0) + 1, y: base - hgt, width: Math.max(1, bwpx - 2), height: hgt, rx: 1.5, class: "f-" + g.cls });
        S.add(r, "title", {}, signed(x0, 3) + " to " + signed(x0 + bw, 3) + ": " + plural(c, "patient", "patients"));
      });
      S.add(s, "line", { x1: m.l, x2: W - m.r, y1: base, y2: base, class: "gridline" });
    });
    axisX(s, xs, Hh - m.b + 10, [lo, hi], [-0.5, -0.25, 0, 0.25], "change in predicted risk", function (v) { return v === 0 ? "0" : signed(v, 2); });
  }
  function drawNoSex() {
    const box = $("nosex-chart"), W = chartWidth(box, 460, 280, 760), Hh = 186, m = { l: 74, r: 24, t: 40, b: 50 };
    const s = S.svgRoot(box, W, Hh, "Sensitivity for women and for men with and without the sex variable");
    const vals = [];
    groups.forEach(function (g) { vals.push(g.point.sens, g.nosex.sens); });
    const lo = Math.max(0, Math.floor((Math.min.apply(null, vals) - 0.05) * 10) / 10), hi = Math.min(1, Math.ceil((Math.max.apply(null, vals) + 0.05) * 10) / 10);
    const xs = function (v) { return m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r); };
    S.add(s, "circle", { cx: 20, cy: 14, r: 5.5, class: "f-ink" });
    S.add(s, "text", { x: 31, y: 18, class: "tick" }, "with the sex variable");
    S.add(s, "circle", { cx: 182, cy: 14, r: 5, class: "s-ink", style: "fill:var(--panel);stroke-width:2.2px" });
    S.add(s, "text", { x: 193, y: 18, class: "tick" }, "without it");
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += 0.1) ticks.push(Math.round(v * 10) / 10);
    ticks.forEach(function (v) { S.add(s, "line", { x1: xs(v), x2: xs(v), y1: m.t, y2: Hh - m.b + 6, class: "gridline" }); });
    groups.forEach(function (g, gi) {
      const y = m.t + 26 + gi * 46, a = g.point.sens, b = g.nosex.sens, near = Math.abs(xs(a) - xs(b)) < 44;
      S.add(s, "text", { x: m.l - 14, y: y + 4, "text-anchor": "end", class: "strong" }, g.label);
      S.add(s, "line", { x1: xs(a), x2: xs(b), y1: y, y2: y, class: "line s-" + g.cls });
      S.add(s, "circle", { cx: xs(a), cy: y, r: 6.5, class: "f-" + g.cls, style: "stroke:var(--panel);stroke-width:2px" });
      S.add(s, "circle", { cx: xs(b), cy: y, r: 6, class: "s-" + g.cls, style: "fill:var(--panel);stroke-width:2.5px" });
      S.add(s, "text", { x: xs(a), y: y - 13, "text-anchor": "middle", class: "val" }, pct(a));
      S.add(s, "text", { x: xs(b), y: near ? y + 23 : y - 13, "text-anchor": "middle", class: "val" }, pct(b));
    });
    axisX(s, xs, Hh - m.b + 10, [lo, hi], ticks, "sensitivity at threshold 0.5", function (v) { return pct(v); });
    const gw = groups[0].point.sens - groups[1].point.sens, gn = groups[0].nosex.sens - groups[1].nosex.sens;
    $("nosex-note").textContent = "Retrained without the sex variable: women " + pct(groups[0].nosex.sens) + ", men " + pct(groups[1].nosex.sens) +
      ". The gap moves from " + Math.round(100 * Math.abs(gw)) + " to " + Math.round(100 * Math.abs(gn)) + " points" +
      (Math.abs(gn) >= 0.02 ? " but does not disappear; other variables can carry the same information." : " and almost closes.");
  }
  function sensCell(v, ci, isPct) {
    return isPct ? "<strong>" + pct(v) + '</strong> <span class="ci">[' + Math.round(100 * ci[0]) + ", " + Math.round(100 * ci[1]) + "]</span>"
                 : "<strong>" + v.toFixed(2) + '</strong> <span class="ci">[' + ci[0].toFixed(2) + ", " + ci[1].toFixed(2) + "]</span>";
  }
  const AUDIT_ROWS = [["AUROC", "auroc", false], ["Sensitivity", "sens", true], ["Specificity", "spec", true],
                      ["Observed prevalence", "prev", true], ["Mean predicted risk", "mean", true]];
  function drawAuditTable() {
    const b = runBootstrap();
    let html = "<caption>Point estimate and 95 percent bootstrap interval in brackets; all rows except AUROC in percent.</caption>" +
      '<thead><tr><th scope="col">Out-of-fold, threshold 0.5</th>' + groups.map(function (g) {
        return '<th scope="col"><span class="key ' + g.cls + '"></span>' + g.label + " (n = " + g.y.length + ")</th>";
      }).join("") + "</tr></thead><tbody>";
    AUDIT_ROWS.forEach(function (r) {
      html += '<tr><th scope="row">' + r[0] + "</th>" + groups.map(function (g, gi) { return "<td>" + sensCell(g.point[r[1]], b[gi].ci[r[1]], r[2]) + "</td>"; }).join("") + "</tr>";
    });
    $("audit-table").innerHTML = html + "</tbody>";
    const fs = flipShare();
    $("flip-stats").innerHTML = '<span class="big">' + pct(fs.share, 1) + '</span><span class="muted">of decisions change at threshold 0.5 (' + fs.n + " of " + fs.total + " patients)</span>";
  }
  function finishBoot() {
    bootRunning = false;
    bootShown = NBOOT;
    const btn = $("resample");
    btn.disabled = false;
    btn.textContent = "Replay the resampling";
    $("boot-count").textContent = thousands(NBOOT) + " resamples per group, random seed " + SEED + ".";
    const w = boot[0].ci.sens, mm = boot[1].ci.sens, d = boot.diff;
    const pts = function (v) { const r = Math.round(100 * v); return (r > 0 ? "+" : r < 0 ? MINUS : "") + Math.abs(r); };
    $("boot-verdict").textContent = "Women " + Math.round(100 * w[0]) + " to " + pct(w[1]) + ", men " + Math.round(100 * mm[0]) + " to " + pct(mm[1]) +
      ". The interval of the difference, " + pts(d[0]) + " to " + pts(d[1]) + " points, " +
      (d[0] <= 0 && d[1] >= 0 ? "includes zero, so the data cannot rule out equal sensitivity." : "excludes zero.");
    $("audit-more").hidden = false;
    drawAuditTable();
    drawFlip();
    drawNoSex();
    if (!auditDone) {
      auditDone = true;
      const fs = flipShare();
      store.set("p4:audit", { sensWomen: +groups[0].point.sens.toFixed(3), sensMen: +groups[1].point.sens.toFixed(3), flipShare: +fs.share.toFixed(3) });
      filed("filed-audit", "Article 10, data and bias examination");
      S.reveal($("take-audit"));
      refreshPapers();
      renderCard();
    }
  }
  function resample() {
    if (bootRunning) return;
    runBootstrap();
    bootRunning = true;
    $("resample").disabled = true;
    if (S.reduceMotion) { drawBoot(NBOOT); finishBoot(); return; }
    const t0 = performance.now(), ms = 2600;
    const frame = function (t) {
      const k = Math.min(1, (t - t0) / ms), shown = Math.max(1, Math.round(NBOOT * Math.pow(k, 1.6)));
      bootShown = shown;
      drawBoot(shown);
      $("boot-count").textContent = "Drawn " + thousands(shown) + " of " + thousands(NBOOT) + " resamples";
      if (k < 1) requestAnimationFrame(frame); else finishBoot();
    };
    frame(t0);
  }
  $("resample").addEventListener("click", resample);

  /* ---------- station 3: the model card ---------- */
  const SECTIONS = [
    { key: "use", title: "Intended use", on: false }, { key: "data", title: "Training data", on: true },
    { key: "perf", title: "Performance", on: true }, { key: "groups", title: "Subgroups", on: false },
    { key: "xai", title: "Explainability", on: false }, { key: "sec", title: "Robustness and security", on: false },
    { key: "lim", title: "Limitations", on: false }, { key: "change", title: "Change control", on: false }
  ];
  const DEPTH = (function () {
    function depth(t, n) { return t.l[n] === -1 ? 0 : 1 + Math.max(depth(t, t.l[n]), depth(t, t.r[n])); }
    return Math.max.apply(null, H.model.trees.map(function (t) { return depth(t, 0); }));
  })();
  function topDrivers(k) {
    const sb = N7.shap_by_group, nW = groups[0].y.length, nM = groups[1].y.length;
    return sb.features.map(function (f, j) { return { f: f, v: (nW * sb.women[j] + nM * sb.men[j]) / (nW + nM) }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, k)
      .map(function (it) { const ft = H.features.filter(function (x) { return x.key === it.f; })[0]; return ft ? lowerFirst(ft.label) : it.f; });
  }
  function para(texts) { return { html: texts.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join(""), md: texts.join("\n\n") }; }
  function sectionContent(key) {
    const nAll = N7.y.length, nW = groups[0].y.length, nM = groups[1].y.length;
    if (key === "use") return para(["Education and research on explainable AI. Not a medical device and not clinically validated; it must not be used for decisions about patients."]);
    if (key === "data") return para(["UCI Cleveland heart disease data: " + nAll + " patients referred for angiography, " + nW + " women and " + nM + " men, " +
      pct(overall.prev) + " with disease. Single centre, historical and small."]);
    if (key === "perf") {
      const out = ["Gradient boosting, " + H.model.trees.length + " trees of depth " + DEPTH + ", on " + H.features.length + " clinical variables. Out-of-fold AUROC " +
        N7.oof_auroc.toFixed(2) + " over all " + nAll + " patients (five-fold cross-validation); at threshold 0.5, sensitivity " + pct(overall.sens) +
        " and specificity " + pct(overall.spec) + ". Test AUROC " + H.test_auroc.toFixed(2) + " on " + H.patients.length + " held-out patients."];
      const p1 = store.get("p1:threshold", null);
      if (p1 && typeof p1.t === "number" && typeof p1.missed === "number") {
        out.push("Carried over from Part 1: at the threshold chosen there (" + p1.t.toFixed(2) + "), the biopsy network missed " + plural(p1.missed, "cancer", "cancers") +
          (typeof p1.workups === "number" ? " and caused " + plural(p1.workups, "unnecessary work-up", "unnecessary work-ups") : "") + ".");
      }
      return para(out);
    }
    if (key === "groups") {
      const b = runBootstrap(), fs = flipShare();
      const rows = AUDIT_ROWS.slice(0, 3);
      const html = "<table><thead><tr><th scope=\"col\"></th>" + groups.map(function (g) { return '<th scope="col">' + g.label + " (n = " + g.y.length + ")</th>"; }).join("") +
        "</tr></thead><tbody>" + rows.map(function (r) {
          return '<tr><th scope="row">' + r[0] + "</th>" + groups.map(function (g, gi) { return "<td>" + sensCell(g.point[r[1]], b[gi].ci[r[1]], r[2]) + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table>";
      const plain = function (v, ci, isPct) { return isPct ? pct(v) + " [" + Math.round(100 * ci[0]) + ", " + Math.round(100 * ci[1]) + "]" : v.toFixed(2) + " [" + ci[0].toFixed(2) + ", " + ci[1].toFixed(2) + "]"; };
      const md = "| | " + groups.map(function (g) { return g.label + " (n = " + g.y.length + ")"; }).join(" | ") + " |\n|---|---|---|\n" +
        rows.map(function (r) { return "| " + r[0] + " | " + groups.map(function (g, gi) { return plain(g.point[r[1]], b[gi].ci[r[1]], r[2]); }).join(" | ") + " |"; }).join("\n");
      const note = "Out-of-fold predictions at threshold 0.5, 95 percent bootstrap intervals in brackets. Flipping only the recorded sex changes the decision for " +
        pct(fs.share, 1) + " of patients (" + fs.n + " of " + fs.total + ").";
      return { html: html + "<p>" + esc(note) + "</p>", md: md + "\n\n" + note };
    }
    if (key === "xai") return para(["Exact SHAP values for every prediction, shown as a waterfall in the clinician dashboard. Global drivers by mean absolute SHAP value: " +
      listText(topDrivers(3)) + ". The deletion, stability and agreement checks of NB2 apply."]);
    if (key === "sec") {
      const n4 = D.nb4, out = ["Evidence from the attack notebooks: in NB4, a decision-based attacker that sees only the alert silenced " + pct(n4.success_rate) + " of " +
        n4.attacks + " correct hypoglycaemia alerts with changes of at most " + D.cgm.budget + " mg/dL per reading, while validation metrics stayed unchanged."];
      const sil = store.get("p3:silenced", null);
      if (sil && typeof sil.silenced === "number" && typeof sil.tried === "number" && sil.tried > 0) out.push("Part 3 in this browser: " + sil.silenced + " of " + sil.tried + " alerts silenced.");
      out.push("The counterfactual margin separated manipulated from genuine near-threshold inputs with an AUROC of " + n4.auroc_margin.toFixed(2) +
        ". A deployment needs input integrity controls, logs of inputs and explanations, and monitoring.");
      return para(out);
    }
    if (key === "lim") {
      const ci = runBootstrap()[0].ci.sens;
      return para(["Historical referral population from a single centre; " + nW + " women among " + nAll + " patients; no external validation. The 95 percent interval of the sensitivity for women runs from " +
        Math.round(100 * ci[0]) + " to " + pct(ci[1]) + "."]);
    }
    return para(["Predetermined change control plan: any retraining repeats the same subgroup audit and explanation checks, and the result is compared with this card before release."]);
  }
  let cardDone = false;
  function onCount() { return SECTIONS.filter(function (s) { return s.on; }).length; }
  function renderCard(changedKey) {
    const complete = onCount() === SECTIONS.length;
    let html = '<header class="doc-head"><p class="doc-kind">Model card</p><h3 class="doc-title">Coronary artery disease risk, teaching model</h3>' +
      '<dl class="doc-meta"><dt>Model</dt><dd>Gradient boosting on the UCI Cleveland data</dd><dt>Version</dt><dd>Generated on ' + today() + " from this page</dd>" +
      "<dt>Source</dt><dd>github.com/" + S.REPO + "</dd></dl></header>";
    SECTIONS.forEach(function (sec, i) {
      const c = sec.on ? sectionContent(sec.key) : null;
      html += '<section class="doc-sec' + (sec.on ? "" : " off") + (sec.on && sec.key === changedKey && !S.reduceMotion ? " in" : "") + '"><h4><span class="n">' + (i + 1) +
        "</span>" + sec.title + "</h4>" + (c ? c.html : '<p class="gap">Not documented</p>') + "</section>";
    });
    html += '<p class="stamp ok" id="card-stamp"' + (complete ? "" : " hidden") + ">Papers complete</p>";
    $("card-doc").innerHTML = html;
    $("card-count").textContent = onCount() + " of " + SECTIONS.length + " sections";
  }
  function cardChanged(key) {
    renderCard(key);
    if (onCount() !== SECTIONS.length) return;
    if (!S.reduceMotion) $("card-stamp").classList.add("slam");
    if (cardDone) return;
    cardDone = true;
    store.set("p4:card", true);
    filed("filed-card", "Article 13, transparency and instructions for use");
    S.reveal($("take-card"));
    refreshPapers();
  }
  SECTIONS.forEach(function (sec) {
    const li = S.el("li"), b = S.el("button", { type: "button", role: "switch", "aria-checked": String(sec.on) },
      '<span class="sw" aria-hidden="true"></span><span>' + sec.title + "</span>");
    li.appendChild(b);
    $("card-toggles").appendChild(li);
    b.addEventListener("click", function () { sec.on = !sec.on; b.setAttribute("aria-checked", String(sec.on)); cardChanged(sec.key); });
  });
  function cardMarkdown() {
    const lines = ["# Model card: coronary artery disease risk (teaching model)", "",
      "Generated on " + today() + " on the Part 4 page of the IEEE CARS 2026 workshop on explainable AI in medical systems, github.com/" + S.REPO + ".", ""];
    SECTIONS.forEach(function (sec, i) { lines.push("## " + (i + 1) + ". " + sec.title, "", sec.on ? sectionContent(sec.key).md : "Not documented.", ""); });
    return lines.join("\n");
  }
  $("card-download").addEventListener("click", function () {
    const md = cardMarkdown();
    let url, blobUrl = null;
    try { blobUrl = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" })); url = blobUrl; }
    catch (e) { url = "data:text/markdown;charset=utf-8," + encodeURIComponent(md); }
    const a = S.el("a", { href: url, download: "model_card.md" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (blobUrl) setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 4000);
    const k = onCount(), missing = SECTIONS.length - k;
    $("card-msg").textContent = "model_card.md saved with " + k + " of " + SECTIONS.length + " sections" +
      (missing ? "; " + plural(missing, "section is", "sections are") + " marked as not documented." : ".");
  });
  renderCard();

  /* ---------- station 4: the clinician dashboard with oversight and an audit log ---------- */
  const F = H.features, SEX = F.map(function (f) { return f.key; }).indexOf("sex_male");
  const risks = H.patients.map(heartRisk), shapCache = {};
  function flipRisk(i) { const z = H.patients[i].slice(); z[SEX] = 1 - z[SEX]; return heartRisk(z); }
  function shapOf(i) { if (!shapCache[i]) shapCache[i] = X.exactShapley(heartRisk, H.patients[i], H.background); return shapCache[i]; }
  function valueText(ft, v) {
    if (ft.type === "cat") { const o = (ft.options || []).filter(function (op) { return op[0] === v; })[0]; return o ? o[1] : String(v); }
    return Math.round(v * 10) / 10 + (ft.unit ? " " + ft.unit : "");
  }
  function drivers(sh, k) {
    return sh.phi.map(function (v, j) { return { v: v, j: j }; }).sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); }).slice(0, k);
  }
  let cur = 0, shapTimer = 0, firstShap = true;
  for (let i = 0; i < risks.length; i++) if ((risks[i] >= 0.5) !== (flipRisk(i) >= 0.5)) { cur = i; break; }
  const dsel = $("dash-patient");
  dsel.innerHTML = H.patients.map(function (x, i) {
    return '<option value="' + i + '">Patient ' + (i + 1) + ": " + (H.labels[i] ? "disease" : "no disease") + ", risk " + risks[i].toFixed(2) + "</option>";
  }).join("");
  dsel.value = String(cur);
  function threshold() { return parseFloat($("dash-thr").value); }
  function niceTicks(lo, hi) {
    const span = hi - lo, step = span > 0.6 ? 0.2 : span > 0.25 ? 0.1 : 0.05, out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  }
  function drawWaterfall(sh, x, thr) {
    const box = $("dash-wf"), W = chartWidth(box, 700, 300, 900), stacked = W < 540;
    const order = drivers(sh, F.length), K = 8;
    const rows = order.slice(0, K).map(function (it) { return { label: F[it.j].label + " = " + valueText(F[it.j], x[it.j]), v: it.v }; });
    if (order.length > K) rows.push({ label: "other " + (order.length - K) + " variables", v: order.slice(K).reduce(function (a, it) { return a + it.v; }, 0) });
    let cum = sh.base, lo = Math.min(sh.base, thr), hi = Math.max(sh.base, thr);
    rows.forEach(function (r) { r.a = cum; cum += r.v; r.b = cum; lo = Math.min(lo, r.a, r.b); hi = Math.max(hi, r.a, r.b); });
    lo = Math.max(0, lo - 0.03); hi = Math.min(1, hi + 0.03);
    const all = [{ label: "average risk of the reference patients", v: sh.base, kind: "base" }].concat(rows).concat([{ label: "this patient", v: sh.full, kind: "end" }]);
    const rowH = stacked ? 40 : 27, ml = stacked ? 8 : Math.min(300, Math.round(W * 0.42)), mr = stacked ? 8 : 66, top = 28;
    const Hh = top + all.length * rowH + 46, yAxis = Hh - 42;
    const s = S.svgRoot(box, W, Hh, "Exact SHAP waterfall for patient " + (cur + 1) + ": from the average risk of the reference patients to this patient's risk");
    const xs = function (v) { return ml + ((v - lo) / (hi - lo)) * (W - ml - mr); };
    S.add(s, "line", { x1: xs(thr), x2: xs(thr), y1: top - 8, y2: yAxis, class: "threshold" });
    S.add(s, "text", { x: Math.min(W - 50, Math.max(ml + 50, xs(thr))), y: top - 14, "text-anchor": "middle", class: "tick" }, "threshold " + thr.toFixed(2));
    S.add(s, "line", { x1: xs(sh.base), x2: xs(sh.base), y1: top, y2: yAxis, class: "guide" });
    all.forEach(function (r, i) {
      const y = top + i * rowH, strong = r.kind === "end" ? " strong" : "", val = r.kind ? r.v.toFixed(3) : signed(r.v, 3);
      const ty = stacked ? y + 13 : y + 17, my = stacked ? y + 20 : y + 6, mh = stacked ? 13 : rowH - 11;
      S.add(s, "text", { x: stacked ? ml : ml - 10, y: ty, "text-anchor": stacked ? "start" : "end", class: strong.trim() }, r.label);
      S.add(s, "text", { x: W - (stacked ? mr : 8), y: ty, "text-anchor": "end", class: "val" + strong }, val);
      if (r.kind) {
        const c = S.add(s, "circle", { cx: xs(r.v), cy: my + mh / 2, r: r.kind === "end" ? 6.5 : 5,
          class: r.kind === "base" ? "f-ink" : r.v >= thr ? "f-alert" : "f-safe", style: "stroke:var(--panel);stroke-width:2px" });
        S.add(c, "title", {}, r.label + ": " + r.v.toFixed(3));
      } else {
        const rect = S.add(s, "rect", { x: xs(Math.min(r.a, r.b)), y: my, width: Math.max(1.5, Math.abs(xs(r.b) - xs(r.a))), height: mh, rx: 2,
          class: r.v >= 0 ? "f-alert" : "f-safe" });
        S.add(rect, "title", {}, r.label + ": " + signed(r.v, 3));
      }
    });
    axisX(s, xs, yAxis, [lo, hi], niceTicks(lo, hi), "predicted risk", function (v) { return v.toFixed(2); });
  }
  function dashRender() {
    const i = cur, r = risks[i], thr = threshold(), fr = flipRisk(i), refer = r >= thr, frefer = fr >= thr;
    $("dash-thr-out").textContent = thr.toFixed(2);
    const rk = $("dash-risk");
    rk.textContent = r.toFixed(2);
    rk.className = "risk " + (refer ? "hi" : "lo");
    const dc = $("dash-decision");
    dc.textContent = refer ? "Refer for angiography" : "No referral suggested";
    dc.className = "decision" + (refer ? " refer" : "");
    $("dash-truth").textContent = H.labels[i] ? "disease" : "no disease";
    const fl = $("dash-flip");
    fl.textContent = "risk " + fr.toFixed(2) + " " + (H.patients[i][SEX] === 1 ? "as a woman" : "as a man") + (frefer !== refer ? "; the decision changes" : "; same decision");
    fl.className = frefer !== refer ? "warn" : "";
    if (shapCache[i]) { drawWaterfall(shapCache[i], H.patients[i], thr); return; }
    $("dash-wf").innerHTML = '<p class="dash-wait">Computing exact Shapley values over all ' + thousands(Math.pow(2, F.length)) + " coalitions</p>";
    clearTimeout(shapTimer);
    shapTimer = setTimeout(function () { shapOf(cur); dashRender(); }, firstShap ? 900 : 30);
    firstShap = false;
  }
  function dashMsg(t, warn) { const m = $("dash-msg"); m.textContent = t; m.className = "dash-msg" + (warn ? " warn" : ""); }
  const prevLog = store.get("p4:override", null);
  let decisions = prevLog && prevLog.decisions > 0 ? prevLog.decisions : 0, overrides = prevLog && prevLog.overrides > 0 ? prevLog.overrides : 0;
  function logCount() { $("log-count").textContent = decisions ? plural(decisions, "decision", "decisions") + ", " + plural(overrides, "override", "overrides") : ""; }
  if (decisions) {
    $("log-body").querySelector("td.empty").textContent = "Earlier in this browser: " + plural(decisions, "decision", "decisions") + ", " +
      plural(overrides, "override", "overrides") + ". New decisions appear here.";
  }
  logCount();
  function logDecision(action) {
    const reasonSel = $("dash-reason"), reason = reasonSel.value, over = action === "override";
    if (over && !reason) { dashMsg("Choose a reason for the override first.", true); reasonSel.focus(); return; }
    const i = cur, thr = threshold(), r = risks[i], sh = shapOf(i), now = new Date();
    const top3 = drivers(sh, 3).map(function (it) { return F[it.j].label + " " + signed(it.v, 2); }).join(", ");
    const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map(function (v) { return String(v).padStart(2, "0"); }).join(":");
    const body = $("log-body"), empty = body.querySelector("td.empty");
    if (empty) empty.parentNode.remove();
    const tr = S.el("tr", { class: "new" }, "<td>" + time + "</td><td>Patient " + (i + 1) + "</td><td>" + r.toFixed(2) + "</td><td>" + thr.toFixed(2) + "</td><td>" +
      (r >= thr ? "Refer" : "No referral") + '</td><td><span class="tag ' + (over ? "over" : "acc") + '">' + (over ? "Overridden" : "Accepted") + "</span></td><td>" +
      (over ? esc(reason) : "") + "</td><td>" + esc(top3) + "</td>");
    body.insertBefore(tr, body.firstChild);
    decisions++;
    if (over) overrides++;
    store.set("p4:override", { decisions: decisions, overrides: overrides });
    logCount();
    dashMsg(over ? "Logged: override for patient " + (i + 1) + ", " + reason + "." : "Logged: recommendation accepted for patient " + (i + 1) + ".");
    if (over) { reasonSel.value = ""; filed("filed-dash", "Articles 12 and 14, record keeping and human oversight"); }
    S.reveal($("take-dash"));
    refreshPapers();
    if (shapCache[cur]) drawWaterfall(shapCache[cur], H.patients[cur], threshold());
  }
  dsel.addEventListener("change", function () { cur = parseInt(dsel.value, 10); dashMsg(""); dashRender(); });
  $("dash-thr").addEventListener("input", dashRender);
  $("dash-accept").addEventListener("click", function () { logDecision("accept"); });
  $("dash-override").addEventListener("click", function () { logDecision("override"); });
  $("dash-reason").addEventListener("change", function () { if ($("dash-msg").classList.contains("warn")) dashMsg(""); });
  dashRender();

  $("copy-cmd").addEventListener("click", function () {
    const text = $("run-cmd").textContent, msg = $("copy-msg");
    const selectIt = function () {
      try {
        const range = document.createRange(), sel = window.getSelection();
        range.selectNodeContents($("run-cmd"));
        sel.removeAllRanges();
        sel.addRange(range);
        msg.textContent = "Selected; copy with the keyboard.";
      } catch (e) { msg.textContent = "Select the commands and copy them."; }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { msg.textContent = "Copied."; }, selectIt);
    else selectIt();
  });

  /* ---------- the poll opens the audit; store changes elsewhere refresh the papers ---------- */
  S.poll($("poll-women"), "p4-women", function (value) {
    $("audit").hidden = false;
    pollVerdict(value);
    if (!bootRunning) drawBoot(bootShown);
    if (auditDone) { drawFlip(); drawNoSex(); }
  });
  function onStoreChange() { refreshPapers(); renderCard(); }
  window.addEventListener("storage", function (e) { if (!e.key || e.key === STORE_KEY) onStoreChange(); });
  window.addEventListener("pageshow", function (e) { if (e.persisted) onStoreChange(); });
  let lastWidth = window.innerWidth, resizeTimer = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (Math.abs(window.innerWidth - lastWidth) < 24) return;
      lastWidth = window.innerWidth;
      const before = pyr && pyr.mode;
      buildPyramid();
      if (pyr.mode !== before) updateSort();
      if (!$("audit").hidden && !bootRunning) drawBoot(bootShown);
      if (auditDone) { drawFlip(); drawNoSex(); }
      if (shapCache[cur]) drawWaterfall(shapCache[cur], H.patients[cur], threshold());
    }, 180);
  });
  openPapers();
})();
