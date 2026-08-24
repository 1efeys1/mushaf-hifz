# Mushaf Hifz — working notes

Single project notes file, organised by scope. Update sections in place rather
than appending new dated entries.

## Handoff status (read this first)

This project is being handed off to a Claude Code session running from
`D:\tmp\mushaf-hifz` (copied from `D:\Projects\MySelf\mushaf-hifz-pro`,
git history included). Original location left intact.

**State**: app is fully built and working (see sections below). Local git repo
has one commit. **Not pushed anywhere yet.**

**Immediate next step** — push to the empty GitHub repo the user already
created (`1efeys1`, logged into GitHub as themselves):

```
git remote add origin https://github.com/1efeys1/mushaf-hifz.git
git branch -M main
git push -u origin main
```

First push may pop up a Git Credential Manager login window on the user's
screen — that's expected, they log in as `1efeys1` there.

**After push** — user needs to enable GitHub Pages themselves (repo Settings →
Pages → Source: "Deploy from a branch" → branch `main`, folder `/ (root)` →
Save). Site goes live at `https://1efeys1.github.io/mushaf-hifz/` within about
a minute. After that, every future `git push` to `main` auto-redeploys — no
more sending `.html` files around.

**Why split into 5 files instead of one big HTML** (per user's explicit ask,
to keep future edits cheap token-wise): `style.css`/`app.js` are small and
change often; `data.js` (~1.5MB) and `fonts.css` (~375KB) are large and change
rarely. Editing `style.css` or `app.js` alone never requires reading the big
files. `build/build_single_file.py` can still merge everything back into one
`mushaf-hifz-offline.html` on demand (gitignored) if a plain WhatsApp-shareable
file is ever needed again.

## Files

- `index.html` / `style.css` / `fonts.css` / `data.js` / `app.js` — the
  current, hosted app. This is what to edit going forward.
- `build/build_data.py` — regenerates `data.js` from scratch (downloads the
  upstream dataset itself, no manual steps). Run when the text/layout data
  needs a fix or the upstream dataset changes. Takes ~15s, needs internet.
- `build/build_single_file.py` — merges the 5 files above into
  `mushaf-hifz-offline.html` (gitignored, regenerate on demand — not needed
  for the hosted site).
- `mushaf-hifz(4).html` — the very original version, needs internet
  (`api.alquran.cloud`) on every open. Kept only as a historical reference.

## Offline conversion

All Qur'an text + page/line layout + surah metadata + sajda list are baked
into `data.js`, loaded via a plain `<script src="data.js">` — no `fetch()`
calls at runtime, `api.alquran.cloud` is only touched by `build/build_data.py`
at build time.

The 4 Arabic Qur'an fonts (Amiri Quran, Scheherazade New, Noto Naskh Arabic,
Lateef — Arabic-script subset only) are embedded as base64 `@font-face` data
in `fonts.css`, so the mushaf text always renders correctly with zero
internet. The two Latin UI fonts (Work Sans, Cormorant Garamond, buttons/
labels only) are still loaded from Google Fonts in `index.html` — harmless if
offline, the CSS already falls back to system sans-serif/serif for those;
only the app's chrome typography looks slightly different, never the Qur'an
text.

Drive-by fix: the original Google Fonts request asked for Lateef at a
variable weight range (`wght@400..700`) that font doesn't actually support,
so Google silently dropped Lateef from the whole combined request — the
"Lateef" option in the font dropdown never actually worked in the old file.
Fixed by embedding it directly (static weight 400).

**Data source**: page/line layout + word text come from the community dataset
[zonetecde/mushaf-layout](https://github.com/zonetecde/mushaf-layout) (604
pages, matches the printed Mushaf Madinah exactly, including pages 1/2 having
fewer than 15 lines — that's read straight from the data, not hardcoded). No
explicit license on that repo — fine per the user, personal use, not
redistributed commercially. Surah metadata (Arabic/English names, Makkiyah/
Madaniyah, ayah counts) and the 15 sajda-ayah positions come from
`api.alquran.cloud/v1/meta`.

**Known-and-fixed data bug**: the source dataset encodes the Quranic "dagger
alif" (U+0670) as tatweel+dagger-alif (`ـٰ`) in ~61% of its occurrences — a
KFGQPC/QPC-glyph-font convention that general-purpose fonts like Amiri Quran
can render as a stray dash (user spotted this in Surah Nuh; looked like wrong
ayah text). Diffed a whole surah word-for-word against `api.alquran.cloud` —
the *only* difference anywhere was this tatweel, so `build/build_data.py`
strips tatweel-before-dagger-alif dataset-wide (`normalize_rasm()`) while
leaving other legitimate tatweel uses (e.g. before a hamza-above seat) alone.
If another word ever looks visually wrong again, diff that surah against
`api.alquran.cloud/v1/surah/<N>/quran-uthmani` the same way before assuming
the underlying data/segmentation is broken — so far the dataset's actual word
content and ayah boundaries have been correct every time this was checked.

## Madinah 15-line layout

Each page renders exactly the lines the dataset defines for it (`surah-header`
/ `basmala` / `text` line types) — no hand-written "15 lines except page
1/2/bismillah-pages" rule; the real per-page line count is already baked into
the data, so it's correct automatically. Each dataset line becomes one
`.mushaf-line` block (not a flowing justified paragraph), kept to one visual
row via a JS routine (`fitLinesToWidth`) that shrinks a page-wide font-size
scale (down to a floor of 0.62x, so text never shrinks into illegibility on a
dense page) if a line would otherwise wrap on a narrow screen. `.surah-banner
.name` and `.basmalah` scale together with that same page-scale variable
(fixed bug: they used to be hardcoded px sizes, so on pages where the ayat
shrank a lot they'd look comically oversized next to the body text). Past the
floor, an individual very-dense line just gets its own tiny horizontal scroll
(`.mushaf-line{overflow-x:auto}`) instead of dragging every other line on the
page down to an unreadable size with it.

## Mobile layout

Reworked to look like a normal mobile Qur'an app instead of the original
desktop-first header wrapping into 4 rows:
- Header is a single compact row on narrow screens: ☰, wordmark, ⚙. Font
  family/size controls (rarely touched) moved into a dropdown panel opened by
  ⚙, instead of always taking up header space. Page prev/‹input›/next collapse
  to icon-only (labels hidden via `.btn-label`/`.pj-label`, shown again above
  760px).
- Removed the instructional hint text under the page entirely (was: "klik
  sebuah kata untuk menampilkan semua kata sebelumnya...").
- The reveal-controls row is a fixed footer bar — pulled out of the scrolling
  content into its own `flex-shrink:0` sibling of the `.reader-scroll`
  wrapper (only `.reader-scroll` scrolls now, not `main.reader` itself), so it
  never scrolls away and always stays one row.

## Word reveal UX

Changed from "click toggles that one word independently" to a linear
**reveal cursor** per page: clicking a word reveals every word before it (in
reading order) and hides everything after it. Progress persists per page when
navigating away and back. Ways to move the cursor, all sharing the same
`moveCursor()`/`revealNextAyah()` functions:
- Space / Backspace keys, or the ⎵/⌫ on-screen buttons — one word at a time.
- **⏭ 1 Ayat button** (new) — reveals the rest of whichever ayah comes next
  in one go, via `revealNextAyah()` (advances the cursor until the [surah,ayah]
  pair changes, using `getPageWordAyahList()`).
- ↺ / 👁 buttons — jump the cursor to the start / end of the page.

**Current-ayah indicator** (new): the page-toolbar status line now shows
"Ayat N" — the ayah of the last-revealed word (or the page's first ayah if
nothing's revealed yet), computed in `updateStatus()` from the same
`getPageWordAyahList()`. Only shows the number, not which surah, since the
surah name(s) on the page are already shown separately right next to it.

## Mobile buttons

The reveal-controls footer bar (↺ / ⌫ Batal / ⎵ Lanjut / ⏭ 1 Ayat / 👁) is one
row that fits down to a 375px-wide phone (verified: ~292px of buttons + gaps
+ padding). Icon-only buttons (↺, 👁) use a `title` tooltip since there's no
room for a label at that width.

## Verification status

- Confirmed via a local static-server preview at both a 375px mobile viewport
  and desktop: page 1 (Al-Fatihah, 8 lines, 29 words), page 106 (An-Nisa'
  ending → Al-Ma'idah header+basmalah+13 more lines, 0 lines overflowing),
  page 604 (15 lines across 3 short surahs). No console errors, no network
  requests to `api.alquran.cloud` at runtime. Header compact single row at
  375px; footer bar confirmed structurally un-scrollable (flex sibling of the
  scrolling container, not a descendant); all 5 reveal-controls buttons fit
  one row at 375px.
- Confirmed the split multi-file version (`index.html` + friends) loads and
  behaves identically to the old merged single-file version.
- Not yet manually verified: click/Space/Backspace/⏭-1-Ayat interaction and
  the mobile buttons' actual tap behavior on a real phone — needs a manual
  check by opening the hosted URL (or `mushaf-hifz-offline.html`) with
  WiFi/data off.
