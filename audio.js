// Reciter playback engine — one shared <audio> element, one thing plays at a time.
//
// Sources (both verified serving audio/mpeg, deterministic URLs — no per-play API calls):
//  - full ayah: Mishary Rashid Alafasy 128kbps, Islamic Network's public CDN
//      https://cdn.islamic.network/quran/audio/128/ar.alafasy/{globalAyahNumber}.mp3
//    ({N} = 1..6236 counting from 1:1, computed locally from SURAH_META's ayah counts)
//  - single word: Quran.com's legacy word-by-word CDN set (fixed reciter, not Alafasy)
//      https://audio.qurancdn.com/wbw/{sss}_{aaa}_{www}.mp3
//    where www is the word's ordinal among the ayah's REAL words only — end/pause marker
//    positions 404 (verified), which matches how the app already filters words.
(function(window){
  "use strict";

  var AYAH_CDN = "https://cdn.islamic.network/quran/audio/128/ar.alafasy/";
  var WORD_CDN = "https://audio.qurancdn.com/wbw/";

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

  function ensureEl(){
    if (el) return el;
    el = document.createElement("audio");
    el.preload = "auto";
    document.body.appendChild(el);
    return el;
  }

  function playUrl(url, onEnd, onError){
    var a = ensureEl();
    playToken++;
    var token = playToken;
    a.pause();
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

  var speed = 1;
  var rangeQueue = null; // active range playback: {surah, from, to, repeat, ayah, rep, token, paused}

  // prefetch helper — warm the browser's HTTP cache for the next ayah so range playback
  // doesn't stall between ayat on a slow connection
  function preload(url){
    var pre = new Audio();
    pre.preload = "auto";
    pre.src = url;
  }

  window.Reciter = {
    // full-ayah playback (Alafasy)
    playAyah: function(surah, ayah, onEnd, onError){
      rangeQueue = null; // a tap-play always interrupts an active range
      return playUrl(ayahAudioUrl(surah, ayah), onEnd, onError);
    },
    // single-word playback (word-by-word CDN set)
    playWord: function(surah, ayah, wordOrdinal, onEnd, onError){
      rangeQueue = null;
      return playUrl(wordAudioUrl(surah, ayah, wordOrdinal), onEnd, onError);
    },
    stop: function(){
      rangeQueue = null;
      playToken++;
      if (el){ el.pause(); el.removeAttribute("src"); el.load(); }
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
      rangeQueue = { surah: surah, from: from, to: to, repeat: repeat, ayah: from, rep: 1, paused: false, errStreak: 0 };
      var queue = rangeQueue;

      function step(){
        if (rangeQueue !== queue) return;
        onProgress(queue.ayah, queue.rep);
        var nextIsRepeat = queue.rep < queue.repeat;
        var nextIsAyah = queue.ayah < queue.to;
        if (nextIsRepeat || nextIsAyah) preload(ayahAudioUrl(surah, nextIsRepeat ? queue.ayah : queue.ayah + 1));
        function advance(){
          if (rangeQueue !== queue) return;
          if (queue.rep < queue.repeat){ queue.rep++; }
          else if (queue.ayah < queue.to){ queue.ayah++; queue.rep = 1; }
          else { rangeQueue = null; onDone(); return; }
          step();
        }
        playUrl(ayahAudioUrl(surah, queue.ayah), function(){
          queue.errStreak = 0;
          advance();
        }, function(){
          queue.errStreak++;
          if (queue.errStreak >= 3){ rangeQueue = null; if (onError) onError(); return; }
          advance();
        });
      }

      step();
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
    stopRange: function(){
      if (!rangeQueue) return;
      rangeQueue = null;
      playToken++;
      if (el){ el.pause(); el.removeAttribute("src"); el.load(); }
    },

    // test/inspection hooks (used by the browser-tool verification, muted so autoplay
    // policies don't block headless play)
    _el: function(){ return ensureEl(); },
    _urls: { ayah: ayahAudioUrl, word: wordAudioUrl, global: globalAyahNumber, preload: preload }
  };
})(window);
