#!/usr/bin/env node
/* Load every page of the workshop site in jsdom with its local scripts and report runtime errors.
   Usage: npm install jsdom && node tools/check_site.js   (exit code 1 if any page throws) */
"use strict";
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const path = require("path");

const docs = path.join(__dirname, "..", "docs");
const pages = fs.readdirSync(docs).filter((f) => f.endsWith(".html")).sort();
let failures = 0;

(async () => {
  for (const page of pages) {
    let html = fs.readFileSync(path.join(docs, page), "utf8");
    html = html.replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, "");
    html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
      /^https?:/.test(src) ? "" : "<script>" + fs.readFileSync(path.join(docs, src), "utf8").replace(/<\/script>/g, "<\\/script>") + "</script>");
    const errors = [];
    const vc = new VirtualConsole();
    vc.on("jsdomError", (e) => errors.push(e.message));
    vc.on("error", (e) => errors.push(String(e)));
    const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://example.org/site/" + page, pretendToBeVisual: true, virtualConsole: vc });
    await new Promise((r) => setTimeout(r, 1500));
    const stations = dom.window.document.querySelectorAll("[data-station]").length;
    dom.window.close();
    if (errors.length) failures++;
    console.log(`${page}: ${errors.length ? "FAILED\n  " + errors.join("\n  ") : "ok"} (${stations} stations)`);
  }
  process.exit(failures ? 1 : 0);
})();
