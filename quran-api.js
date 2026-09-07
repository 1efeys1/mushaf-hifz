// Fetches a mushaf page's word/ayah data from api.quran.com and caches it in localStorage.
// Pure network+cache concern — turning the response into what the reader actually renders
// happens in page-layout.js.
//
// Requests the 16-line Madani edition (this app's target — see NOTES.md for the 15-line/
// 16-line distinction). Quirk confirmed by direct testing, not documented anywhere: which
// edition's line_number values come back has nothing to do with the `mushaf` query param —
// it flips on whether `code_v2` is in word_fields. Its value is never used (this app renders
// text_uthmani with its own embedded fonts, not QPC glyph fonts), it's requested purely as
// the edition switch; removing it silently reverts to the 15-line edition.
(function(window){
  "use strict";

  // Bump this if the requested edition/fields ever change again — old cache entries under a
  // different prefix are simply ignored (and age out via each browser's own storage limits),
  // instead of serving whatever edition happened to be cached under the same key before.
  // v3: entries written before the neighbor-merge fix below are missing recovered verses on
  // ~30 pages and must not be served. Single namespace now: both view modes read this same
  // translated response (the mushaf layout needs word.translation for its optional per-word
  // glosses, and sharing means switching view modes never refetches).
  var CACHE_PREFIX = "mushafHifzTranslatedPageCache:v3:";
  // The API provider's terms cap how long responses may be cached — 7 days.
  var CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var API_BASE = "https://api.quran.com/api/v4/verses/by_page/";
  // code_v2 must stay in word_fields even though its value is unused — see file header. It's
  // what pins every fetch to the same 16-line page boundaries (buildPageLines and
  // buildAyahBlocks both filter words by page_number, and 15-line vs 16-line editions don't
  // share page breaks). text_uthmani_tajweed carries inline rule tags (see app.js's tajweed
  // renderer) — same caveat: removing it silently kills the tajweed toggle.
  var WORD_FIELDS = "text_uthmani,text_uthmani_tajweed,line_number,position,code_v2";
  var VERSE_FIELDS = "verse_key,sajdah_number";
  // translations=33: Kemenag (Indonesian Islamic Affairs Ministry) verse-level translation —
  // the standard/default Indonesian option among api.quran.com's resources. language=id: word-
  // by-word gloss language (word_translation_language does NOT do this, confirmed by testing).
  var TRANSLATION_RESOURCE_ID = "33";
  var TOTAL_PAGES = 604;

  function readCache(prefix, pageNo){
    try{
      var raw = localStorage.getItem(prefix + pageNo);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || typeof entry.fetchedAt !== "number" || !Array.isArray(entry.verses)) return null;
      if (Date.now() - entry.fetchedAt > CACHE_TTL_MS){
        localStorage.removeItem(prefix + pageNo);
        return null;
      }
      return entry.verses;
    } catch(e){
      return null;
    }
  }

  function writeCache(prefix, pageNo, verses){
    try{
      localStorage.setItem(prefix + pageNo, JSON.stringify({ fetchedAt: Date.now(), verses: verses }));
    } catch(e){ /* storage full/unavailable — page still renders, just won't be cached */ }
  }

  function getISOWeek() {
    const date = new Date();
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    // Kamis di minggu yang sama menentukan tahun ISO-nya
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return String(Math.ceil((((d - yearStart) / 86400000) + 1) / 7));
  }

  function fetchRawVerses(pageNo){
    //const params = new URLSearchParams(window.location.search);
    //const w = params.get('w') || getISOWeek();
    //console.log("Parameter minggu: " + w);
    var url = API_BASE + pageNo + "?words=true&word_fields=" + WORD_FIELDS +
      "&fields=" + VERSE_FIELDS + "&translations=" + TRANSLATION_RESOURCE_ID + "&language=id" +
      "&mushaf=2&per_page=all";
    return fetch(url).then(function(res){
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function(data){
      if (!data || !Array.isArray(data.verses)) throw new Error("unexpected API response shape");
      return data.verses;
    });
  }

  // `verses/by_page/<N>`'s verse list is out of sync with its own words' page tags in two
  // mirrored ways (same root cause: the verse→page index and the per-word page_number tags
  // are separate datasets that occasionally disagree). Forward (confirmed on page 564,
  // Al-Qalam 68:16): the verse is absent from by_page/N's own list but present in
  // by_page/N+1's, its words still correctly tagged page_number:N. Backward (confirmed on
  // pages 596→597, Ash-Sharh 94:3-8 — surfaced as "surah 94 only shows 2 ayat"): the verse
  // IS listed under by_page/N, but all its words are tagged page_number:N+1 and by_page/N+1's
  // list doesn't contain it — page N filters its words out and page N+1 never receives the
  // verse object, so those ayat render nowhere, in either view mode. A one-time sweep of all
  // 604 pages with these exact fetch params found 13 forward and 43 backward cases, every
  // one recoverable from a neighbor page's list. So a page load fetches BOTH neighbors in
  // parallel and pulls in any listed-elsewhere verse whose words belong to the page being
  // loaded — cheap since it only costs extra requests on a first, uncached load, and a
  // failed neighbor must never break the page actually being loaded.
  function verseReadingOrder(a, b){
    var ac = a.verse_key.indexOf(":"), bc = b.verse_key.indexOf(":");
    var as = +a.verse_key.slice(0, ac), bs = +b.verse_key.slice(0, bc);
    if (as !== bs) return as - bs;
    return (+a.verse_key.slice(ac + 1)) - (+b.verse_key.slice(bc + 1));
  }

  function fetchPageWithNeighbors(pageNo, fetchRawFn){
    var mainPromise = fetchRawFn(pageNo);
    var neighborPages = [];
    if (pageNo > 1) neighborPages.push(pageNo - 1);
    if (pageNo < TOTAL_PAGES) neighborPages.push(pageNo + 1);
    var neighborPromises = neighborPages.map(function(n){
      return fetchRawFn(n).catch(function(){ return null; });
    });

    return Promise.all([mainPromise].concat(neighborPromises)).then(function(results){
      var verses = results[0];
      var seenKeys = Object.create(null);
      verses.forEach(function(v){ seenKeys[v.verse_key] = true; });
      var merged = verses.slice();
      for (var i = 1; i < results.length; i++){
        var neighborVerses = results[i];
        if (!neighborVerses) continue;
        neighborVerses.forEach(function(v){
          if (seenKeys[v.verse_key]) return;
          if (v.words.some(function(w){ return w.page_number === pageNo; })){
            merged.push(v);
            seenKeys[v.verse_key] = true;
          }
        });
      }
      // The renderer lays lines/blocks out in list order, so a verse merged in at the end
      // must be re-sorted into reading order or it renders as a stray line/block at the
      // page bottom. by_page's own lists already come in reading order; sorting is a no-op
      // for them (and skipped entirely when nothing was merged).
      if (merged.length !== verses.length) merged.sort(verseReadingOrder);
      return merged;
    });
  }

  window.QuranApi = {
    // Promise<verses[]> — from cache if fresh, otherwise fetched and cached. Both view modes
    // share this one fetch. `force` skips the cache read and refetches/overwrites — used by
    // app.js's verse-gap self-heal when a response (live or cached) is missing a verse it
    // should contain.
    loadPage: function(pageNo, force){
      const params = new URLSearchParams(window.location.search);
      const w = params.get('w') || getISOWeek();
      //console.log("Parameter minggu: " + w);
      const prefix = CACHE_PREFIX + w + ":";
      if (!force){
        var cached = readCache(prefix, pageNo);
        if (cached) return Promise.resolve(cached);
      }
      return fetchPageWithNeighbors(pageNo, fetchRawVerses).then(function(verses){
        writeCache(prefix, pageNo, verses);
        return verses;
      });
    }
  };
})(window);
