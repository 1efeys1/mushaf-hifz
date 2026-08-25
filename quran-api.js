// Fetches a mushaf page's word/ayah data from api.quran.com (mushaf=2 — the 15-line Madani
// edition this app targets; the API defaults to a different 16-line edition without it, see
// NOTES.md) and caches it in localStorage. Pure network+cache concern — turning the response
// into what the reader actually renders happens in page-layout.js.
(function(window){
  "use strict";

  var CACHE_PREFIX = "mushafHifzPageCache:";
  // The API provider's terms cap how long responses may be cached — 7 days.
  var CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var API_BASE = "https://api.quran.com/api/v4/verses/by_page/";
  var WORD_FIELDS = "text_uthmani,line_number,position";
  var VERSE_FIELDS = "verse_key,sajdah_number";

  function readCache(pageNo){
    try{
      var raw = localStorage.getItem(CACHE_PREFIX + pageNo);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || typeof entry.fetchedAt !== "number" || !Array.isArray(entry.verses)) return null;
      if (Date.now() - entry.fetchedAt > CACHE_TTL_MS){
        localStorage.removeItem(CACHE_PREFIX + pageNo);
        return null;
      }
      return entry.verses;
    } catch(e){
      return null;
    }
  }

  function writeCache(pageNo, verses){
    try{
      localStorage.setItem(CACHE_PREFIX + pageNo, JSON.stringify({ fetchedAt: Date.now(), verses: verses }));
    } catch(e){ /* storage full/unavailable — page still renders, just won't be cached */ }
  }

  function fetchPage(pageNo){
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

  window.QuranApi = {
    // Promise<verses[]> — from cache if fresh, otherwise fetched and cached.
    loadRawPage: function(pageNo){
      var cached = readCache(pageNo);
      if (cached) return Promise.resolve(cached);
      return fetchPage(pageNo).then(function(verses){
        writeCache(pageNo, verses);
        return verses;
      });
    }
  };
})(window);
