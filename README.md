# Mushaf Hifz

Alat bantu hafalan Qur'an berbasis web, offline — layout 15-baris ala Mushaf
Madinah, tampilan per-kata yang bisa disembunyikan/ditampilkan (reveal
cursor) buat latihan hafalan, dan bookmark per-device.

**Live**: https://1efeys1.github.io/mushaf-hifz/

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

## Struktur file

- `index.html` / `style.css` / `app.js` — shell, styling, logic. Kecil,
  sering diedit.
- `fonts.css` — 4 font Arab Qur'an di-embed sebagai base64 (`@font-face`),
  ~375KB, jarang berubah.
- `data.js` — seluruh teks Qur'an + layout per-halaman + metadata surah +
  daftar ayat sajda, ~1.5MB, jarang berubah. Semua dimuat lewat
  `<script src="...">` biasa, gak ada `fetch()` saat runtime — situsnya
  bener-bener offline setelah halaman pertama kali kebuka.
- `package.json` / `build/serve.js` — `bun dev`/`bun start` buat testing
  lokal (lihat di atas).
- `build/build_data.py` — regenerasi `data.js` dari dataset upstream
  (butuh internet, `python build/build_data.py`).
- `build/build_single_file.py` — gabungin 5 file di atas jadi satu
  `mushaf-hifz-offline.html` (buat dikirim manual, misal lewat WhatsApp).
- `mushaf-hifz(4).html` — versi paling awal, butuh internet tiap buka
  (`api.alquran.cloud`). Disimpan cuma buat referensi historis, gitignored
  dari repo publik.

Detail teknis lebih lengkap (keputusan desain, bug yang udah difix, status
verifikasi) ada di `NOTES.md` — file itu sengaja gitignored, jadi cuma ada
lokal.
