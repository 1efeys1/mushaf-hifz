# Mushaf Hifz — working notes

Single project notes file, organised by scope. Update sections in place rather
than appending new dated entries.

## Files

- `mushaf-hifz(4).html` — original version, needs internet (api.alquran.cloud)
  on every open. Left untouched as a reference/fallback.
- `mushaf-hifz-offline.html` — current version. Fully offline, single file,
  ~1.93MB. This is the one to send/use going forward.

## Offline conversion

All Qur'an text + page/line layout + surah metadata + sajda list are baked
directly into `mushaf-hifz-offline.html` as inline `<script>` data (no
separate data folder — kept as one file on purpose so it can be sent over
WhatsApp and opened straight from a phone). No `fetch()` calls left at
runtime; `api.alquran.cloud` is only touched at build time when regenerating
the data.

The 4 Arabic Qur'an fonts (Amiri Quran, Scheherazade New, Noto Naskh Arabic,
Lateef — Arabic-script subset only) are also embedded as base64 `@font-face`
data, so the mushaf text itself always renders correctly with zero internet.
The two Latin UI fonts (Work Sans, Cormorant Garamond, used for buttons/labels
only) are still loaded from Google Fonts — harmless if offline, since the CSS
already falls back to system sans-serif/serif for those; only the app's
chrome typography would look slightly different, never the Qur'an text.

Drive-by fix: the original Google Fonts request asked for Lateef at a
variable weight range (`wght@400..700`) that font doesn't actually support,
so Google silently dropped Lateef from the whole combined request — the
"Lateef" option in the font dropdown never actually worked in the old file.
Fixed as part of embedding it directly (static weight 400).

**Data source**: page/line layout + word text come from the community dataset
[zonetecde/mushaf-layout](https://github.com/zonetecde/mushaf-layout) (604
pages, matches the printed Mushaf Madinah exactly, including pages 1/2 having
fewer than 15 lines). No explicit license on that repo — fine per the user,
personal use only, not redistributed. Surah metadata (Arabic/English names,
Makkiyah/Madaniyah, ayah counts) and the 15 sajda-ayah positions came from
`api.alquran.cloud/v1/meta`, fetched once at build time.

Regenerating the data (if the upstream dataset ever needs re-pulling) means
re-running the same build steps: download the mushaf-layout zip, strip
`qpcV1`/`qpcV2` glyph fields (unused — we render with the Amiri Quran/etc. web
fonts, not the proprietary QPC glyph fonts), group words into per-ayah runs,
strip the trailing embedded ayah-number digit from each ayah's last word (the
front-end draws its own styled circular badge instead), and re-fetch
`/v1/meta` for surah names + sajda list.

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
- The reveal-controls row (↺ / ⌫ Batal / ⎵ Lanjut / 👁) is a fixed footer bar
  — pulled out of the scrolling content into its own `flex-shrink:0` sibling
  of the new `.reader-scroll` wrapper (only `.reader-scroll` scrolls now, not
  `main.reader` itself), so it never scrolls away and always stays one row.

## Word reveal UX

Changed from "click toggles that one word independently" to a linear
**reveal cursor** per page: clicking a word reveals every word before it (in
reading order) and hides everything after it. Space / Backspace / the two new
on-screen buttons (⎵ Kata berikutnya, ⌫ Batalkan) all move that same cursor
forward/back by one word. "Tampilkan semua" / "Sembunyikan semua" jump the
cursor to the end / start. Progress persists per page when navigating away
and back (same as the old app's behavior).

## Mobile buttons

Added ⌫/⎵ buttons (short labels: "⌫ Batal", "⎵ Lanjut") to the reveal-controls
footer bar, wired to the same functions the keyboard handler uses. "Sembunyikan
semua"/"Tampilkan semua" became icon-only (↺ / 👁, with a `title` tooltip) so
all 4 buttons fit on one row even on a narrow phone — see "Mobile layout".

## Verification status

- Confirmed via a local static-server preview at both a 375px mobile viewport
  and desktop: page 1 (Al-Fatihah, 8 lines, 29 words), page 106 (An-Nisa'
  ending → Al-Ma'idah header+basmalah+13 more lines, all fitting with 0 lines
  overflowing after the safety-margin tweak), page 604 (15 lines across 3
  short surahs). No console errors, no network requests fired. Header is a
  compact single row at 375px (50px tall); the reveal-controls footer bar
  stays fixed at the bottom, one row, confirmed structurally un-scrollable
  (it's a flex sibling of the scrolling container, not a descendant).
- Not yet manually verified: the click/Space/Backspace reveal-cursor
  interaction and the mobile buttons' actual tap behavior on a real phone —
  needs a manual check by opening `mushaf-hifz-offline.html` with WiFi/data
  off.
