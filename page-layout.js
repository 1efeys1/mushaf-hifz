// Turns api.quran.com's per-word verse data into the page's line-by-line structure the reader
// renders — surah headers, Basmalah lines, and text lines made of [surah, ayah, startWord, text,
// endsAyah, isSajda] runs. Pure transform: no network, no DOM, same shape every time for the
// same input (see quran-api.js for fetching, app.js for rendering).
//
// Line format (one entry per visual mushaf line), matches api.quran.com's own line_number field
// so the 15-line-per-page layout is exactly what the API says it is, not something computed here:
//   surah header: ["h", surahNumber, arabicTitle]
//   Basmalah:     ["b"]
//   text line:    ["t", [[surah, ayah, startWordPosition, "word1 word2 ...", endsAyah, isSajda], ...]]
//     — one array entry per run of consecutive words belonging to the same ayah; most lines have
//       exactly one run, a line spanning an ayah boundary has two+. `endsAyah` is true only when
//       this run's last word is genuinely the ayah's last word on this page (the API marks the
//       ayah-ending digit as its own "end"-type word entry, right after it) — an ayah that
//       continues onto the next page has no such marker on this page, so no run here ends it.
(function(window){
  "use strict";

  function buildPageLines(pageNo, verses, surahMeta){
    var entries = [];
    verses.forEach(function(v){
      var colon = v.verse_key.indexOf(":");
      var surah = +v.verse_key.slice(0, colon);
      var ayah = +v.verse_key.slice(colon + 1);
      var isSajda = v.sajdah_number != null;
      v.words.forEach(function(w){
        if (w.page_number !== pageNo) return;
        entries.push({
          surah: surah, ayah: ayah, line: w.line_number, position: w.position,
          text: w.text_uthmani, isEnd: w.char_type_name !== "word", isSajda: isSajda
        });
      });
    });

    var lines = [];
    var lastSurah = null;
    var curLineNum = null;
    var runs = null;
    var curRun = null;

    function flushRun(endsAyah){
      if (curRun) runs.push([curRun.surah, curRun.ayah, curRun.startWord, curRun.words.join(" "), !!endsAyah, curRun.isSajda]);
      curRun = null;
    }
    function flushLine(){
      flushRun(false);
      if (runs && runs.length) lines.push(["t", runs]);
      runs = null;
    }

    entries.forEach(function(e){
      // The ayah-ending marker's own `line_number` doesn't always match the line its word is
      // actually on — real mushaf typesetting sometimes pushes the tiny number-circle glyph to
      // the start of the next line when it doesn't fit, and the API data reflects that. Handle
      // it before any line-number bookkeeping so it always lands on the run it belongs to,
      // never triggers a premature line flush, and never opens a stray line/run of its own.
      if (e.isEnd){
        flushRun(true);
        return;
      }
      if (e.surah !== lastSurah && e.ayah === 1){
        flushLine();
        var meta = surahMeta[e.surah - 1];
        lines.push(["h", e.surah, meta[1]]);
        if (meta[7]) lines.push(["b"]);
        lastSurah = e.surah;
        curLineNum = null;
      }
      if (e.line !== curLineNum){
        flushLine();
        runs = [];
        curLineNum = e.line;
      }
      if (!curRun || curRun.surah !== e.surah || curRun.ayah !== e.ayah){
        flushRun(false);
        curRun = { surah: e.surah, ayah: e.ayah, startWord: e.position, words: [], isSajda: e.isSajda };
      }
      curRun.words.push(e.text);
    });
    flushLine();

    return lines;
  }

  // Same page, grouped by ayah instead of by mushaf line_number — for the "Per Ayat" study
  // view (word-by-word + full-ayah translation), which reads continuously rather than
  // reproducing the printed page's exact line breaks. Needs `translations` (the verse-level
  // translation resource id) and `language` (word-by-word gloss language) requested on the
  // fetch for `word.translation`/`verse.translations` to be present — see quran-api.js's
  // loadTranslatedPage.
  //
  // Block format:
  //   surah header: ["h", surahNumber, arabicTitle]
  //   Basmalah:     ["b"]
  //   ayah block:   ["ayah", surah, ayah, isSajda, [[word, wordTranslation], ...], ayahTranslation]
  function buildAyahBlocks(pageNo, verses, surahMeta){
    var blocks = [];
    var lastSurah = null;

    verses.forEach(function(v){
      var colon = v.verse_key.indexOf(":");
      var surah = +v.verse_key.slice(0, colon);
      var ayah = +v.verse_key.slice(colon + 1);
      var wordsOnPage = v.words.filter(function(w){ return w.page_number === pageNo && w.char_type_name === "word"; });
      if (!wordsOnPage.length) return; // this verse doesn't actually appear on this page

      if (surah !== lastSurah && ayah === 1){
        var meta = surahMeta[surah - 1];
        blocks.push(["h", surah, meta[1]]);
        if (meta[7]) blocks.push(["b"]);
        lastSurah = surah;
      }

      var words = wordsOnPage.map(function(w){
        return [w.text_uthmani, w.translation ? w.translation.text : ""];
      });
      var ayahTranslation = (v.translations && v.translations[0]) ? v.translations[0].text : "";
      var isSajda = v.sajdah_number != null;
      blocks.push(["ayah", surah, ayah, isSajda, words, ayahTranslation]);
    });

    return blocks;
  }

  window.PageLayout = { buildPageLines: buildPageLines, buildAyahBlocks: buildAyahBlocks };
})(window);
