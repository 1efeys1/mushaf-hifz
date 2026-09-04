// Copies the static web app into www/ for Capacitor to bundle into the APK.
// Regenerated on every `bun run apk` — www/ is gitignored.
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

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
for (const f of FILES) {
  fs.copyFileSync(path.join(ROOT, f), path.join(WWW, f));
}
console.log("www/ ready: " + FILES.length + " files");
