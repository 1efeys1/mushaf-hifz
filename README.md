# Mushaf Hifz

Alat bantu hafalan Qur'an berbasis web — layout 16-baris ala Mushaf Madinah,
tampilan per-kata yang bisa disembunyikan/ditampilkan (reveal cursor) buat
latihan hafalan, dan bookmark per-ayat per-device.

**Live**: <a href="https://1efeys1.github.io/mushaf-hifz/?w=1.3" target="_blank" rel="noopener noreferrer">mushaf-hifz 1.2</a>

## Jalanin di lokal

Situs ini murni HTML/CSS/JS statis — gak ada build step, gak ada
`npm install`. Tinggal serve foldernya lewat static server apa aja, gak bisa
langsung dobel-klik `index.html` di file explorer karena browser akan
memblokir `fetch`/module loading dari `file://`.

Butuh [Bun](https://bun.sh) — servernya zero-dependency, gak ada
`bun install` atau download apa pun:

```bash
bun dev
```

Lalu buka `http://localhost:8000` di browser. Ganti port kalau perlu:
`bun dev 3000`. `bun start` juga jalan, sama persis.

Butuh internet — teks & layout Qur'an di-fetch dari api.quran.com per
halaman saat diakses (lihat "Sumber data" di bawah), bukan dibundel di
repo.

## Struktur file

- `index.html` / `style.css` / `app.js` — shell, styling, logic. Kecil,
  sering diedit.
- `fonts.css` — 4 font Arab Qur'an di-embed sebagai base64 (`@font-face`),
  ~375KB, jarang berubah.
- `surah-meta.js` — metadata statis per surah (nama, jumlah ayat,
  halaman pertama, ada-tidaknya Basmalah) — kecil (~10KB), jarang berubah.
- `quran-api.js` — fetch halaman dari api.quran.com + cache di
  `localStorage` (maks 7 hari, sesuai ketentuan provider).
- `audio.js` — engine playback reciter (Mishary Rashid Alafasy per-ayat
  + audio per-kata), satu elemen `<audio>` bersama.
- `page-layout.js` — transformasi murni: data mentah API → struktur baris
  yang di-render `app.js` (deteksi header surah, Basmalah, akhir ayat,
  sajda).
- `package.json` / `build/serve.js` — `bun dev`/`bun start` buat testing
  lokal (lihat di atas).
- `build/build_surah_meta.py` — regenerasi `surah-meta.js` (butuh internet,
  `python build/build_surah_meta.py`).
- `mushaf-hifz(4).html` — versi paling awal (prototype), disimpan cuma buat
  referensi historis, gitignored dari repo publik.

## Sumber data

Teks & layout per-halaman/baris di-fetch live dari
`api.quran.com/api/v4/verses/by_page/<N>` — edisi Mushaf Madinah
**16-baris** yang jadi target app ini. Field `code_v2` di `word_fields`
itu yang nentuin edisi mana yang balik (bukan parameter `mushaf` seperti
dugaan awal — lihat `NOTES.md` buat detail lengkapnya), nilainya sendiri
gak dipakai buat render. Metadata surah (nama, halaman pertama, dsb) di
`surah-meta.js` datang dari `api.alquran.cloud/v1/meta` +
`api.quran.com/api/v4/chapters`.

Audio reciter (fitur 🔊 di bar bawah): per-ayat Mishary Rashid Alafasy
dari CDN publik Islamic Network (`cdn.islamic.network`), per-kata dari
set word-by-word CDN Quran.com (`audio.qurancdn.com`) — reciter per-kata
fixed (bukan Alafasy). 128kbps ≈ 1 MB/menit playback.

Detail teknis lebih lengkap (keputusan desain, bug yang udah difix, status
verifikasi) ada di `NOTES.md` — file itu sengaja gitignored, jadi cuma ada
lokal.
