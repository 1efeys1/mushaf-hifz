// Reciter playback engine — one shared <audio> element, one thing plays at a time.
//
// Sources (both verified serving audio/mpeg, deterministic URLs — no per-play API calls):
//  - full ayah: the QDC gapless per-SURAH file (same recording the segment timings below
//      describe, so word-sync is exact): https://download.quranicaudio.com/qdc/…
//      played by seeking to the verse's timestamp_from — this is how quran.com itself
//      plays. Falls back to per-ayah files when the timings API is unreachable:
//      https://cdn.islamic.network/quran/audio/128/ar.alafasy/{globalAyahNumber}.mp3
//      ({N} = 1..6236 counting from 1:1, computed locally from SURAH_META).
//  - single word: Quran.com's legacy word-by-word CDN set (fixed reciter, not Alafasy)
//      https://audio.qurancdn.com/wbw/{sss}_{aaa}_{www}.mp3
//    where www is the word's ordinal among the ayah's REAL words only — end/pause marker
//    positions 404 (verified), which matches how the app already filters words.
(function(window){
  "use strict";

  var AYAH_CDN = "https://cdn.islamic.network/quran/audio/128/ar.alafasy/";
  var WORD_CDN = "https://audio.qurancdn.com/wbw/";
  var TIMINGS_URL = "https://api.quran.com/api/qdc/audio/reciters/7/audio_files?chapter=";

  function pad3(n){
    return (n < 10 ? "00" : n < 100 ? "0" : "") + n;
  }

  // cumulative ayah count per surah, built once from SURAH_META (surah N's first ayah =
  // offset[N-1] + 1) — the global numbering the Islamic Network CDN keys its files by
  var ayahOffsets = (function(){
    var offsets = [0];
    for (var i = 0; i < SURAH_META.length; i++) offsets.push(offsets[i] + SURAH_META[i][5]);
    return offsets;
  })();

  function globalAyahNumber(surah, ayah){
    return ayahOffsets[surah - 1] + ayah;
  }

  function ayahAudioUrl(surah, ayah){
    return AYAH_CDN + globalAyahNumber(surah, ayah) + ".mp3";
  }

  function wordAudioUrl(surah, ayah, wordOrdinal){
    return WORD_CDN + pad3(surah) + "_" + pad3(ayah) + "_" + pad3(wordOrdinal) + ".mp3";
  }

  var el = null; // the shared <audio>, created lazily
  var playToken = 0; // bump on every new play/stop so stale 'ended'/'error' handlers no-op
  var playCallSeq = 0; // guards the async timings lookup in playAyah against a newer tap

  function ensureEl(){
    if (el) return el;
    el = document.createElement("audio");
    el.preload = "auto";
    document.body.appendChild(el);
    return el;
  }

  // ---- verse timings (Quran.com's QDC segments API) ----
  // Alafasy murattal is reciter id 7 there (coincidentally the same number as the legacy
  // v4 recitations id). Each verse carries segments [wordPosition, startMs, endMs],
  // ABSOLUTE in the surah's gapless file whose URL rides along in the same response.
  // Failures are cached as null — never refetched per ayah.
  var timingsCache = Object.create(null); // surah -> {url, verses} | null

  function loadTimings(surah){
    if (timingsCache[surah] !== undefined) return Promise.resolve(timingsCache[surah]);
    return fetch(TIMINGS_URL + surah + "&segments=true")
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        var f = j && j.audio_files && j.audio_files[0];
        timingsCache[surah] = (f && Array.isArray(f.verse_timings) && f.verse_timings.length)
          ? { url: f.audio_url, verses: f.verse_timings }
          : null;
        return timingsCache[surah];
      })
      .catch(function(){ timingsCache[surah] = null; return null; });
  }

  function playUrl(url, onEnd, onError){
    var a = ensureEl();
    playToken++;
    var token = playToken;
    gaplessNow = null;
    a.pause();
    a.ontimeupdate = null; // a stale gapless watchdog must not double-fire on this play
    a.src = url;
    a.playbackRate = speed;
    a.onended = function(){ if (token === playToken && onEnd) onEnd(); };
    // a load failure surfaces here (404, offline); the caller decides whether it's fatal or
    // just skipped — only a missing onError falls back to advancing like a normal end
    a.onerror = function(){
      if (token !== playToken) return;
      if (onError) onError();
      else if (onEnd) onEnd();
    };
    // play() returns a promise that rejects when a subsequent pause()/src-swap interrupts a
    // still-loading play (the normal case when a new tap cuts the previous one short) —
    // swallow it so it never surfaces as an unhandled rejection
    var p = a.play();
    if (p && p.catch) p.catch(function(){});
    return token;
  }

  // ---- gapless per-surah playback (the sync-exact path) ----
  // The element loads the surah's gapless file once, then each ayah is a seek to the
  // verse's timestamp_from; a timeupdate watchdog ends it at timestamp_to ('ended' only
  // fires at the file's very end, so verse boundaries are ours to enforce). Karaoke reads
  // currentTime directly against the SAME absolute segment times — zero drift possible.
  var gaplessNow = null; // {surah} while the element plays a gapless file
  var gaplessSrc = ""; // the url currently loaded into the element, "" when per-file

  function playGaplessAyah(surah, ayah, timings, onEnd, onError, seamlessNext, chainEntry){
    var a = ensureEl();
    var vt = timings.verses[ayah - 1];
    playToken++;
    var token = playToken;
    gaplessNow = { surah: surah };
    // verse boundaries sit at from−40/to−40, contiguous in the gapless stream. A wider
    // pre-roll used to replay the boundary region — including the first syllable of ayat
    // whose word marks start slightly before their verse_from — audibly doubling every
    // ayah's opening ("al-alladzi…"). −40 still covers the observed early marks.
    var from = Math.max(0, vt.timestamp_from - 40);
    var to = vt.timestamp_to;
    var finished = false;

    // seamless chaining: for a mid-range verse whose successor continues the same stream,
    // the watchdog crossing to−40 does NOT pause/seek/play — the element just rolls
    // through the boundary and the next call re-arms the watchdog (see the seamless entry
    // below). pausing and re-playing the SAME position made mobile Chrome flush and
    // replay its decoded-audio buffer, doubling every ayah's opening even though the
    // event trace looked perfect.
    function finish(){
      if (finished || token !== playToken) return;
      finished = true;
      if (!seamlessNext) a.pause();
      if (onEnd) onEnd();
    }

    // (re)arm the boundary watchdog — 'timeupdate' alone fires only every ~250ms, letting
    // a verse end overshoot into the next verse's opening; the 60ms poll lands it tight
    function arm(){
      a.onended = null;
      var pollIv = setInterval(function(){
        if (token !== playToken || finished){ clearInterval(pollIv); return; }
        if (a.currentTime * 1000 >= to - 40){ clearInterval(pollIv); finish(); }
      }, 60);
      a.ontimeupdate = function(){
        if (token !== playToken) return;
        if (a.currentTime * 1000 >= to - 40){ clearInterval(pollIv); finish(); }
      };
      a.onerror = function(){
        if (token !== playToken) return;
        gaplessNow = null;
        if (onError) onError();
        else if (onEnd) onEnd();
      };
    }

    // the previous verse's watchdog just crossed into this one and left the element
    // rolling right here — re-arm only, no seek, no play, no pause
    if (chainEntry){
      arm();
      return;
    }

    function begin(){
      if (token !== playToken) return;
      arm();
      // play only once the seek has actually landed — calling play() on a pending seek
      // lets mobile Chrome render from the OLD position first, replaying the boundary
      // audio before the jump (a safety timeout covers same-position seeks that fire no
      // 'seeked' event)
      a.currentTime = from / 1000;
      a.playbackRate = speed;
      var went = false;
      function go(){
        if (went || token !== playToken) return;
        went = true;
        if (rangeQueue && rangeQueue.paused) return; // pauseRange raced the seek
        var p = a.play();
        if (p && p.catch) p.catch(function(){});
      }
      var guard = setTimeout(go, 350);
      a.addEventListener("seeked", function onSeeked(){
        a.removeEventListener("seeked", onSeeked);
        clearTimeout(guard);
        go();
      });
    }

    if (gaplessSrc !== timings.url){
      gaplessSrc = timings.url;
      a.onended = null;
      a.ontimeupdate = null;
      a.onerror = function(){
        if (token !== playToken) return;
        gaplessSrc = "";
        gaplessNow = null;
        if (onError) onError();
        else if (onEnd) onEnd();
      };
      a.src = timings.url;
      a.addEventListener("loadedmetadata", function onMeta(){
        a.removeEventListener("loadedmetadata", onMeta);
        begin();
      });
    } else {
      begin();
    }
  }

  var speed = 1;
  var rangeQueue = null; // active range playback: {surah, from, to, repeat, ayah, rep, token, paused, errStreak, pending, gapless}

  window.Reciter = {
    // verse timings for a surah (shared with the karaoke feature — one fetch, one cache).
    // Resolves {url, verses} or null; verses[ayah-1] = {timestamp_from, timestamp_to, segments}
    timings: function(surah){ return loadTimings(surah); },

    // truthy {surah} while the shared element is playing that surah's gapless file —
    // karaoke uses ABSOLUTE segment times in that mode, verse_from-relative otherwise
    playingGapless: function(){ return gaplessNow; },

    // full-ayah playback: gapless when timings are reachable, per-ayah file otherwise
    playAyah: function(surah, ayah, onEnd, onError){
      rangeQueue = null; // a tap-play always interrupts an active range
      var call = ++playCallSeq;
      loadTimings(surah).then(function(t){
        if (call !== playCallSeq) return; // superseded by a newer play request
        if (t) playGaplessAyah(surah, ayah, t, onEnd, onError);
        else playUrl(ayahAudioUrl(surah, ayah), onEnd, onError);
      });
    },
    // single-word playback (word-by-word CDN set)
    playWord: function(surah, ayah, wordOrdinal, onEnd, onError){
      rangeQueue = null;
      return playUrl(wordAudioUrl(surah, ayah, wordOrdinal), onEnd, onError);
    },
    stop: function(){
      rangeQueue = null;
      playToken++;
      if (el){
        el.pause();
        el.ontimeupdate = null;
        el.onended = null;
        el.onerror = null;
        el.removeAttribute("src");
        el.load();
      }
      gaplessNow = null;
      gaplessSrc = "";
    },
    setSpeed: function(rate){
      speed = rate;
      if (el) el.playbackRate = rate;
    },
    getSpeed: function(){ return speed; },

    // ---- range playback: ayahs from..to of one surah, each repeated `repeat` times ----
    // onProgress(ayah, rep) fires when an ayah repetition starts; onDone() when the whole
    // range finishes (or is stopped). A failed ayah is skipped, but three failures in a row
    // (offline / CDN down) abort the range via onError instead of burning through it.
    startRange: function(surah, from, to, repeat, onProgress, onDone, onError){
      playToken++;
      rangeQueue = { surah: surah, from: from, to: to, repeat: repeat, ayah: from, rep: 1, paused: false, errStreak: 0, pending: true, gapless: null, rolled: false };
      var queue = rangeQueue;

      function step(){
        if (rangeQueue !== queue) return;
        onProgress(queue.ayah, queue.rep);
        var vt = queue.gapless && queue.gapless.verses[queue.ayah - 1];
        function advance(){
          if (rangeQueue !== queue) return;
          if (queue.rep < queue.repeat){ queue.rep++; }
          else if (queue.ayah < queue.to){ queue.ayah++; queue.rep = 1; }
          else { rangeQueue = null; onDone(); return; }
          step();
        }
        function onFail(){
          queue.errStreak++;
          if (queue.errStreak >= 3){ rangeQueue = null; if (onError) onError(); return; }
          advance();
        }
        if (vt){
          // mid-range with no repeat left: the next verse continues the same gapless
          // stream — chain it seamlessly (no pause/seek/play at the boundary, see
          // playGaplessAyah). queue.rolled records that the element is still rolling
          // from the previous verse's seamless finish, so the next call re-arms only.
          var chainNext = queue.rep >= queue.repeat && queue.ayah < queue.to;
          var entry = queue.rolled ? "chain" : undefined;
          playGaplessAyah(queue.surah, queue.ayah, queue.gapless,
            function(){ queue.errStreak = 0; advance(); }, onFail,
            chainNext, entry);
          queue.rolled = chainNext;
        } else {
          // fallback per-file path: warm the next ayah while this one plays
          var nextIsRepeat = queue.rep < queue.repeat;
          var nextIsAyah = queue.ayah < queue.to;
          if (nextIsRepeat || nextIsAyah) preload(ayahAudioUrl(surah, nextIsRepeat ? queue.ayah : queue.ayah + 1));
          playUrl(ayahAudioUrl(surah, queue.ayah), function(){ queue.errStreak = 0; advance(); }, onFail);
        }
      }

      // the queue exists immediately (silent-reveal guards + UI depend on rangeActive),
      // but playback waits for the timings lookup so the very first ayah can be gapless
      queue.restep = step; // replayRangeAyah re-runs the current ayah through this
      loadTimings(surah).then(function(t){
        if (rangeQueue !== queue) return;
        queue.pending = false;
        queue.gapless = t;
        step();
      });
      return queue;
    },
    rangeActive: function(){ return !!rangeQueue; },
    rangePaused: function(){ return !!(rangeQueue && rangeQueue.paused); },
    pauseRange: function(){
      if (rangeQueue && el){ rangeQueue.paused = true; el.pause(); }
    },
    resumeRange: function(){
      if (rangeQueue && rangeQueue.paused){ rangeQueue.paused = false; el.play().catch(function(){}); }
    },
    // restart the range's CURRENT ayah from its top — the "ulangi ayat ini" tap. Works
    // mid-play or while paused; resets the seamless-chain state so the engine re-seeks
    // (a chain entry would just re-arm the watchdog where the element happens to sit).
    replayRangeAyah: function(){
      var q = rangeQueue;
      if (!q || q.pending || !q.restep) return;
      q.rolled = false;
      q.paused = false;
      q.restep();
    },
    stopRange: function(){
      if (!rangeQueue) return;
      rangeQueue = null;
      playToken++;
      if (el){
        el.pause();
        el.ontimeupdate = null;
        el.onended = null;
        el.onerror = null;
        el.removeAttribute("src");
        el.load();
      }
      gaplessNow = null;
      gaplessSrc = "";
    },

    // test/inspection hooks (used by the browser-tool verification, muted so autoplay
    // policies don't block headless play)
    _el: function(){ return ensureEl(); },
    _urls: { ayah: ayahAudioUrl, word: wordAudioUrl, global: globalAyahNumber }
  };

  // prefetch helper — warm the browser's HTTP cache for the next ayah on the fallback
  // per-file path (gapless needs no prefetch: one file serves the whole surah)
  function preload(url){
    var pre = new Audio();
    pre.preload = "auto";
    pre.src = url;
  }
})(window);
