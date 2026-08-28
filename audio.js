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

  function playUrl(url, onEnd){
    var a = ensureEl();
    playToken++;
    var token = playToken;
    a.pause();
    a.src = url;
    a.playbackRate = speed;
    a.onended = function(){ if (token === playToken && onEnd) onEnd(); };
    a.onerror = function(){ if (token === playToken && onEnd) onEnd(); };
    // play() returns a promise that rejects when a subsequent pause()/src-swap interrupts a
    // still-loading play (the normal case when a new tap cuts the previous one short) —
    // swallow it so it never surfaces as an unhandled rejection
    var p = a.play();
    if (p && p.catch) p.catch(function(){});
    return token;
  }

  var speed = 1;

  window.Reciter = {
    // full-ayah playback (Alafasy)
    playAyah: function(surah, ayah, onEnd){
      return playUrl(ayahAudioUrl(surah, ayah), onEnd);
    },
    // single-word playback (word-by-word CDN set)
    playWord: function(surah, ayah, wordOrdinal, onEnd){
      return playUrl(wordAudioUrl(surah, ayah, wordOrdinal), onEnd);
    },
    stop: function(){
      playToken++;
      if (el){ el.pause(); el.removeAttribute("src"); el.load(); }
    },
    setSpeed: function(rate){
      speed = rate;
      if (el) el.playbackRate = rate;
    },
    getSpeed: function(){ return speed; },
    // test/inspection hooks (used by the browser-tool verification, muted so autoplay
    // policies don't block headless play)
    _el: function(){ return ensureEl(); },
    _urls: { ayah: ayahAudioUrl, word: wordAudioUrl, global: globalAyahNumber }
  };
})(window);
