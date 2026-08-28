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
  var CACHE_PREFIX = "mushafHifzPageCache:v3:";
  // Separate namespace from CACHE_PREFIX: the response shape differs (adds word.translation
  // and verse.translations), so it can't share cache entries with the plain mushaf-mode fetch.
  var CACHE_PREFIX_TRANSLATED = "mushafHifzTranslatedPageCache:v2:";
  // The API provider's terms cap how long responses may be cached — 7 days.
  var CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var API_BASE = "https://api.quran.com/api/v4/verses/by_page/";
  // code_v2 must stay in word_fields even though its value is unused — see file header. It's
  // what keeps this fetch on the same 16-line page boundaries as the plain mushaf-mode fetch,
  // which matters here too: buildAyahBlocks filters words by page_number, and 15-line vs
  // 16-line editions don't share page breaks. text_uthmani_tajweed carries inline rule tags
  // (see app.js's tajweed renderer) — same caveats: value needed for rendering, removing it
  // silently kills the tajweed toggle.
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

  function fetchRawVerses(pageNo){
    var url = API_BASE + pageNo + "?words=true&word_fields=" + WORD_FIELDS +
      "&fields=" + VERSE_FIELDS + "&mushaf=2&per_page=all";
    return fetch(url).then(function(res){
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function(data){
      if (!data || !Array.isArray(data.verses)) throw new Error("unexpected API response shape");
      return data.verses;
    });
  }

  function fetchRawTranslatedVerses(pageNo){
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

  // `verses/by_page/<N>` occasionally drops a verse that legitimately belongs on page N (all
  // its words are tagged page_number===N) — confirmed for real on page 564 (Al-Qalam 68:16):
  // absent from by_page/564's own verse list, but present in by_page/565's, with its words
  // still correctly tagged page_number:564. A dataset-wide scan found this isn't a one-off, and
  // nothing about it is specific to which fields were requested, so both the plain and
  // translated fetches below share this fix. Fetching page N+1 alongside page N and pulling in
  // any such orphaned verse recovers it — cheap since it only costs an extra request on a
  // first, uncached load (both fire in parallel), and the lookahead page also gets its own
  // cache entry, priming the very page a user is most likely to open next.
  function fetchPageWithLookahead(pageNo, fetchRawFn, cachePrefix){
    var mainPromise = fetchRawFn(pageNo);
    if (pageNo >= TOTAL_PAGES) return mainPromise;

    var lookaheadPromise = fetchRawFn(pageNo + 1).then(function(verses){
      if (!readCache(cachePrefix, pageNo + 1)) writeCache(cachePrefix, pageNo + 1, verses);
      return verses;
    }).catch(function(){ return null; }); // a failed lookahead shouldn't break the page actually being loaded

    return Promise.all([mainPromise, lookaheadPromise]).then(function(results){
      var verses = results[0];
      var nextVerses = results[1];
      if (!nextVerses) return verses;
      var seenKeys = Object.create(null);
      verses.forEach(function(v){ seenKeys[v.verse_key] = true; });
      var merged = verses.slice();
      nextVerses.forEach(function(v){
        if (seenKeys[v.verse_key]) return;
        var belongsToThisPage = v.words.some(function(w){ return w.page_number === pageNo; });
        if (belongsToThisPage) merged.push(v);
      });
      return merged;
    });
  }

  window.QuranApi = {
    // Promise<verses[]> — from cache if fresh, otherwise fetched and cached. `force` skips
    // the cache read and refetches/overwrites — used by app.js's verse-gap self-heal when a
    // response (live or cached) is missing a verse it should contain.
    loadRawPage: function(pageNo, force){
      if (!force){
        var cached = readCache(CACHE_PREFIX, pageNo);
        if (cached) return Promise.resolve(cached);
      }
      return fetchPageWithLookahead(pageNo, fetchRawVerses, CACHE_PREFIX).then(function(verses){
        writeCache(CACHE_PREFIX, pageNo, verses);
        return verses;
      });
    },
    // Same page, but with word.translation and verse.translations populated — for the "Per
    // Ayat" study view. Separate cache namespace/TTL from loadRawPage (see CACHE_PREFIX_TRANSLATED).
    loadTranslatedPage: function(pageNo, force){
      if (!force){
        var cached = readCache(CACHE_PREFIX_TRANSLATED, pageNo);
        if (cached) return Promise.resolve(cached);
      }
      return fetchPageWithLookahead(pageNo, fetchRawTranslatedVerses, CACHE_PREFIX_TRANSLATED).then(function(verses){
        writeCache(CACHE_PREFIX_TRANSLATED, pageNo, verses);
        return verses;
      });
    }
  };
})(window);
