// Copies the static web app into www/ for Capacitor to bundle into the APK.
// Regenerated on every `bun run apk` — www/ is gitignored.
// Also stamps a build version into index.html (root AND www): the app-version meta
// drives the "Periksa pembaruan" button (app.js checkForUpdate), and the ?v= queries
// on every local asset make the post-check reload pull fresh files instead of a
// stale HTTP/CDN cache — the Android webview otherwise lags behind GitHub Pages.
// Usage: node build/make-www.js
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WWW = path.join(ROOT, "www");

const FILES = [
  "index.html",
  "fonts.css",
  "style.css",
  "surah-meta.js",
  "ayah-page.js",
  "quran-api.js",
  "page-layout.js",
  "audio.js",
  "app.js",
];

const VERSION = new Date().toISOString().slice(0, 16); // e.g. 2026-09-04T11:30 — URL-safe

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
if (!/<meta\s+name="app-version"\s+content="[^"]*"/.test(html)) {
  console.error("index.html is missing the app-version meta — the update check would silently break");
  process.exit(1);
}
html = html.replace(/(<meta\s+name="app-version"\s+content=")[^"]*(")/, `$1${VERSION}$2`);
for (const f of FILES) {
  if (f === "index.html") continue;
  html = html
    .replace(new RegExp(`="${escapeRe(f)}\\?v=[^"]*"`, "g"), `="${f}"`) // strip the previous stamp
    .replace(new RegExp(`="${escapeRe(f)}"`, "g"), `="${f}?v=${VERSION}"`);
}

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
for (const f of FILES) {
  if (f === "index.html") fs.writeFileSync(path.join(WWW, f), html);
  else fs.copyFileSync(path.join(ROOT, f), path.join(WWW, f));
}
fs.writeFileSync(path.join(ROOT, "index.html"), html); // the live site IS this file (GitHub Pages serves main/)
console.log("www/ ready: " + FILES.length + " files, version " + VERSION);
