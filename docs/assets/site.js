/* Shared behaviour for the workshop site: rhythm-strip navigation, progress, keyboard shortcuts,
   notebook bridges, next-stop transitions and small drawing helpers. Each page sets
   <body data-page="..." data-part="..."> and loads this file after its markup. */
(function () {
  "use strict";

  const REPO = "utkukose/xai-cars2026-NB-workshop";
  const NOTEBOOKS = {
    NB1: { file: "NB1_Black_Box_Problem.ipynb", title: "The Black Box Problem", minutes: "about 1 minute on a free CPU" },
    NB2: { file: "NB2_XAI_Toolkit_Tabular.ipynb", title: "XAI Toolkit I: Tabular", minutes: "about 3 minutes on a free CPU" },
    NB3: { file: "NB3_XAI_Toolkit_Imaging.ipynb", title: "XAI Toolkit II: Imaging", minutes: "about 1 minute on a GPU runtime" },
    NB4: { file: "NB4_Attack_CGM_Hypoglycemia.ipynb", title: "Attack 1: CGM hypoglycaemia alerts", minutes: "3 to 5 minutes on a free CPU" },
    NB5: { file: "NB5_Attack_ICU_Sepsis.ipynb", title: "Attack 2: ICU sepsis alerts", minutes: "5 to 8 minutes on a free CPU" },
    NB6: { file: "NB6_Attack_Wearable_AF.ipynb", title: "Attack 3: wearable AF detection", minutes: "2 to 4 minutes on a free CPU" },
    NB7: { file: "NB7_Governance_and_Dashboard.ipynb", title: "From Explanation to Governance", minutes: "about 1 minute on a free CPU" }
  };
  const PAGES = [
    { id: "start", href: "index.html", label: "Start", short: "Start", title: "Start here", role: "", when: "10:00",
      question: "How the next two hours are organised." },
    { id: "p1", href: "part1.html", label: "Part 1", short: "1", title: "The black box problem", role: "Admission", when: "10:00 to 10:20",
      nbs: ["NB1"], question: "What does a 97 percent accuracy figure hide?" },
    { id: "p2", href: "part2.html", label: "Part 2", short: "2", title: "The XAI toolkit", role: "Examination", when: "10:20 to 10:45",
      nbs: ["NB2", "NB3"], question: "Which explanation answers which question, and can it be trusted?" },
    { id: "break", href: "break.html", label: "Break", short: "Break", title: "Break", role: "", when: "10:45 to 11:00",
      question: "Fifteen minutes. The attacks start at 11:00." },
    { id: "p3", href: "part3.html", label: "Part 3", short: "3", title: "Attacks and XAI-based analysis", role: "Stress test", when: "11:00 to 11:30",
      nbs: ["NB4", "NB5", "NB6"], question: "Can an attacker change a medical alert without any metric noticing?" },
    { id: "p4", href: "part4.html", label: "Part 4", short: "4", title: "Governance and the dashboard", role: "Discharge", when: "11:30 to 11:50",
      nbs: ["NB7"], question: "Which evidence must a model carry before it reaches patients?" },
    { id: "lab", href: "lab.html", label: "XAI Lab", short: "Lab", title: "The XAI Lab", role: "Ward round", when: "11:50 to 12:00",
      question: "Everything from the morning in one place, and a debrief of the session." }
  ];
  const NS = "http://www.w3.org/2000/svg";
  const body = document.body;
  const pageId = body.getAttribute("data-page") || "start";
  const pageIndex = Math.max(0, PAGES.findIndex(function (p) { return p.id === pageId; }));
  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : true;

  /* ---------- progress kept in this browser only ---------- */
  const KEY = "xai-cars2026-workshop";
  function plain(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function readStore() {
    try {
      return plain(JSON.parse(window.localStorage.getItem(KEY) || "{}"));
    } catch (e) { return {}; }
  }
  function writeStore(s) {
    try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
  }
  const store = {
    get: function (k, fallback) { const s = readStore(); return k in s ? s[k] : fallback; },
    set: function (k, v) { const s = readStore(); s[k] = v; s.updated = new Date().toISOString(); writeStore(s); },
    all: readStore,
    clear: function () { try { window.localStorage.removeItem(KEY); } catch (e) { /* storage unavailable */ } }
  };
  const visited = plain(store.get("visited", {}));
  visited[pageId] = true;
  store.set("visited", visited);

  /* ---------- helpers ---------- */
  function colabUrl(nb) {
    return "https://colab.research.google.com/github/" + REPO + "/blob/main/notebooks/" + NOTEBOOKS[nb].file;
  }
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
  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function countUp(node, to, opts) {
    opts = opts || {};
    const from = opts.from || 0, ms = opts.ms || 1400, dec = opts.decimals || 0, suffix = opts.suffix || "";
    if (reduceMotion) { node.textContent = to.toFixed(dec) + suffix; return Promise.resolve(); }
    return new Promise(function (resolve) {
      const t0 = performance.now();
      function frame(t) {
        const k = Math.min(1, (t - t0) / ms), eased = 1 - Math.pow(1 - k, 3);
        node.textContent = (from + (to - from) * eased).toFixed(dec) + suffix;
        if (k < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }
  function reveal(node) {
    if (!node || !node.hidden) return;
    node.hidden = false;
    node.classList.add("shown");
  }
  /* Buttons with data-value inside container; the answer is stored and passed to onAnswer. */
  function poll(container, key, onAnswer) {
    const buttons = Array.prototype.slice.call(container.querySelectorAll("button[data-value]"));
    function choose(value, silent) {
      buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-value") === value)); });
      if (!silent) store.set("poll:" + key, value);
      if (onAnswer) onAnswer(value);
    }
    buttons.forEach(function (b) {
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { choose(b.getAttribute("data-value")); });
    });
    const previous = store.get("poll:" + key, null);
    if (previous !== null) choose(previous, true);
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, reduceMotion ? 0 : ms); }); }

  /* ---------- theme ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    const b = document.getElementById("theme-toggle");
    if (b) { b.textContent = t === "dark" ? "Paper view" : "Monitor view"; b.setAttribute("aria-pressed", String(t === "dark")); }
  }
  let theme = store.get("theme", null);
  if (!theme) theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(theme);
  function toggleTheme() {
    theme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(theme);
    store.set("theme", theme);
    document.dispatchEvent(new CustomEvent("themechange", { detail: theme }));
  }

  /* ---------- top bar with the rhythm strip ---------- */
  function beatPath(x, y) {
    return "M" + (x - 40) + " " + y + " H" + (x - 16) + " l4 -4 l4 4 H" + (x - 3) + " l3 -15 l5 26 l3 -11 H" + (x + 14) +
      " q5 -7 10 0 H" + (x + 40);
  }
  function renderTopbar() {
    const host = document.getElementById("site-top");
    if (!host) return;
    host.className = "topbar";
    host.innerHTML = '<div class="wrap"><a class="brand" href="index.html">Explainable AI in Medical Systems<span>IEEE CARS 2026 workshop</span></a>' +
      '<nav class="strip-nav" aria-label="Workshop parts"><ol></ol></nav><div class="tools"><button type="button" id="theme-toggle" aria-pressed="false">Monitor view</button>' +
      '<button type="button" id="help-toggle" aria-haspopup="dialog">Keys</button></div></div>';
    const list = host.querySelector(".strip-nav ol");
    const seen = store.get("visited", {});
    PAGES.forEach(function (p) {
      const li = el("li", { class: "beat" + (seen[p.id] ? " visited" : "") + (p.id === pageId ? " current" : "") });
      const a = el("a", { href: p.href, title: p.title + (p.when ? ", " + p.when : "") });
      if (p.id === pageId) a.setAttribute("aria-current", "page");
      const s = svgRoot(a, 80, 30);
      s.setAttribute("aria-hidden", "true");
      s.setAttribute("preserveAspectRatio", "none");
      add(s, "path", { d: p.id === "break" ? "M0 18 H28 M52 18 H80" : beatPath(40, 18), class: "trace" });
      a.appendChild(el("span", { class: "lbl" }, '<span class="long">' + p.label + (p.role ? " · " + p.role : "") + '</span><span class="mid">' + p.label +
        '</span><span class="short">' + p.short + "</span>"));
      li.appendChild(a);
      list.appendChild(li);
    });
    host.querySelector("#theme-toggle").addEventListener("click", toggleTheme);
    host.querySelector("#help-toggle").addEventListener("click", function () { toggleHelp(true); });
    applyTheme(theme);
  }

  /* ---------- notebook buttons, bridge and next stop ---------- */
  function colabButton(nb) {
    const a = el("a", { class: "btn-colab", href: colabUrl(nb), target: "_blank", rel: "noopener" },
      '<span class="mark" aria-hidden="true">' + nb + '</span><span class="t">Open ' + nb + ' in Colab</span><span class="s">' +
      NOTEBOOKS[nb].title + ", " + NOTEBOOKS[nb].minutes + "</span>");
    a.addEventListener("click", function () {
      const opened = plain(store.get("opened", {}));
      opened[nb] = true;
      store.set("opened", opened);
    });
    return a;
  }
  function renderNotebookButtons() {
    document.querySelectorAll("[data-notebooks]").forEach(function (box) {
      box.innerHTML = "";
      box.getAttribute("data-notebooks").split(",").map(function (t) { return t.trim(); }).filter(Boolean)
        .forEach(function (nb) { if (NOTEBOOKS[nb]) box.appendChild(colabButton(nb)); });
    });
  }
  function renderNextStop() {
    document.querySelectorAll("[data-next]").forEach(function (sec) {
      const next = PAGES.filter(function (p) { return p.id === sec.getAttribute("data-next"); })[0];
      if (!next) return;
      sec.classList.add("nextstop");
      const label = next.id === "lab" ? "Finale" : next.id === "break" ? "Break" : next.label + (next.role ? " · " + next.role : "");
      sec.innerHTML = '<div class="wrap"><svg class="trace" viewBox="0 0 1000 70" preserveAspectRatio="none" aria-hidden="true"><path d=""/></svg>' +
        '<div><p class="when">Next stop: ' + label + ", " + next.when + "</p><h2>" + next.title + '</h2><p class="lead">' + next.question + "</p></div>" +
        '<a class="btn primary big" href="' + next.href + '">' + (next.id === "break" ? "Start the break" : next.id === "lab" ? "Open the XAI Lab" : "Continue to " + next.label) + "</a></div>";
      const path = sec.querySelector(".trace path");
      let d = "M0 40";
      for (let x = 0; x < 1000; x += 125) d += " H" + (x + 70) + " l6 -8 l5 8 H" + (x + 88) + " l4 -30 l6 50 l4 -20 H" + (x + 108) + " q6 -12 12 0";
      path.setAttribute("d", d + " H1000");
      const trace = sec.querySelector(".trace");
      try { trace.style.setProperty("--len", String(Math.ceil(path.getTotalLength ? path.getTotalLength() : 2600))); } catch (e) { trace.style.setProperty("--len", "2600"); }
      if (!("IntersectionObserver" in window)) { trace.classList.add("drawn"); return; }
      const io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { trace.classList.add("drawn"); io.disconnect(); } });
      }, { threshold: 0.4 });
      io.observe(sec);
    });
  }
  function renderFooter() {
    document.querySelectorAll("[data-footer]").forEach(function (f) {
      f.classList.add("site-footer");
      const credits = f.getAttribute("data-credits");
      f.innerHTML = '<div class="wrap">' + (credits ? "<p>" + credits + "</p>" : "") +
        "<p>Prof. Dr. Utku Köse, Süleyman Demirel University, University of North Dakota, Universidad Panamericana and Vel Tech University. " +
        "IEEE Cyber Awareness and Research Symposium 2026, organised by the Center for Cyber Security Research (C2SR), University of North Dakota, Grand Forks, ND, USA. " +
        'Material released under CC BY-NC-SA 4.0 unless stated otherwise. <a href="https://github.com/' + REPO + '">Source, notebooks and references on GitHub</a>.</p></div>';
    });
  }

  /* ---------- keyboard: stations, parts, theme, help ---------- */
  function stops() {
    return Array.prototype.slice.call(document.querySelectorAll(".coldopen, [data-station], .bridge, .nextstop"));
  }
  function goStation(dir) {
    const list = stops();
    if (!list.length) return;
    const y = window.scrollY + 80;
    let target = null;
    if (dir > 0) target = list.filter(function (n) { return n.getBoundingClientRect().top + window.scrollY > y + 4; })[0];
    else target = list.filter(function (n) { return n.getBoundingClientRect().top + window.scrollY < y - 8; }).pop();
    if (target) target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }
  /* A short monitor-style curtain between parts: the next part's name and one heartbeat, then navigation. */
  function curtain(page) {
    if (reduceMotion || !document.body) { window.location.href = page.href; return; }
    const old = document.querySelector(".curtain");
    if (old) old.remove();
    const label = page.id === "lab" ? "Finale · Ward round" : page.id === "break" ? "Break" : page.id === "start" ? "Start" : page.label + (page.role ? " · " + page.role : "");
    const c = el("div", { class: "curtain", "data-part": page.id, "aria-hidden": "true" },
      '<div class="curtain-inner"><p class="c-label">' + label + (page.when ? '<span>' + page.when + "</span>" : "") + "</p><p class=\"c-title\">" + page.title + "</p>" +
      '<svg viewBox="0 0 1000 120" preserveAspectRatio="none"><path d="M0 70 H380 l14 -16 l14 16 H452 l10 -62 l16 104 l10 -42 H540 q16 -30 32 0 H1000"/></svg></div>');
    document.body.appendChild(c);
    requestAnimationFrame(function () { requestAnimationFrame(function () { c.classList.add("on"); }); });
    setTimeout(function () { window.location.href = page.href; }, 1000);
  }
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) document.querySelectorAll(".curtain").forEach(function (c) { c.remove(); });
  });
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    const page = PAGES.filter(function (p) { return p.href === href; })[0];
    if (!page || page.id === pageId) return;
    e.preventDefault();
    curtain(page);
  });
  function goPage(dir) {
    const p = PAGES[pageIndex + dir];
    if (p) curtain(p);
  }
  let helpBox = null;
  function toggleHelp(show) {
    if (!helpBox) {
      helpBox = el("div", { class: "help", role: "dialog", "aria-modal": "true", "aria-label": "Keyboard shortcuts", hidden: "" },
        '<div class="box"><h3>Keyboard shortcuts</h3><dl>' +
        "<dt><kbd>→</kbd> <kbd>←</kbd></dt><dd>next or previous station on this page</dd>" +
        "<dt><kbd>]</kbd> <kbd>[</kbd></dt><dd>next or previous part of the workshop</dd>" +
        "<dt><kbd>T</kbd></dt><dd>switch between paper and monitor view</dd>" +
        "<dt><kbd>F</kbd></dt><dd>full screen</dd>" +
        "<dt><kbd>?</kbd></dt><dd>show this list</dd></dl>" +
        '<button type="button" class="btn" id="help-close">Close</button></div>');
      document.body.appendChild(helpBox);
      helpBox.addEventListener("click", function (e) { if (e.target === helpBox) toggleHelp(false); });
      helpBox.querySelector("#help-close").addEventListener("click", function () { toggleHelp(false); });
    }
    helpBox.hidden = !show;
    if (show) helpBox.querySelector("#help-close").focus();
  }
  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const a = document.activeElement;
    if (a && a.matches && a.matches('input, select, textarea, [role="tab"], [contenteditable="true"], svg *')) return;
    if (helpBox && !helpBox.hidden) { if (e.key === "Escape") toggleHelp(false); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); goStation(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); goStation(-1); }
    else if (e.key === "]") goPage(1);
    else if (e.key === "[") goPage(-1);
    else if (e.key === "t" || e.key === "T") toggleTheme();
    else if (e.key === "?") toggleHelp(true);
    else if ((e.key === "f" || e.key === "F") && document.documentElement.requestFullscreen) {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(function () {});
    }
  });

  renderTopbar();
  renderNotebookButtons();
  renderNextStop();
  renderFooter();
  document.querySelectorAll("[data-begin]").forEach(function (b) {
    b.addEventListener("click", function () {
      const first = document.querySelector("[data-station]");
      if (first) first.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  });

  window.XAISite = {
    REPO: REPO, PAGES: PAGES, NOTEBOOKS: NOTEBOOKS, page: PAGES[pageIndex], reduceMotion: reduceMotion,
    store: store, colabUrl: colabUrl, colabButton: colabButton, svgRoot: svgRoot, add: add, el: el,
    countUp: countUp, reveal: reveal, poll: poll, wait: wait, toggleTheme: toggleTheme, curtain: curtain
  };
})();
