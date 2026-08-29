(function(){
  "use strict";

  var TOTAL_PAGES = 604;
  var AR_DIGITS = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  var BASMALAH = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";

  function toArabicDigits(n){
    return String(n).split("").map(function(d){
      return /\d/.test(d) ? AR_DIGITS[+d] : d;
    }).join("");
  }

  // true wherever the sidebar renders as a fixed overlay instead of in-flow layout — matches
  // the CSS breakpoints in style.css (portrait mobile, or extreme landscape like a phone
  // rotated sideways, which is often *wider* than the portrait breakpoint so needs its own
  // check here too).
  function isOverlaySidebarMode(){
    return window.innerWidth <= 760 || (window.innerWidth > window.innerHeight && window.innerHeight <= 500);
  }

  // ---------------- state ----------------
  var currentPage = 1;
  var pageCursor = Object.create(null);      // pageNumber -> how many words (in reading order) are revealed
  var pageWordCountCache = Object.create(null);
  var pageWordAyahCache = Object.create(null); // pageNumber -> [[surah,ayah], ...] parallel to word reading order

  var reader = document.getElementById("reader");
  var shell = document.getElementById("shell");

  // ---------------- hint words: always keep an ayah's first N words visible as a memorization
  // cue, independent of the reveal cursor. A user preference, so it persists across sessions
  // the same way bookmarks do — not something re-picked every time the app opens. ----------------
  var HINT_WORDS_KEY = "mushafHifzHintWords";
  var HINT_WORDS_MAX = 5;

  function loadHintWordCount(){
    try{
      var n = parseInt(localStorage.getItem(HINT_WORDS_KEY), 10);
      return Number.isInteger(n) && n >= 0 && n <= HINT_WORDS_MAX ? n : 0;
    } catch(e){
      return 0;
    }
  }

  var hintWordCount = loadHintWordCount();

  function setHintWordCount(n){
    hintWordCount = Math.max(0, Math.min(HINT_WORDS_MAX, n));
    try{ localStorage.setItem(HINT_WORDS_KEY, String(hintWordCount)); } catch(e){ /* storage unavailable — just won't persist */ }
    renderPage(currentPage, true); // mode-aware — hint words apply in both mushaf and ayah view
  }

  // ---------------- view mode: "mushaf" (printed page, reveal-to-memorize) vs "ayah" (per-ayah
  // study view with word/ayah translations, no reveal cursor or pinch-zoom) — a device
  // preference like hint words, not re-picked every session. ----------------
  var VIEW_MODE_KEY = "mushafHifzViewMode";
  var AYAH_FONT_SCALE_KEY = "mushafHifzAyahFontScale";
  var TRANSLATION_FONT_SCALE_KEY = "mushafHifzTranslationFontScale";
  var AYAH_FONT_SCALE_MIN = 0.7, AYAH_FONT_SCALE_MAX = 1.8, AYAH_FONT_SCALE_STEP = 0.1;

  function loadViewMode(){
    try{
      return localStorage.getItem(VIEW_MODE_KEY) === "ayah" ? "ayah" : "mushaf";
    } catch(e){
      return "mushaf";
    }
  }

  function loadAyahFontScale(){
    try{
      var n = parseFloat(localStorage.getItem(AYAH_FONT_SCALE_KEY));
      return n >= AYAH_FONT_SCALE_MIN && n <= AYAH_FONT_SCALE_MAX ? n : 1;
    } catch(e){
      return 1;
    }
  }

  function loadTranslationFontScale(){
    try{
      var n = parseFloat(localStorage.getItem(TRANSLATION_FONT_SCALE_KEY));
      return n >= AYAH_FONT_SCALE_MIN && n <= AYAH_FONT_SCALE_MAX ? n : 1;
    } catch(e){
      return 1;
    }
  }

  var viewMode = loadViewMode();
  var ayahFontScale = loadAyahFontScale();
  var translationFontScale = loadTranslationFontScale();

  // syncs the toolbar/body to the current viewMode/ayahFontScale without changing either —
  // called after wiring the settings panel, and from the setters below.
  function applyViewModeUI(){
    document.body.classList.toggle("ayah-mode", viewMode === "ayah");
    var m = document.getElementById("viewByMushaf"), a = document.getElementById("viewByAyat");
    if (m && a){
      m.classList.toggle("active", viewMode === "mushaf");
      a.classList.toggle("active", viewMode === "ayah");
    }
  }

  function applyAyahFontScale(){
    document.documentElement.style.setProperty("--ayah-font-scale", ayahFontScale.toFixed(2));
    var slider = document.getElementById("arabicSizeSlider");
    if (slider) slider.value = String(ayahFontScale);
    var label = document.getElementById("fontSizeLabel");
    if (label) label.textContent = Math.round(ayahFontScale * 100) + "%";
  }

  function applyTranslationFontScale(){
    document.documentElement.style.setProperty("--translation-font-scale", translationFontScale.toFixed(2));
    var slider = document.getElementById("translationSizeSlider");
    if (slider) slider.value = String(translationFontScale);
    var label = document.getElementById("translationSizeLabel");
    if (label) label.textContent = Math.round(translationFontScale * 100) + "%";
  }

  function setViewMode(mode){
    mode = mode === "ayah" ? "ayah" : "mushaf";
    if (mode === viewMode) return;
    viewMode = mode;
    try{ localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch(e){ /* storage unavailable — just won't persist */ }
    applyViewModeUI();
    resetPageZoom(); // the two modes share one page element — never carry mushaf-mode zoom into the ayah view
    renderPage(currentPage);
  }

  function setAyahFontScale(n){
    ayahFontScale = Math.max(AYAH_FONT_SCALE_MIN, Math.min(AYAH_FONT_SCALE_MAX, Math.round(n * 10) / 10));
    try{ localStorage.setItem(AYAH_FONT_SCALE_KEY, String(ayahFontScale)); } catch(e){ /* storage unavailable — just won't persist */ }
    applyAyahFontScale();
  }

  function setTranslationFontScale(n){
    translationFontScale = Math.max(AYAH_FONT_SCALE_MIN, Math.min(AYAH_FONT_SCALE_MAX, Math.round(n * 10) / 10));
    try{ localStorage.setItem(TRANSLATION_FONT_SCALE_KEY, String(translationFontScale)); } catch(e){ /* storage unavailable — just won't persist */ }
    applyTranslationFontScale();
  }

  // ---------------- content prefs: what's visible on the page ----------------
  // All render-time visibility toggles (arabic words, translations, word glosses, tajweed
  // colors) are pure body classes — switching one never re-renders, so the reveal cursor is
  // never disturbed. hide-arabic only has any effect in the ayah view (.aw-ar only exists
  // there); the printed mushaf without Arabic would be pointless, so it ignores it.
  var CONTENT_PREFS_KEY = "mushafHifzContentPrefs";
  var LEGACY_TAJWEED_KEY = "mushafHifzTajweed"; // pre-settings-panel single toggle — migrated once

  function loadContentPrefs(){
    var prefs = { arabic: true, translation: true, wordGloss: true, tajweed: false };
    try{
      var raw = localStorage.getItem(CONTENT_PREFS_KEY);
      if (raw){
        var p = JSON.parse(raw);
        if (p && typeof p === "object"){
          ["arabic","translation","wordGloss","tajweed"].forEach(function(k){
            if (typeof p[k] === "boolean") prefs[k] = p[k];
          });
        }
      } else {
        var legacy = localStorage.getItem(LEGACY_TAJWEED_KEY);
        if (legacy !== null) prefs.tajweed = legacy === "on";
      }
    } catch(e){ /* storage unavailable — defaults */ }
    return prefs;
  }

  var contentPrefs = loadContentPrefs();

  function saveContentPrefs(){
    try{ localStorage.setItem(CONTENT_PREFS_KEY, JSON.stringify(contentPrefs)); } catch(e){ /* just won't persist */ }
  }

  function applyContentPrefsUI(){
    document.body.classList.toggle("tajweed-on", contentPrefs.tajweed);
    document.body.classList.toggle("hide-arabic", !contentPrefs.arabic);
    document.body.classList.toggle("hide-translation", !contentPrefs.translation);
    document.body.classList.toggle("hide-word-gloss", !contentPrefs.wordGloss);
    var ids = { contentArabic: "arabic", contentTranslation: "translation", contentWordGloss: "wordGloss", contentTajweed: "tajweed" };
    Object.keys(ids).forEach(function(id){
      var cb = document.getElementById(id);
      if (cb) cb.checked = contentPrefs[ids[id]];
    });
  }

  function setContentPref(key, on){
    if (!(key in contentPrefs)) return;
    contentPrefs[key] = !!on;
    saveContentPrefs();
    applyContentPrefsUI();
  }

  // ---------------- audio playback (issue #10) ----------------
  // All playback goes through the Reciter engine (audio.js — Alafasy per-ayah on the Islamic
  // Network CDN, per-word on Quran.com's word-by-word set). tap-to-play is a preference: a
  // single-word reveal (word tap / Space / ⎵) plays that word, a whole-ayah reveal (⏭ 1 Ayat
  // or the ayah-number badge) plays the full ayah; Backspace never plays (it hides).
  var AUDIO_PREFS_KEY = "mushafHifzAudioPrefs";
  var RANGE_REPEAT_MAX = 10;

  function loadAudioPrefs(){
    var prefs = { tapPlay: true, syncReveal: false, autoScroll: true, surah: 1, from: 1, to: 7, repeat: 1, speed: 1 };
    try{
      var raw = JSON.parse(localStorage.getItem(AUDIO_PREFS_KEY));
      if (raw && typeof raw === "object"){
        if (typeof raw.tapPlay === "boolean") prefs.tapPlay = raw.tapPlay;
        if (typeof raw.syncReveal === "boolean") prefs.syncReveal = raw.syncReveal;
        if (typeof raw.autoScroll === "boolean") prefs.autoScroll = raw.autoScroll;
        if (Number.isInteger(raw.surah) && raw.surah >= 1 && raw.surah <= 114) prefs.surah = raw.surah;
        if (Number.isInteger(raw.from) && raw.from >= 1) prefs.from = raw.from;
        if (Number.isInteger(raw.to) && raw.to >= 1) prefs.to = raw.to;
        if (Number.isInteger(raw.repeat) && raw.repeat >= 1 && raw.repeat <= RANGE_REPEAT_MAX) prefs.repeat = raw.repeat;
        if (raw.speed >= 0.5 && raw.speed <= 2) prefs.speed = raw.speed;
      }
    } catch(e){ /* storage unavailable — defaults */ }
    return prefs;
  }

  var audioPrefs = loadAudioPrefs();

  function saveAudioPrefs(){
    try{ localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(audioPrefs)); } catch(e){ /* just won't persist */ }
  }

  function applyTapPlayUI(){
    var cb = document.getElementById("tapPlayToggle");
    if (cb) cb.checked = audioPrefs.tapPlay;
  }

  function playWordAtIndex(pageNo, idx){
    // while a range playback is running the element belongs to it — revealing words stays
    // SILENT so the user can test themselves word-by-word alongside the playback
    if (!audioPrefs.tapPlay || Reciter.rangeActive()) return;
    var pair = getPageWordAyahList(pageNo)[idx];
    var ordinal = getPageWordOrdinals(pageNo)[idx];
    if (!pair || !ordinal) return;
    setPlayingAyah(null); // a word tap cuts any running tap-ayah playback — no ayah to light
    Reciter.playWord(pair[0], pair[1], ordinal, null, function(){
      showAudioNotice("Gagal memuat audio kata");
    });
  }

  function playAyahPair(pair){
    if (!audioPrefs.tapPlay || Reciter.rangeActive() || !pair) return;
    setPlayingAyah(pair);
    Reciter.playAyah(pair[0], pair[1], function(){ setPlayingAyah(null); }, function(){
      setPlayingAyah(null);
      showAudioNotice("Gagal memuat audio");
    });
  }

  // ---------- playing-ayah highlight ----------
  // [surah, ayah] of the ayah whose audio is sounding (tap-ayah or range), null when idle.
  // Kept as state because every reveal re-renders the page — applyPlayingHighlight re-lights
  // the spans after each innerHTML swap.
  var playingAyah = null;

  function setPlayingAyah(pair){
    playingAyah = pair;
    applyPlayingHighlight();
    if (pair) beginKaraoke(pair);
    else karaoke = null;
  }

  function applyPlayingHighlight(){
    var container = document.getElementById("mushafPage");
    if (!container) return;
    container.querySelectorAll(".playing").forEach(function(el){ el.classList.remove("playing"); });
    if (!playingAyah) return;
    var surah = playingAyah[0], ayah = playingAyah[1];
    // ayah view: whole-ayat blocks exist in the DOM — light the block itself
    var block = container.querySelector('.ayah-block[data-surah="' + surah + '"][data-ayah="' + ayah + '"]');
    if (block){ block.classList.add("playing"); return; }
    // mushaf view: no per-ayah wrapper, so light every span whose data-idx falls inside the
    // ayah's word range on this page (the list is index-parallel to data-idx)
    var list = getPageWordAyahList(currentPage);
    var lo = -1, hi = -1;
    for (var i = 0; i < list.length; i++){
      if (list[i][0] === surah && list[i][1] === ayah){
        if (lo < 0) lo = i;
        hi = i;
      }
    }
    if (lo < 0) return; // ayah isn't on this page — nothing to light
    container.querySelectorAll(".word, .wgloss, .num, .sajda-tag").forEach(function(el){
      var idx = +el.dataset.idx;
      if (idx >= lo && idx <= hi) el.classList.add("playing");
    });
  }

  // follow-the-recitation: bring a newly-started range ayah into view. With auto-scroll
  // ON it centers on every ayah change (the mobile/zoomed reading-along mode); OFF keeps
  // the original conservative behavior — only when the ayah is off-screen, so the user's
  // own scrolling is never yanked
  function scrollPlayingAyahIntoView(){
    var el = document.querySelector("#mushafPage .playing");
    if (!el) return;
    if (audioPrefs.autoScroll){
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    var r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight){
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  // transient inline notice in the always-visible bar head (the panel itself may be closed)
  var audioNoticeTimer = null;
  function showAudioNotice(msg){
    var title = document.querySelector(".ab-title");
    if (!title) return;
    title.textContent = "⚠ " + msg;
    clearTimeout(audioNoticeTimer);
    audioNoticeTimer = setTimeout(function(){
      title.textContent = "🔊 Mishary Rashid Alafasy";
    }, 4000);
  }

  // ---------- karaoke reveal ("buka kata otomatis mengikuti bacaan") ----------
  // While an ayah plays, its still-hidden words reveal one by one, each as it's recited.
  // Word timings come from the engine's QDC segments cache (audio.js loadTimings — the
  // same data gapless playback seeks by, so one fetch serves both). Ayah playback prefers
  // the surah's GAPLESS file — currentTime then runs in the same absolute timeline as the
  // segments and sync is exact; only on the per-ayah-file fallback are starts shifted by
  // the verse's own timestamp_from (±60ms there, verified). A timings fetch failure just
  // leaves the feature inert (words stay hidden) — never fatal.
  var karaoke = null; // active ayah's reveal state, see beginKaraoke

  function beginKaraoke(pair){
    karaoke = null;
    if (!audioPrefs.syncReveal) return;
    var list = getPageWordAyahList(currentPage);
    var ords = getPageWordOrdinals(currentPage);
    var lo = -1, hi = -1;
    for (var i = 0; i < list.length; i++){
      if (list[i][0] === pair[0] && list[i][1] === pair[1]){ if (lo < 0) lo = i; hi = i; }
    }
    if (lo < 0) return; // playing ayah isn't on the open page — nothing to reveal into

    // mushaf mode renders one API word as several spans (waqf splits share the ordinal),
    // so revealing ordinal o must run the cursor through that ordinal's LAST span
    var ordinalEndIdx = [];
    var maxOrdinal = 0;
    for (var w = lo; w <= hi; w++){
      ordinalEndIdx[ords[w]] = w;
      if (ords[w] > maxOrdinal) maxOrdinal = ords[w];
    }
    // words the cursor already reaches shouldn't replay — start past them
    var cursor = pageCursor[currentPage] || 0;
    var applied = 0;
    for (var o = 1; o <= maxOrdinal; o++){
      if (ordinalEndIdx[o] !== undefined && ordinalEndIdx[o] < cursor) applied = o;
    }

    // group the ayah's spans by ordinal once: ayah view renders ONE span per word entry
    // (whose data-idx is only the entry's FIRST segment), so the tick can't use idx-range
    // checks — it reveals whole ordinal groups instead
    var spansByOrdinal = [];
    document.getElementById("mushafPage").querySelectorAll(".word, .num, .sajda-tag").forEach(function(el){
      var idx = +el.dataset.idx;
      if (idx < lo || idx > hi) return;
      var ord = ords[idx];
      if (!ord) return;
      (spansByOrdinal[ord] = spansByOrdinal[ord] || []).push(el);
    });

    wireKaraokeTick();
    var state = { surah: pair[0], ayah: pair[1], page: currentPage, ordinalEndIdx: ordinalEndIdx, spansByOrdinal: spansByOrdinal, maxOrdinal: maxOrdinal, applied: applied, starts: null };
    karaoke = state;
    Reciter.timings(pair[0]).then(function(timings){
      if (karaoke !== state) return; // playback moved on while fetching
      var vt = timings && timings.verses[pair[1] - 1];
      if (!vt || !vt.segments) return;
      var g = Reciter.playingGapless();
      var absolute = !!(g && g.surah === pair[0]);
      state.starts = vt.segments.map(function(seg){
        return absolute ? seg[1] : seg[1] - vt.timestamp_from;
      });
    });
  }

  var karaokeTickWired = false;
  function wireKaraokeTick(){
    if (karaokeTickWired) return;
    karaokeTickWired = true;
    Reciter._el().addEventListener("timeupdate", function(){
      if (!karaoke || !karaoke.starts) return;
      if (karaoke.page !== currentPage) return; // user flipped the page — these data-idx values belong to another page
      var t = this.currentTime * 1000;
      var target = 0;
      while (target < karaoke.starts.length && karaoke.starts[target] <= t) target++;
      if (target <= karaoke.applied) return;
      var newMax = Math.min(target, karaoke.maxOrdinal);
      var endIdx = karaoke.ordinalEndIdx[newMax];
      if (endIdx === undefined) return;
      var cursor = pageCursor[currentPage] || 0;
      if (cursor >= endIdx + 1){ karaoke.applied = newMax; return; } // the user already revealed past this word
      // reveal IN PLACE, one ordinal group at a time — a full renderPage() per word rebuilt
      // the page's innerHTML and made everything on it (previous ayat's gold wash included)
      // blink on every word
      var lastSpan = null;
      for (var o = karaoke.applied + 1; o <= newMax; o++){
        (karaoke.spansByOrdinal[o] || []).forEach(function(el){
          el.classList.add("revealed");
          if (el.classList.contains("word")) lastSpan = el;
        });
      }
      karaoke.applied = newMax;
      pageCursor[currentPage] = endIdx + 1;
      // auto-scroll line-follow: keep the LINE being recited inside a comfort band
      // (mushaf mode anchors the whole .mushaf-line, ayat mode the word's own box) —
      // scrolling only fires when the recitation leaves the band, not on every word
      if (audioPrefs.autoScroll && lastSpan){
        var anchor = lastSpan.closest(".mushaf-line") || lastSpan.closest(".ayah-word") || lastSpan;
        var ar = anchor.getBoundingClientRect();
        if (ar.top < innerHeight * 0.15 || ar.bottom > innerHeight * 0.85){
          anchor.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
    });
  }

  // ordinal of each page word WITHIN its own ayah (1-indexed, real words only — exactly the
  // numbering the word-audio CDN uses), parallel to getPageWordAyahList. Sourced from the
  // API's own position field: a run's startWord + entry index (mushaf) or the block's
  // startWord + entry index (ayah view). Segments of a waqf-split entry share its ordinal.
  var pageWordOrdinalCache = Object.create(null);

  function getPageWordOrdinals(pageNo){
    if (pageWordOrdinalCache[pageNo]) return pageWordOrdinalCache[pageNo];
    var ords = [];
    if (pageLinesCache[pageNo]){
      pageLinesCache[pageNo].forEach(function(line){
        if (line[0] !== "t") return;
        line[1].forEach(function(run){
          for (var wi = 0; wi < run[3].length; wi++){
            for (var si = 0; si < run[3][wi].split(" ").length; si++) ords.push(run[2] + wi);
          }
        });
      });
    } else if (pageAyahBlocksCache[pageNo]){
      pageAyahBlocksCache[pageNo].forEach(function(block){
        if (block[0] !== "ayah") return;
        // per-segment expansion matching the lines branch (see getPageWordAyahList)
        block[4].forEach(function(pair, wi){
          for (var si = 0; si < pair[0].split(" ").length; si++) ords.push(block[6] + wi);
        });
      });
    }
    if (ords.length) pageWordOrdinalCache[pageNo] = ords;
    return ords;
  }

  function wireAudioBar(){
    var bar = document.getElementById("audioBar");
    document.getElementById("audioBarToggle").addEventListener("click", function(){
      bar.classList.toggle("open");
      // fields follow the current reading position each time the panel is opened (unless a
      // range is already playing — don't yank the controls out from under it)
      if (bar.classList.contains("open") && !Reciter.rangeActive()) syncRangeToReadingPosition();
      syncFixedBarOffsets(); // the expanded panel changes what the reader must pad for
    });
    var cb = document.getElementById("tapPlayToggle");
    cb.addEventListener("change", function(e){
      audioPrefs.tapPlay = e.target.checked;
      saveAudioPrefs();
      if (!audioPrefs.tapPlay){
        Reciter.stop();
        setPlayingAyah(null);
      }
    });
    var sync = document.getElementById("syncRevealToggle");
    sync.checked = audioPrefs.syncReveal;
    sync.addEventListener("change", function(e){
      audioPrefs.syncReveal = e.target.checked;
      saveAudioPrefs();
      if (!audioPrefs.syncReveal) karaoke = null;
      // turning it on mid-playback picks the ayah up from wherever it currently is
      else if (playingAyah) beginKaraoke(playingAyah);
    });
    var scroll = document.getElementById("autoScrollToggle");
    scroll.checked = audioPrefs.autoScroll;
    scroll.addEventListener("change", function(e){
      audioPrefs.autoScroll = e.target.checked;
      saveAudioPrefs();
    });
    applyTapPlayUI();
    wireRangeControls();
  }

  // point the range fields at what's currently open: the ayah under the reveal cursor (or
  // the page's first ayah when nothing is revealed yet) through the last ayah of that same
  // surah on this page — "play what I'm reading", not a stale persisted page
  function syncRangeToReadingPosition(){
    var ayahList = getPageWordAyahList(currentPage);
    if (!ayahList.length) return;
    var cursor = pageCursor[currentPage] || 0;
    var pair = ayahList[Math.min(cursor, ayahList.length - 1)];
    var surah = pair[0], from = pair[1], to = from;
    for (var i = ayahList.length - 1; i >= 0; i--){
      if (ayahList[i][0] === surah){ to = ayahList[i][1]; break; }
    }
    audioPrefs.surah = surah;
    audioPrefs.from = from;
    audioPrefs.to = to;
    saveAudioPrefs();
    refreshRangeControls();
  }

  function rangeStatus(text){
    document.getElementById("rangeStatus").textContent = text;
  }

  // reassigned by wireRangeControls once the controls exist — syncRangeToReadingPosition
  // calls it through this indirection
  var refreshRangeControls = function(){};

  function wireRangeControls(){
    var surahSel = document.getElementById("rangeSurah");
    var fromInput = document.getElementById("rangeFrom");
    var toInput = document.getElementById("rangeTo");
    var repeatSel = document.getElementById("rangeRepeat");
    var speedSel = document.getElementById("rangeSpeed");

    SURAH_META.forEach(function(s){
      var opt = document.createElement("option");
      opt.value = String(s[0]);
      opt.textContent = s[0] + ". " + s[2];
      surahSel.appendChild(opt);
    });
    for (var r = 1; r <= RANGE_REPEAT_MAX; r++){
      repeatSel.appendChild(new Option(String(r), String(r)));
    }
    [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].forEach(function(sp){
      speedSel.appendChild(new Option(String(sp) + "×", String(sp)));
    });

    // clamp helper — from/to must stay within the chosen surah's ayah count, from <= to
    function clampRange(){
      var count = SURAH_META[audioPrefs.surah - 1][5];
      audioPrefs.from = Math.min(Math.max(1, audioPrefs.from), count);
      audioPrefs.to = Math.min(Math.max(audioPrefs.from, audioPrefs.to), count);
      fromInput.max = String(count);
      toInput.max = String(count);
      fromInput.value = String(audioPrefs.from);
      toInput.value = String(audioPrefs.to);
    }

    surahSel.addEventListener("change", function(){
      audioPrefs.surah = parseInt(surahSel.value, 10) || 1;
      // a fresh surah pick means the whole surah, not a clamped leftover from the last one
      audioPrefs.from = 1;
      audioPrefs.to = SURAH_META[audioPrefs.surah - 1][5];
      clampRange();
      saveAudioPrefs();
      // the reader follows the pick — the panel and the page must tell the same story
      // (guarded: never yank the page out from under a running range)
      if (!Reciter.rangeActive()) goToPage(SURAH_META[audioPrefs.surah - 1][6]);
    });
    fromInput.addEventListener("change", function(){
      audioPrefs.from = parseInt(fromInput.value, 10) || 1;
      clampRange();
      saveAudioPrefs();
    });
    toInput.addEventListener("change", function(){
      audioPrefs.to = parseInt(toInput.value, 10) || audioPrefs.from;
      clampRange();
      saveAudioPrefs();
    });
    repeatSel.addEventListener("change", function(){
      audioPrefs.repeat = parseInt(repeatSel.value, 10) || 1;
      saveAudioPrefs();
    });
    speedSel.addEventListener("change", function(){
      audioPrefs.speed = parseFloat(speedSel.value) || 1;
      Reciter.setSpeed(audioPrefs.speed);
      saveAudioPrefs();
    });

    refreshRangeControls = function(){
      surahSel.value = String(audioPrefs.surah);
      repeatSel.value = String(audioPrefs.repeat);
      speedSel.value = String(audioPrefs.speed);
      clampRange();
    };
    refreshRangeControls();
    Reciter.setSpeed(audioPrefs.speed);

    document.getElementById("rangePlay").addEventListener("click", function(){
      // gapless playback can take a second or two before the first sound — an impatient
      // second ▶ used to spawn a fresh queue that re-seeked the shared element to the
      // ayah's start, so the opening audibly played twice. ▶ is idempotent now: running
      // range = no-op, paused range = resume. Stop first to restart.
      if (Reciter.rangeActive()){
        if (Reciter.rangePaused()) Reciter.resumeRange();
        return;
      }
      function start(){
        Reciter.startRange(audioPrefs.surah, audioPrefs.from, audioPrefs.to, audioPrefs.repeat,
          function(ayah, rep){
            setPlayingAyah([audioPrefs.surah, ayah]);
            scrollPlayingAyahIntoView();
            rangeStatus(audioPrefs.surah + ":" + ayah + " · ulangan " + rep + "/" + audioPrefs.repeat);
          },
          function(){
            setPlayingAyah(null);
            rangeStatus("selesai");
          },
          function(){
            setPlayingAyah(null);
            rangeStatus("audio gagal — berhenti");
            showAudioNotice("Gagal memuat audio");
          });
      }
      // a range whose first ayah isn't on the open page would play invisibly (highlight,
      // karaoke and scroll-follow all key off the CURRENT page) — take the reader there
      // first and start once the page data is in, so the very first ayah syncs too
      var startPage = ayahJumpAvailable ? AYAH_PAGE[audioPrefs.surah - 1][audioPrefs.from - 1] : 0;
      if (startPage && startPage !== currentPage){
        goToPage(startPage);
        loadPageLines(startPage).then(function(){ if (currentPage === startPage) start(); });
      } else {
        start();
      }
    });
    document.getElementById("rangePause").addEventListener("click", function(){
      if (Reciter.rangePaused()){ Reciter.resumeRange(); rangeStatus("lanjut…"); }
      else if (Reciter.rangeActive()){ Reciter.pauseRange(); rangeStatus("jeda"); }
    });
    document.getElementById("rangeStop").addEventListener("click", function(){
      Reciter.stopRange();
      setPlayingAyah(null);
      rangeStatus("");
    });
  }

  // ---------------- tajweed markup parsing (data → colored spans) ----------------
  // Only classes we have a color for become spans (see .tj rules in style.css); anything else
  // the API might introduce (custom-*) keeps its text, uncolored.
  var TAJWEED_RULES = {
    ham_wasl:1, slnt:1, laam_shamsiyah:1,
    madda_normal:1, madda_permissible:1, madda_necessary:1,
    madda_obligatory_monfasel:1, madda_obligatory_mottasel:1,
    qalaqah:1, ikhafa:1, ikhafa_shafawi:1, idgham_shafawi:1,
    idgham_ghunnah:1, idgham_wo_ghunnah:1, iqlab:1, ghunnah:1
  };

  function escapeHtml(s){
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Tag syntax as the live API sends it (attribute unquoted); "tajweed" is the tag name the
  // newer documented API uses — accept both so a provider-side rename doesn't strip colors.
  var TAJWEED_TAG = /<(rule|tajweed) class=([\w-]+)>|<\/(rule|tajweed)>/g;

  function tajweedToHtml(str){
    var out = "";
    var stack = []; // emitted class names (null entries = uncolored depth, keeps nesting balanced)
    var pos = 0;
    var m;
    TAJWEED_TAG.lastIndex = 0;
    while ((m = TAJWEED_TAG.exec(str))){
      if (m.index > pos) out += escapeHtml(str.slice(pos, m.index));
      pos = m.index + m[0].length;
      if (m[3]){
        if (stack.length && stack.pop()) out += "</span>";
      } else if (TAJWEED_RULES[m[2]]){
        out += '<span class="tj ' + m[2] + '">';
        stack.push(m[2]);
      } else {
        stack.push(null);
      }
    }
    if (pos < str.length) out += escapeHtml(str.slice(pos));
    while (stack.length){ if (stack.pop()) out += "</span>"; }
    return out;
  }

  // One API word entry can span multiple rendered word segments: a trailing waqf mark is
  // separated by a space in text_uthmani but ZWNJ-joined in the tajweed text. Split the
  // tajweed string at top level (outside tags — the tag syntax itself contains spaces) on
  // spaces/ZWNJ and return per-segment HTML only when the counts line up with the plain
  // segments; null otherwise, so the caller renders the plain text for that entry (a handful
  // of words per page at most, imperceptible).
  function tajweedSegments(tj, segCount){
    if (!tj) return null;
    var parts = [];
    var depth = 0;
    var cur = "";
    for (var i = 0; i < tj.length; i++){
      var ch = tj.charAt(i);
      if (ch === "<"){
        var close = tj.indexOf(">", i);
        if (close === -1) return null; // malformed — let the caller fall back
        var tag = tj.slice(i, close + 1);
        i = close;
        if (/^<(rule|tajweed) class=[\w-]+>$/.test(tag)){
          depth++;
          cur += tag;
        } else if (/^<\/(rule|tajweed)>$/.test(tag)){
          depth = Math.max(0, depth - 1);
          cur += tag;
        }
        // any other tag is dropped — only tajweedToHtml's own whitelisted spans ever enter HTML
        continue;
      }
      if (depth === 0 && (ch === " " || ch === "\u200c")){
        parts.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    parts.push(cur);
    if (parts.length !== segCount) return null;
    return parts.map(tajweedToHtml);
  }

  // ---------------- page data integrity: verse-gap self-heal ----------------
  // The by_page endpoint occasionally drops a verse from a response (see NOTES — the 13-gap
  // scan; GitHub issue #18 was a cached instance of exactly this, missing 69:25 for up to 7
  // days). The lookahead merge only recovers verses that appear in page N+1's list; a verse
  // dropped everywhere is unrecoverable at fetch time and gets cached. So after every load
  // (fresh OR cached), walk the page's verse list in reading order and check it's
  // contiguous: same surah = ayah+1, surah change only from a surah's last ayah to the next
  // surah's ayah 1. The page's FIRST verse is exempt (it may legitimately continue the
  // previous page mid-stream). One forced refetch on a detected gap; if the API itself is
  // currently missing the verse, the retry's response is accepted as-is.
  function versesHaveGap(verses){
    var seen = Object.create(null);
    var list = [];
    verses.forEach(function(v){
      var colon = v.verse_key.indexOf(":");
      var pair = [+v.verse_key.slice(0, colon), +v.verse_key.slice(colon + 1)];
      var key = pair[0] + ":" + pair[1];
      if (!seen[key]){ seen[key] = 1; list.push(pair); }
    });
    list.sort(function(a, b){ return a[0] - b[0] || a[1] - b[1]; });
    for (var i = 1; i < list.length; i++){
      var prev = list[i - 1], cur = list[i];
      if (prev[0] === cur[0]){
        if (cur[1] !== prev[1] + 1) return true;
      } else if (cur[0] !== prev[0] + 1 || cur[1] !== 1 || prev[1] !== SURAH_META[prev[0] - 1][5]){
        return true;
      }
    }
    return false;
  }

  function loadPageWithHeal(pageNo, loader){
    return loader(pageNo).then(function(verses){
      if (!versesHaveGap(verses)) return verses;
      return loader(pageNo, true).catch(function(){ return verses; });
    });
  }

  // ---------------- live page data: fetched from api.quran.com per page, cached ----------------
  // pageNo -> line array (see page-layout.js), populated once a page finishes loading. Every
  // helper below reads from here instead of a bundled global — the whole mushaf isn't in memory
  // at once, only pages actually visited.
  var pageLinesCache = Object.create(null);
  var pageLoadPromises = Object.create(null); // pageNo -> in-flight promise, dedupes concurrent loads

  function loadPageLines(pageNo){
    if (pageLinesCache[pageNo]) return Promise.resolve(pageLinesCache[pageNo]);
    if (pageLoadPromises[pageNo]) return pageLoadPromises[pageNo];
    var promise = loadPageWithHeal(pageNo, QuranApi.loadPage).then(function(verses){
      var lines = PageLayout.buildPageLines(pageNo, verses, SURAH_META);
      pageLinesCache[pageNo] = lines;
      delete pageLoadPromises[pageNo];
      return lines;
    }).catch(function(err){
      delete pageLoadPromises[pageNo];
      throw err;
    });
    pageLoadPromises[pageNo] = promise;
    return promise;
  }

  // Same page, grouped by ayah with translations — for the "ayah" view mode. Shares the same
  // underlying fetch/cache as loadPageLines (both views read the translated response), so
  // switching modes mid-page is instant; only the transform differs.
  var pageAyahBlocksCache = Object.create(null);
  var pageAyahBlockLoadPromises = Object.create(null);

  function loadPageAyahBlocks(pageNo){
    if (pageAyahBlocksCache[pageNo]) return Promise.resolve(pageAyahBlocksCache[pageNo]);
    if (pageAyahBlockLoadPromises[pageNo]) return pageAyahBlockLoadPromises[pageNo];
    var promise = loadPageWithHeal(pageNo, QuranApi.loadPage).then(function(verses){
      var blocks = PageLayout.buildAyahBlocks(pageNo, verses, SURAH_META);
      pageAyahBlocksCache[pageNo] = blocks;
      delete pageAyahBlockLoadPromises[pageNo];
      return blocks;
    }).catch(function(err){
      delete pageAyahBlockLoadPromises[pageNo];
      throw err;
    });
    pageAyahBlockLoadPromises[pageNo] = promise;
    return promise;
  }

  // ---------------- page helpers ----------------
  // Both the mushaf-mode and ayah-mode fetches return the same underlying words for a given
  // page in the same reading order (translations/word_fields are additive — they don't change
  // which verses/words come back or their order), so one reveal cursor works across both view
  // modes and this can source its word list from whichever of the two page caches happens to
  // already be loaded, preferring pageLinesCache since it was the original.
  function getPageWordAyahList(pageNo){
    if (pageWordAyahCache[pageNo]) return pageWordAyahCache[pageNo];
    var list = [];
    if (pageLinesCache[pageNo]){
      pageLinesCache[pageNo].forEach(function(line){
        if (line[0] === "t"){
          line[1].forEach(function(run){
            var surah = run[0], ayah = run[1];
            run[3].forEach(function(wordEntry){
              for (var i = 0; i < wordEntry.split(" ").length; i++) list.push([surah, ayah]);
            });
          });
        }
      });
    } else if (pageAyahBlocksCache[pageNo]){
      pageAyahBlocksCache[pageNo].forEach(function(block){
        if (block[0] !== "ayah") return;
        // per-SEGMENT expansion, exactly like the lines branch above — the two branches
        // must produce IDENTICAL lists: the reveal cursor and data-idx are page-wide and
        // shared across view modes, and a page first loaded in ayah view used to build a
        // shorter (per-entry) list that silently misaligned everything after a mode switch
        block[4].forEach(function(pair){
          for (var i = 0; i < pair[0].split(" ").length; i++) list.push([block[1], block[2]]);
        });
      });
    } else {
      return []; // neither loaded yet — caller should retry after its load resolves
    }
    pageWordAyahCache[pageNo] = list;
    return list;
  }

  function countPageWords(pageNo){
    if (pageWordCountCache[pageNo] !== undefined) return pageWordCountCache[pageNo];
    var total = getPageWordAyahList(pageNo).length;
    if (total) pageWordCountCache[pageNo] = total; // don't cache 0 from a not-yet-loaded page
    return total;
  }

  function pageSurahNumbers(pageNo){
    var linesOnPage = pageLinesCache[pageNo] || [];
    var nums = [];
    linesOnPage.forEach(function(line){
      if (line[0] === "h"){
        if (nums.indexOf(line[1]) === -1) nums.push(line[1]);
      } else if (line[0] === "t"){
        line[1].forEach(function(run){
          if (nums.indexOf(run[0]) === -1) nums.push(run[0]);
        });
      }
    });
    return nums;
  }

  // ---------------- sidebar ----------------
  // transliteration folding — strips separators (incl. alquran.cloud's curly apostrophes,
  // "Al-A’raf"), collapses doubled vowels ("Al-A'raaf" → "alaraf") and merges e→i, o→u
  // ("Yaseen" → "yasin"). Both the dataset string and the query fold, so the aggressive
  // normalization stays symmetric and safe.
  function foldLatin(s){
    return s.toLowerCase().replace(/[\s\-\u2018\u2019']/g, "")
      .replace(/([aeiou])\1+/g, "$1").replace(/e/g, "i").replace(/o/g, "u");
  }

  function renderSidebar(){
    var container = document.getElementById("surahList");
    container.innerHTML = "";
    SURAH_META.forEach(function(s){
      var number = s[0], nameAr = s[1], nameEn = s[2], nameTranslation = s[3], isMeccan = s[4], ayahCount = s[5], firstPage = s[6];
      var item = document.createElement("div");
      item.className = "surah-item";
      item.dataset.number = number;
      item.dataset.search = (number + " " + nameAr + " " + nameEn + " " + nameTranslation).toLowerCase();
      // pre-folded matching form — see foldLatin
      item.dataset.searchAlt = foldLatin(item.dataset.search);
      // folded LATIN NAME ONLY (no number/Arabic prefix) — the exact-match rank below
      // compares against this, since alt still starts with "7سورة…"
      item.dataset.searchName = foldLatin(nameEn);
      item.innerHTML =
        '<div class="surah-num">' + number + '</div>' +
        '<div class="surah-info">' +
          '<div class="name-ar">' + nameAr + '</div>' +
          '<div class="name-lat">' +
            '<span>' + nameEn + '</span>' +
            '<span class="badge">' + (isMeccan ? "Makkiyah" : "Madaniyah") + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="surah-go" type="button" title="Langsung ke ayat 1">Go</button>';
      item.addEventListener("click", function(){
        // a row tap only PINS the ayah-jump target — navigation is Go (ayat 1) or ➔ (typed
        // ayat), so the sidebar stays open for the ayat to be chosen
        ayahJumpPinned = number;
        refreshAyahJumpTarget();
      });
      // Go = straight to ayat 1 with the full jump treatment (reveal-through + scroll +
      // flash)
      item.querySelector(".surah-go").addEventListener("click", function(ev){
        ev.stopPropagation();
        ayahJumpPinned = null;
        goToAyah(number, 1, firstPage);
        if (isOverlaySidebarMode()) shell.classList.add("collapsed");
      });
      container.appendChild(item);
    });
  }

  document.getElementById("surahSearch").addEventListener("input", function(e){
    var q = e.target.value.trim().toLowerCase();
    var qFold = foldLatin(q);
    // trailing-letter variants — the dataset's "al-baqara"/"al-kahf"-style names vs the
    // "baqarah"/"kahfi" spellings users actually type
    var variants = [qFold];
    if (/[hi]$/.test(qFold) && qFold.length > 2) variants.push(qFold.slice(0, -1));
    var hits = [], exacts = [];
    document.querySelectorAll(".surah-item").forEach(function(el){
      var alt = el.dataset.searchAlt;
      var hit = el.dataset.search.indexOf(q) !== -1 ||
        (qFold && alt.indexOf(qFold) !== -1) ||
        variants.slice(1).some(function(v){ return alt.indexOf(v) !== -1; });
      if (!hit){ el.style.display = "none"; return; }
      hits.push(el);
      // "annas" must land on An-Nas, not the substring-earlier An-Nasr — an exact folded
      // name match outranks substring ones whenever any exist
      if (variants.indexOf(el.dataset.searchName) !== -1) exacts.push(el);
    });
    var winners = exacts.length ? exacts : hits;
    document.querySelectorAll(".surah-item").forEach(function(el){ el.style.display = "none"; });
    winners.forEach(function(el){ el.style.display = "flex"; });
    ayahJumpPinned = null; // typing re-filters — the pin gives way to the match again
    refreshAyahJumpTarget();
  });

  // ---------------- jump to a specific ayah (the sidebar's "Ayat ke-" row) ----------------
  // The jump target is the FIRST surah surviving the search filter (so "baqara" + 100
  // = Al-Baqarah:100); with an empty search it's the surah open on the current page (the
  // .active list item — works in both view modes, unlike the page caches). A filter that
  // matches nothing deliberately yields NO target: silently retargeting to the active
  // surah would jump somewhere the user didn't ask for. The static AYAH_PAGE table
  // (ayah-page.js, generated by build/build_ayah_page.js) resolves surah:ayah → page; the
  // jump itself follows goToBookmark's reveal-through semantics and adds a scroll-to +
  // brief gold flash on the target ayah.
  var ayahJumpAvailable = typeof AYAH_PAGE !== "undefined";
  if (!ayahJumpAvailable) document.getElementById("ayahJumpRow").style.display = "none";
  var ayahJumpPinned = null; // surah picked by tapping its row — overrides filter/active

  function ayahJumpTargetSurah(){
    if (ayahJumpPinned) return ayahJumpPinned;
    // empty search → the surah open on the page (not "first list item": an unfiltered
    // list always starts at Al-Fatihah, which made the label show 1. Al-Faatihah while
    // reading Al-A'raaf — exactly the stale-target report)
    var q = document.getElementById("surahSearch").value.trim();
    if (!q){
      var active = document.querySelector(".surah-item.active");
      return active ? +active.dataset.number : null;
    }
    var first = null;
    document.querySelectorAll(".surah-item").forEach(function(el){
      if (el.style.display !== "none" && first === null) first = +el.dataset.number;
    });
    return first; // null when the filter matches nothing — no silent wrong target
  }

  function refreshAyahJumpTarget(){
    if (!ayahJumpAvailable) return;
    var s = ayahJumpTargetSurah();
    document.getElementById("ayahJumpTarget").textContent =
      s ? SURAH_META[s - 1][0] + ". " + SURAH_META[s - 1][2] : "";
  }

  function jumpToTypedAyah(){
    if (!ayahJumpAvailable) return;
    var s = ayahJumpTargetSurah();
    var a = parseInt(document.getElementById("ayahJumpInput").value, 10);
    if (!s || !a || a < 1) return;
    if (a > SURAH_META[s - 1][5]) a = SURAH_META[s - 1][5]; // clamp to the surah's last ayah
    ayahJumpPinned = null; // the jump consumed the pin
    goToAyah(s, a, AYAH_PAGE[s - 1][a - 1]);
  }

  document.getElementById("ayahJumpBtn").addEventListener("click", jumpToTypedAyah);
  document.getElementById("ayahJumpInput").addEventListener("keydown", function(e){
    if (e.key === "Enter") jumpToTypedAyah();
  });

  function goToAyah(surah, ayah, page){
    goToPage(page);
    loadPageLines(page).then(function(){
      if (currentPage !== page) return; // user navigated elsewhere before this resolved
      var ayahList = getPageWordAyahList(page);
      var lastIdx = -1;
      for (var i = 0; i < ayahList.length; i++){
        if (ayahList[i][0] === surah && ayahList[i][1] === ayah) lastIdx = i;
      }
      if (lastIdx === -1) return;
      pageCursor[page] = lastIdx + 1;
      renderPage(page, true);
      flashAyah(surah, ayah);
    });
    if (isOverlaySidebarMode()) shell.classList.add("collapsed");
  }

  // gold wash on the target ayah's spans (mushaf mode) or block (ayah mode) + center it —
  // same span-finding logic as applyPlayingHighlight
  function flashAyah(surah, ayah){
    var container = document.getElementById("mushafPage");
    var block = container.querySelector('.ayah-block[data-surah="' + surah + '"][data-ayah="' + ayah + '"]');
    var first = null;
    if (block){
      block.classList.add("flash");
      first = block;
    } else {
      var list = getPageWordAyahList(currentPage);
      var lo = -1, hi = -1;
      for (var i = 0; i < list.length; i++){
        if (list[i][0] === surah && list[i][1] === ayah){ if (lo < 0) lo = i; hi = i; }
      }
      container.querySelectorAll(".word, .num, .sajda-tag").forEach(function(el){
        var idx = +el.dataset.idx;
        if (idx >= lo && idx <= hi){ el.classList.add("flash"); if (!first) first = el; }
      });
    }
    if (first) first.scrollIntoView({ block: "center" });
    setTimeout(function(){
      container.querySelectorAll(".flash").forEach(function(el){ el.classList.remove("flash"); });
    }, 1600);
  }

  function highlightActiveSurah(surahNumber){
    document.querySelectorAll(".surah-item").forEach(function(el){
      el.classList.toggle("active", +el.dataset.number === surahNumber);
    });
    refreshAyahJumpTarget(); // empty-search target follows the open page
  }

  // ---------------- sidebar tabs (Surah / Markah) ----------------
  document.getElementById("tabSurah").addEventListener("click", function(){ switchSidebarTab("surah"); });
  document.getElementById("tabBookmarks").addEventListener("click", function(){ switchSidebarTab("bookmarks"); });

  function switchSidebarTab(tab){
    var isSurah = tab === "surah";
    document.getElementById("tabSurah").classList.toggle("active", isSurah);
    document.getElementById("tabBookmarks").classList.toggle("active", !isSurah);
    document.getElementById("surahSearch").style.display = isSurah ? "" : "none";
    document.getElementById("ayahJumpRow").style.display =
      isSurah && ayahJumpAvailable ? "" : "none";
    document.getElementById("surahList").style.display = isSurah ? "" : "none";
    document.getElementById("bookmarkList").style.display = isSurah ? "none" : "block";
  }

  // ---------------- bookmarks — per-ayah, saved to this device/browser only, via localStorage ----------------
  var BOOKMARKS_KEY = "mushafHifzBookmarks";

  function loadBookmarks(){
    try{
      var arr = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
      if (!Array.isArray(arr)) return [];
      return arr.filter(function(b){
        return b && Number.isInteger(b.surah) && Number.isInteger(b.ayah) && Number.isInteger(b.page) &&
          b.surah >= 1 && b.surah <= 114 && b.page >= 1 && b.page <= TOTAL_PAGES;
      });
    } catch(e){
      return [];
    }
  }

  function saveBookmarks(){
    try{ localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks)); } catch(e){ /* storage unavailable (private mode/full) — bookmark just won't persist */ }
  }

  var bookmarks = loadBookmarks();

  function findBookmarkIndex(surah, ayah){
    for (var i = 0; i < bookmarks.length; i++){
      if (bookmarks[i].surah === surah && bookmarks[i].ayah === ayah) return i;
    }
    return -1;
  }

  function isBookmarked(surah, ayah){ return findBookmarkIndex(surah, ayah) !== -1; }

  function toggleBookmark(surah, ayah, page){
    var idx = findBookmarkIndex(surah, ayah);
    if (idx === -1) bookmarks.push({ surah: surah, ayah: ayah, page: page });
    else bookmarks.splice(idx, 1);
    bookmarks.sort(function(a, b){ return a.surah - b.surah || a.ayah - b.ayah; });
    saveBookmarks();
    renderBookmarkList();
  }

  // jump to a bookmarked ayah and reveal the page up through it (not hidden/blurred) —
  // same linear reveal-cursor the rest of the app uses, just pre-positioned past this ayah.
  function goToBookmark(bm){
    goToPage(bm.page);
    loadPageLines(bm.page).then(function(){
      if (currentPage !== bm.page) return; // user navigated elsewhere before this resolved
      var ayahList = getPageWordAyahList(bm.page);
      var lastIdx = -1;
      for (var i = 0; i < ayahList.length; i++){
        if (ayahList[i][0] === bm.surah && ayahList[i][1] === bm.ayah) lastIdx = i;
      }
      if (lastIdx !== -1){
        pageCursor[bm.page] = lastIdx + 1;
        renderPage(bm.page, true);
      }
    });
    if (window.innerWidth <= 760) shell.classList.add("collapsed");
  }

  function renderBookmarkList(){
    var countEl = document.getElementById("bookmarkCount");
    if (countEl) countEl.textContent = bookmarks.length ? bookmarks.length : "";
    var container = document.getElementById("bookmarkList");
    if (!container) return;
    if (!bookmarks.length){
      container.innerHTML = '<div class="bookmark-empty">Belum ada ayat ditandai.<br>Tahan sebuah kata untuk menandai ayatnya.</div>';
      return;
    }
    container.innerHTML = "";
    bookmarks.forEach(function(bm){
      var surahName = SURAH_META[bm.surah - 1][1];
      var item = document.createElement("div");
      item.className = "bookmark-item";
      item.innerHTML =
        '<div class="bm-ayah">' + bm.ayah + '</div>' +
        '<div class="bm-info">' +
          '<div class="bm-surah">' + surahName + '</div>' +
          '<div class="bm-meta">Ayat ' + bm.ayah + ' · Halaman ' + bm.page + '</div>' +
        '</div>' +
        '<button class="bm-remove" type="button" title="Hapus markah">✕</button>';
      item.addEventListener("click", function(e){
        if (e.target.closest(".bm-remove")) return;
        goToBookmark(bm);
      });
      item.querySelector(".bm-remove").addEventListener("click", function(e){
        e.stopPropagation();
        toggleBookmark(bm.surah, bm.ayah, bm.page);
      });
      container.appendChild(item);
    });
  }

  // ---------------- long-press a word/ayah to bookmark the page ----------------
  var LONG_PRESS_MS = 500;
  var LONG_PRESS_MOVE_TOLERANCE = 10; // px — cancel if the finger drifts (scrolling instead)
  var suppressNextWordClick = false; // set once a long-press fires, so the trailing click doesn't also reveal the word
  var bookmarkPopupEl = null;

  function ensureBookmarkPopup(){
    if (bookmarkPopupEl) return bookmarkPopupEl;
    bookmarkPopupEl = document.createElement("div");
    bookmarkPopupEl.className = "bookmark-popup";
    var btn = document.createElement("button");
    btn.type = "button";
    bookmarkPopupEl.appendChild(btn);
    document.body.appendChild(bookmarkPopupEl);
    btn.addEventListener("click", function(){
      var target = bookmarkPopupEl.__target;
      if (target) toggleBookmark(target.surah, target.ayah, currentPage);
      hideBookmarkPopup();
    });
    document.addEventListener("pointerdown", function(e){
      if (bookmarkPopupEl.classList.contains("open") && !bookmarkPopupEl.contains(e.target)) hideBookmarkPopup();
    });
    window.addEventListener("scroll", hideBookmarkPopup, true);
    return bookmarkPopupEl;
  }

  function hideBookmarkPopup(){
    if (bookmarkPopupEl) bookmarkPopupEl.classList.remove("open");
  }

  function showBookmarkPopup(x, y, surah, ayah){
    var popup = ensureBookmarkPopup();
    popup.__target = { surah: surah, ayah: ayah };
    var btn = popup.querySelector("button");
    btn.textContent = isBookmarked(surah, ayah) ? "🔖 Hapus markah ayat ini" : "🔖 Tandai ayat ini";
    popup.classList.add("open");
    popup.style.left = "0px";
    popup.style.top = "0px";
    var rect = popup.getBoundingClientRect();
    var left = Math.min(Math.max(8, x - rect.width / 2), window.innerWidth - rect.width - 8);
    var top = Math.min(Math.max(8, y - rect.height - 14), window.innerHeight - rect.height - 8);
    popup.style.left = left + "px";
    popup.style.top = top + "px";
  }

  // fixedAyahPair lets a caller that already knows which [surah,ayah] an element belongs to
  // (the ayah-mode view — see renderAyahPageContent) skip the data-idx lookup below, which
  // only resolves against pageWordAyahCache/pageLinesCache (the mushaf-mode line layout).
  function wireLongPressBookmark(el, fixedAyahPair){
    var timer = null;
    var startX = 0, startY = 0;

    function cancel(){
      clearTimeout(timer);
      timer = null;
    }

    el.addEventListener("pointerdown", function(e){
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      cancel();
      timer = setTimeout(function(){
        timer = null;
        suppressNextWordClick = true;
        var ayahPair = fixedAyahPair || getPageWordAyahList(currentPage)[+el.dataset.idx];
        if (ayahPair) showBookmarkPopup(startX, startY, ayahPair[0], ayahPair[1]);
      }, LONG_PRESS_MS);
    });
    el.addEventListener("pointermove", function(e){
      if (!timer) return;
      if (Math.abs(e.clientX - startX) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(e.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE) cancel();
    });
    el.addEventListener("pointerup", cancel);
    el.addEventListener("pointerleave", cancel);
    el.addEventListener("pointercancel", cancel);
  }

  // ---------------- reader shell ----------------
  var readerScroll = null; // the element that actually scrolls (set in buildReaderShell)

  function buildReaderShell(){
    // .reveal-controls is a sibling of .reader-scroll (position:fixed, see style.css) so it
    // stays put while .reader-scroll scrolls/zooms/pans underneath it. All other controls
    // (view mode, content toggles, sizes, hint words) live in the right settings panel.
    reader.innerHTML =
      '<div class="reader-scroll" id="readerScroll">' +
        '<div class="mushaf-page" id="mushafPage"></div>' +
      '</div>' +
      '<div class="reveal-controls">' +
        '<button id="nextPage"><span class="btn-label">Berikutnya ›</span></button>' +
        '<button id="revealAll" class="minor" title="Tampilkan semua">👁</button>' +
        '<button id="ayahBtn" class="step">⏭ 1 Ayat</button>' +
        '<button id="spaceBtn" class="step">⎵ Lanjut</button>' +
        '<button id="backspaceBtn" class="step">⌫ Balik</button>' +
        '<button id="hideAll" class="minor" title="Sembunyikan semua">↺</button>' +
        '<button id="prevPage"><span class="btn-label">‹ Sebelumnya</span></button>' +
      '</div>';
    readerScroll = document.getElementById("readerScroll");
    mushafPageEl = document.getElementById("mushafPage");
    wirePinchZoom(readerScroll);
    wireSwipeNavigation(readerScroll);

    document.getElementById("revealAll").addEventListener("click", function(){
      pageCursor[currentPage] = countPageWords(currentPage);
      renderPage(currentPage, true);
    });
    document.getElementById("hideAll").addEventListener("click", function(){
      pageCursor[currentPage] = 0;
      renderPage(currentPage, true);
    });
    document.getElementById("spaceBtn").addEventListener("click", function(){ moveCursor(1); });
    document.getElementById("backspaceBtn").addEventListener("click", function(){ moveCursor(-1); });
    document.getElementById("ayahBtn").addEventListener("click", revealNextAyah);
    document.getElementById("prevPage").addEventListener("click", function(){ goToPage(currentPage - 1); });
    document.getElementById("nextPage").addEventListener("click", function(){ goToPage(currentPage + 1); });

    syncFixedBarOffsets();
  }

  // ---------------- settings panel (right edge) ----------------
  function wireSettingsPanel(){
    document.getElementById("viewByMushaf").addEventListener("click", function(){ setViewMode("mushaf"); });
    document.getElementById("viewByAyat").addEventListener("click", function(){ setViewMode("ayah"); });

    document.getElementById("contentArabic").addEventListener("change", function(e){ setContentPref("arabic", e.target.checked); });
    document.getElementById("contentTranslation").addEventListener("change", function(e){ setContentPref("translation", e.target.checked); });
    document.getElementById("contentWordGloss").addEventListener("change", function(e){ setContentPref("wordGloss", e.target.checked); });
    document.getElementById("contentTajweed").addEventListener("change", function(e){ setContentPref("tajweed", e.target.checked); });

    document.getElementById("arabicSizeSlider").addEventListener("input", function(e){
      setAyahFontScale(parseFloat(e.target.value));
    });
    document.getElementById("translationSizeSlider").addEventListener("input", function(e){
      setTranslationFontScale(parseFloat(e.target.value));
    });

    var hintWordSelect = document.getElementById("hintWordSelect");
    hintWordSelect.value = String(hintWordCount);
    hintWordSelect.addEventListener("change", function(){
      setHintWordCount(parseInt(hintWordSelect.value, 10) || 0);
    });

    var settingsPanel = document.getElementById("settingsPanel");
    document.getElementById("toggleSettings").addEventListener("click", function(){
      settingsPanel.classList.toggle("open");
    });
    document.getElementById("settingsClose").addEventListener("click", function(){
      settingsPanel.classList.remove("open");
    });

    applyViewModeUI();
    applyAyahFontScale();
    applyTranslationFontScale();
    applyContentPrefsUI();
  }

  // Measures the actual rendered height of the app header and the fixed footer bar, and
  // publishes them as CSS vars so .reader-scroll can pad itself by exactly that much (see
  // style.css) — heights vary by breakpoint, so this is measured rather than hardcoded. The
  // +buffer is breathing room between the fixed bar and the page content.
  function syncFixedBarOffsets(){
    var headerEl = document.querySelector("header.topbar");
    var footerEl = document.querySelector(".reveal-controls");
    var audioBarEl = document.querySelector(".audio-bar");
    if (!headerEl || !footerEl) return;
    document.documentElement.style.setProperty("--header-h", headerEl.offsetHeight + "px");
    // the audio bar docks flush on top of the reveal footer (its own height excluded), while
    // the reader's bottom padding must clear BOTH bars plus breathing room
    document.documentElement.style.setProperty("--reveal-h", footerEl.offsetHeight + "px");
    var bottomH = footerEl.offsetHeight + (audioBarEl ? audioBarEl.offsetHeight : 0);
    document.documentElement.style.setProperty("--footer-h", (bottomH + 16) + "px");
  }

  function moveCursor(delta){
    var total = countPageWords(currentPage);
    var cur = pageCursor[currentPage] || 0;
    var next = cur + delta;
    if (next > total){
      advanceToNextPage();
      return;
    }
    if (next < 0){
      retreatToPreviousPage();
      return;
    }
    if (next === cur) return;
    pageCursor[currentPage] = next;
    if (delta > 0) playWordAtIndex(currentPage, next - 1); // revealing a word aloud
    renderPage(currentPage, true);
  }

  // "Lanjut" past the last word of a page lands on the next page with its first word already
  // revealed — advancing by one word always means exactly that, never a dead click that just
  // changes page with nothing revealed.
  function advanceToNextPage(){
    if (currentPage >= TOTAL_PAGES) return;
    var target = currentPage + 1;
    goToPage(target);
    loadPageLines(target).then(function(){
      if (currentPage !== target) return; // user navigated elsewhere before this resolved
      pageCursor[target] = Math.min(1, countPageWords(target));
      renderPage(target, true);
    });
  }

  // "Balik" before the first word of a page lands on the previous page fully revealed except
  // its last word — mirrors advanceToNextPage so retreating by one word is symmetric.
  function retreatToPreviousPage(){
    if (currentPage <= 1) return;
    var target = currentPage - 1;
    goToPage(target);
    loadPageLines(target).then(function(){
      if (currentPage !== target) return;
      pageCursor[target] = Math.max(0, countPageWords(target) - 1);
      renderPage(target, true);
    });
  }

  // reveal the rest of whichever ayah comes next, in one go, instead of one word at a time
  function revealNextAyah(){
    var total = countPageWords(currentPage);
    var cur = pageCursor[currentPage] || 0;
    if (cur >= total){
      advanceToNextPageRevealFirstAyah();
      return;
    }
    var ayahList = getPageWordAyahList(currentPage);
    var targetSurah = ayahList[cur][0], targetAyah = ayahList[cur][1];
    var next = cur;
    while (next < total && ayahList[next][0] === targetSurah && ayahList[next][1] === targetAyah){
      next++;
    }
    pageCursor[currentPage] = next;
    playAyahPair([targetSurah, targetAyah]); // whole-ayah reveal plays the whole ayah
    renderPage(currentPage, true);
  }

  function advanceToNextPageRevealFirstAyah(){
    if (currentPage >= TOTAL_PAGES) return;
    var target = currentPage + 1;
    goToPage(target);
    loadPageLines(target).then(function(){
      if (currentPage !== target) return;
      pageCursor[target] = 0;
      revealNextAyah(); // currentPage is now target — reveals its first ayah
    });
  }

  // ---------------- page rendering ----------------
  // Entry point — synchronous fast path if the page is already loaded (e.g. re-rendering the
  // same page after a reveal-cursor change), otherwise shows a loading state and renders once
  // the fetch (or cache read) resolves. currentPage is set immediately either way, so a stale
  // response for a page the user has since navigated away from is detected and dropped.
  function pageLoadingHTML(){
    return '<div class="page-loading"><div class="ar">جَارٍ التَحْمِيل…</div><span>Memuat halaman…</span></div>';
  }

  function showPageLoadError(pageNo){
    document.getElementById("mushafPage").innerHTML =
      '<div class="page-loading">' +
        '<div>Gagal memuat halaman. Cek koneksi internet.</div>' +
        '<button id="retryPageLoad" type="button">Coba lagi</button>' +
      '</div>';
    document.getElementById("retryPageLoad").addEventListener("click", function(){ renderPage(pageNo, true); });
  }

  function renderPage(pageNo, skipScrollReset){
    if (pageNo < 1 || pageNo > TOTAL_PAGES) return;
    currentPage = pageNo;
    var mode = viewMode;

    if (mode === "ayah"){
      var cachedBlocks = pageAyahBlocksCache[pageNo];
      if (cachedBlocks){
        renderAyahPageContent(pageNo, cachedBlocks, skipScrollReset);
        return;
      }
      document.getElementById("mushafPage").innerHTML = pageLoadingHTML();
      loadPageAyahBlocks(pageNo).then(function(blocks){
        if (currentPage !== pageNo || viewMode !== mode) return; // stale: navigated or switched mode before this resolved
        renderAyahPageContent(pageNo, blocks, skipScrollReset);
      }).catch(function(err){
        console.error(err);
        if (currentPage !== pageNo || viewMode !== mode) return;
        showPageLoadError(pageNo);
      });
      return;
    }

    var cached = pageLinesCache[pageNo];
    if (cached){
      renderPageContent(pageNo, cached, skipScrollReset);
      return;
    }

    document.getElementById("mushafPage").innerHTML = pageLoadingHTML();
    loadPageLines(pageNo).then(function(lines){
      if (currentPage !== pageNo || viewMode !== mode) return;
      renderPageContent(pageNo, lines, skipScrollReset);
    }).catch(function(err){
      console.error(err);
      if (currentPage !== pageNo || viewMode !== mode) return;
      showPageLoadError(pageNo);
    });
  }

  function renderPageContent(pageNo, linesOnPage, skipScrollReset){
    var container = document.getElementById("mushafPage");
    var cursor = pageCursor[pageNo] || 0;
    var wordIndex = 0;
    var html = '<div class="ayat-flow">';

    linesOnPage.forEach(function(line){
      if (line[0] === "h"){
        var surahNumber = line[1], title = line[2];
        var meta = SURAH_META[surahNumber - 1];
        html += '<div class="surah-banner">' +
          '<div class="name">' + title + '</div>' +
          '<div class="name-lat">' + meta[2] + '</div>' +
          '<div class="meta">' +
            '<span class="badge">' + (meta[4] ? "Makkiyah" : "Madaniyah") + '</span>' +
            ' &nbsp;•&nbsp; ' + meta[5] + ' ayat' +
          '</div>' +
        '</div>';
      } else if (line[0] === "b"){
        html += '<div class="basmalah">' + BASMALAH + '</div>';
      } else { // "t" — a real mushaf line
        html += '<div class="mushaf-line">';
        line[1].forEach(function(run){
          var surah = run[0], ayah = run[1], startWord = run[2], wordEntries = run[3], endsAyah = run[4], isSajdaAyah = run[5], tajweedEntries = run[6], glossEntries = run[7];
          for (var wi = 0; wi < wordEntries.length; wi++){
            var segs = wordEntries[wi].split(" ");
            var tjParts = tajweedSegments(tajweedEntries ? tajweedEntries[wi] : null, segs.length);
            var gloss = glossEntries ? glossEntries[wi] : null;
            for (var si = 0; si < segs.length; si++){
              var isLastOfAyah = endsAyah && wi === wordEntries.length - 1 && si === segs.length - 1;
              var isHintWord = hintWordCount > 0 && (startWord + wi) <= hintWordCount;
              var revealed = wordIndex < cursor || isHintWord;
              // each word is a two-row cell: the Arabic (blurred/revealed by the cursor) over
              // its Indonesian gloss (always visible — a study aid, never tested — see
              // body.hide-word-gloss in style.css for the toggle)
              html += '<span class="word-cell">' +
                '<span class="word' + (revealed ? " revealed" : "") + (isHintWord ? " hint" : "") + '" data-idx="' + wordIndex + '">' + (tjParts ? tjParts[si] : segs[si]) + '</span>' +
                (gloss && si === 0 ? '<span class="wgloss" data-idx="' + wordIndex + '">' + escapeHtml(gloss) + '</span>' : "") +
              '</span>';
              if (isLastOfAyah){
                // Independent of the word span above (CSS filter can't be un-blurred by a
                // descendant, so this has to be a sibling, not nested inside it): with hint
                // words on, show which ayah is coming even before the reveal cursor reaches its
                // last word, not just the hinted first few words with no way to tell which ayah
                // they belong to. data-idx matches the last word so tapping the number still
                // advances the cursor the same as tapping the word.
                var numRevealed = wordIndex < cursor || hintWordCount > 0;
                html += '<span class="num' + (numRevealed ? " revealed" : "") + '" data-idx="' + wordIndex + '">' + toArabicDigits(ayah) + '</span>';
                if (isSajdaAyah) html += '<span class="sajda-tag' + (numRevealed ? " revealed" : "") + '" data-idx="' + wordIndex + '">سجدة</span>';
              }
              html += ' ';
              wordIndex++;
            }
          }
        });
        html += '</div>';
      }
    });

    html += '</div><div class="page-number">— ' + toArabicDigits(pageNo) + ' —</div>';
    container.innerHTML = html;

    container.querySelectorAll(".word, .wgloss, .num, .sajda-tag").forEach(function(el){
      el.addEventListener("click", function(){
        if (suppressNextWordClick){ suppressNextWordClick = false; return; }
        var idx = +el.dataset.idx;
        pageCursor[currentPage] = idx + 1;
        if (el.classList.contains("word") || el.classList.contains("wgloss")) playWordAtIndex(currentPage, idx);
        else playAyahPair(getPageWordAyahList(currentPage)[idx]); // num/sajda = whole-ayah reveal
        renderPage(currentPage, true);
      });
      if (el.classList.contains("word")) wireLongPressBookmark(el);
    });

    document.getElementById("pageInput").value = pageNo;
    document.getElementById("prevPage").disabled = pageNo <= 1;
    document.getElementById("nextPage").disabled = pageNo >= TOTAL_PAGES;

    var surahsOnPage = pageSurahNumbers(pageNo);
    if (surahsOnPage.length) highlightActiveSurah(surahsOnPage[0]);

    updateStatus(surahsOnPage);
    fitLinesToWidth();
    applyPlayingHighlight(); // innerHTML swap above wiped the .playing spans
    if (!skipScrollReset){
      resetPageZoom();
      if (readerScroll) readerScroll.scrollTop = 0;
    }
  }

  // "ayah" view mode — word-by-word + full-ayah Indonesian translation, continuous reading
  // order (no mushaf line_number layout). The same reveal cursor/hint words from mushaf mode
  // still hide/reveal the Arabic here (word-for-word, same page-wide index — both fetches
  // return words in the same order, see getPageWordAyahList) so memorization testing still
  // works; the translations stay visible throughout as a study aid rather than also hiding,
  // which is the whole point of this view. Only pinch-zoom stays mushaf-only (see setViewMode).
  function renderAyahPageContent(pageNo, blocks, skipScrollReset){
    var container = document.getElementById("mushafPage");
    var cursor = pageCursor[pageNo] || 0;
    var wordIndex = 0;
    var html = '<div class="ayah-flow">';
    var surahsOnPage = [];

    function noteSurah(n){ if (surahsOnPage.indexOf(n) === -1) surahsOnPage.push(n); }

    blocks.forEach(function(block){
      if (block[0] === "h"){
        var surahNumber = block[1], title = block[2];
        var meta = SURAH_META[surahNumber - 1];
        noteSurah(surahNumber);
        html += '<div class="surah-banner">' +
          '<div class="name">' + title + '</div>' +
          '<div class="name-lat">' + meta[2] + '</div>' +
          '<div class="meta">' +
            '<span class="badge">' + (meta[4] ? "Makkiyah" : "Madaniyah") + '</span>' +
            ' &nbsp;•&nbsp; ' + meta[5] + ' ayat' +
          '</div>' +
        '</div>';
      } else if (block[0] === "b"){
        html += '<div class="basmalah">' + BASMALAH + '</div>';
      } else { // "ayah"
        var surah = block[1], ayah = block[2], isSajdaAyah = block[3], words = block[4], ayahTranslation = block[5], startWord = block[6];
        noteSurah(surah);
        html += '<div class="ayah-block" data-surah="' + surah + '" data-ayah="' + ayah + '"><div class="ayah-words">';
        words.forEach(function(pair, wi){
          var isHintWord = hintWordCount > 0 && (startWord + wi) <= hintWordCount;
          var revealed = wordIndex < cursor || isHintWord;
          // whole-entry tajweed here (one span per word entry in this view — no per-segment
          // alignment needed, unlike mushaf mode's space-split rendering). data-idx still
          // advances per SEGMENT though (waqf-split entries count multiple), so the shared
          // page-wide cursor/word lists line up exactly with mushaf mode's numbering
          var arHtml = pair[2] ? tajweedToHtml(pair[2]) : pair[0];
          html += '<div class="ayah-word">' +
            '<span class="word aw-ar' + (revealed ? " revealed" : "") + (isHintWord ? " hint" : "") + '" data-idx="' + wordIndex + '">' + arHtml + '</span>' +
            (pair[1] ? '<span class="aw-gloss">' + pair[1] + '</span>' : "") +
          '</div>';
          wordIndex += pair[0].split(" ").length;
        });
        var numRevealed = wordIndex - 1 < cursor || hintWordCount > 0;
        html += '<span class="num' + (numRevealed ? " revealed" : "") + '" data-idx="' + (wordIndex - 1) + '">' + toArabicDigits(ayah) + '</span>' +
          (isSajdaAyah ? '<span class="sajda-tag' + (numRevealed ? " revealed" : "") + '" data-idx="' + (wordIndex - 1) + '">سجدة</span>' : "") +
        '</div>' +
        (ayahTranslation ? '<div class="ayah-translation">' + ayahTranslation + '</div>' : "") +
        '</div>';
      }
    });

    html += '</div><div class="page-number">— ' + toArabicDigits(pageNo) + ' —</div>';
    container.innerHTML = html;

    container.querySelectorAll(".word, .num, .sajda-tag").forEach(function(el){
      el.addEventListener("click", function(){
        if (suppressNextWordClick){ suppressNextWordClick = false; return; }
        var idx = +el.dataset.idx;
        pageCursor[currentPage] = idx + 1;
        if (el.classList.contains("word")) playWordAtIndex(currentPage, idx);
        else playAyahPair(getPageWordAyahList(currentPage)[idx]);
        renderPage(currentPage, true);
      });
    });
    container.querySelectorAll(".ayah-block").forEach(function(block){
      var ayahPair = [+block.dataset.surah, +block.dataset.ayah];
      block.querySelectorAll(".ayah-word").forEach(function(wordEl){
        wireLongPressBookmark(wordEl, ayahPair);
      });
    });

    document.getElementById("pageInput").value = pageNo;
    document.getElementById("prevPage").disabled = pageNo <= 1;
    document.getElementById("nextPage").disabled = pageNo >= TOTAL_PAGES;

    if (surahsOnPage.length) highlightActiveSurah(surahsOnPage[0]);
    updateStatus(surahsOnPage);
    applyPlayingHighlight(); // same innerHTML-swap wipe as mushaf mode above
    if (!skipScrollReset){
      resetPageZoom();
      if (readerScroll) readerScroll.scrollTop = 0;
    }
  }

  function updateStatus(surahsOnPage){
    var html = (surahsOnPage || pageSurahNumbers(currentPage)).map(function(n){
      var m = SURAH_META[n - 1];
      return '<span class="ss-ar">' + m[1] + '</span> <span class="ss-lat">' + m[2] + '</span>';
    }).join('<span class="ss-sep"> · </span>');
    document.getElementById("surahStatus").innerHTML = html;
    syncFixedBarOffsets(); // toolbar can wrap to a second line depending on the text above
    // keep the audio panel's range fields pointing at what's open — they used to sync only
    // on panel-open, so an already-open panel went stale after navigation and ▶ played the
    // previous surah's range
    if (document.getElementById("audioBar").classList.contains("open") && !Reciter.rangeActive()){
      syncRangeToReadingPosition();
    }
  }

  // ---------------- keep each mushaf line on one visual row ----------------
  function fitLinesToWidth(){
    var flow = document.querySelector(".ayat-flow");
    if (!flow) return;
    document.documentElement.style.setProperty("--page-scale", "1");
    var lines = flow.querySelectorAll(".mushaf-line");
    if (!lines.length) return;
    var minScale = 1;
    var containerWidth = flow.clientWidth;
    lines.forEach(function(line){
      var needed = line.scrollWidth;
      if (needed > containerWidth){
        var scale = containerWidth / needed;
        if (scale < minScale) minScale = scale;
      }
    });
    if (minScale < 1){
      // don't shrink text into illegibility on a very dense page — past this floor,
      // that one exceptional line just scrolls horizontally on its own (see .mushaf-line CSS)
      // instead of dragging every other line on the page down with it.
      var floor = 0.62;
      // extra safety margin below the exact fit ratio — Arabic glyph shaping doesn't scale
      // perfectly linearly with font-size, so a couple of lines can end up a few px over
      // the exact ratio; they'd just gain their own tiny horizontal scroll (see CSS) but
      // it's nicer to avoid that in the common case.
      document.documentElement.style.setProperty("--page-scale", Math.max(floor, minScale * 0.95).toFixed(3));
    }
  }

  function goToPage(n){
    if (!n) return;
    renderPage(n);
  }

  // ---------------- navigation controls ----------------
  // Pages turn via swipe (wireSwipeNavigation), the page-number input, the sidebar, and the
  // arrow keys (keyboard listener below) — the old footer prev/next buttons were removed.
  function goToTypedPage(){
    var v = parseInt(document.getElementById("pageInput").value, 10);
    if (!isNaN(v)) goToPage(Math.min(TOTAL_PAGES, Math.max(1, v)));
  }
  var pageInputDebounce = null;
  document.getElementById("pageInput").addEventListener("input", function(){
    clearTimeout(pageInputDebounce);
    pageInputDebounce = setTimeout(goToTypedPage, 2000);
  });
  document.getElementById("pageInput").addEventListener("keydown", function(e){
    if (e.key === "Enter"){
      clearTimeout(pageInputDebounce);
      goToTypedPage();
    }
  });
  document.getElementById("toggleSidebar").addEventListener("click", function(){
    shell.classList.toggle("collapsed");
  });

  // Clicking anywhere outside the sidebar closes it — same as tapping ☰ again. On mobile the
  // sidebar is a fixed overlay (the dimmed reader behind it counts as "outside" too); on
  // desktop/landscape it's in-flow, but the same click-anywhere-else behavior was requested
  // there too (GitHub issue #3). The settings panel closes the same way. The landscape-only
  // floating triggers (edge fabs) are excluded so a tap that just OPENED a panel doesn't
  // bubble up and immediately close it again.
  document.addEventListener("click", function(e){
    var settingsPanel = document.getElementById("settingsPanel");
    var settingsTrigger = e.target.closest("#toggleSettings, #fabSettings");
    if (settingsPanel && settingsPanel.classList.contains("open") &&
        !settingsPanel.contains(e.target) && !settingsTrigger){
      settingsPanel.classList.remove("open");
    }
    if (shell.classList.contains("collapsed")) return;
    var sidebarEl = document.getElementById("sidebar");
    if (sidebarEl.contains(e.target) || e.target.closest("#toggleSidebar, #fabSidebar")) return;
    shell.classList.add("collapsed");
  });

  // landscape-phone triggers (the topbar itself is display:none there — see style.css)
  document.getElementById("fabSidebar").addEventListener("click", function(){
    shell.classList.toggle("collapsed");
  });
  document.getElementById("fabSettings").addEventListener("click", function(){
    document.getElementById("settingsPanel").classList.toggle("open");
  });

  window.addEventListener("resize", function(){ fitLinesToWidth(); syncFixedBarOffsets(); });
  // web fonts (header.topbar's brand text, .page-toolbar's) can finish loading and reflow
  // after boot()'s first measurement ran — re-measure once more after everything's settled so
  // that reflow doesn't leave a stale gap/overlap between the fixed bars and the page content.
  window.addEventListener("load", syncFixedBarOffsets);

  // ---------------- pinch-to-zoom (zooms the page image itself, not the text size) ----------------
  var ZOOM_MIN = 1, ZOOM_MAX = 3;
  var pageZoom = 1;
  var pinchStartDist = null;
  var pinchStartZoom = 1;
  var mushafPageEl = null; // set in buildReaderShell — same stable element every renderPage()

  // applies the transform directly to the element instead of going through a CSS custom
  // property on :root — a :root variable used in one element's `transform` can still make
  // some browsers re-evaluate style more broadly on every update, which made rapid
  // touchmove-driven zooming feel heavy; setting .style.transform is the direct/cheap path.
  function setPageZoom(z){
    pageZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    if (mushafPageEl) mushafPageEl.style.transform = pageZoom === 1 ? "" : "scale(" + pageZoom.toFixed(3) + ")";
    if (readerScroll) readerScroll.classList.toggle("zoomed", pageZoom > 1.001);
  }

  function resetPageZoom(){ setPageZoom(1); }

  function touchDistance(a, b){
    var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function wirePinchZoom(el){
    // touch/wheel events can fire much faster than the screen can repaint — coalesce
    // bursts into at most one style update per animation frame instead of applying every
    // single event synchronously, which was making pinch/pan feel heavy.
    var rafScheduled = false;
    var latestZoom = null;
    function flushZoom(){
      rafScheduled = false;
      setPageZoom(latestZoom);
    }
    function scheduleZoom(z){
      latestZoom = z;
      if (!rafScheduled){
        rafScheduled = true;
        requestAnimationFrame(flushZoom);
      }
    }

    el.addEventListener("touchstart", function(e){
      if (viewMode === "ayah") return; // no pinch-zoom in the ayah/translation view
      if (e.touches.length === 2){
        pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
        pinchStartZoom = pageZoom;
      }
    }, { passive: true });
    el.addEventListener("touchmove", function(e){
      if (viewMode === "ayah") return;
      if (e.touches.length === 2 && pinchStartDist){
        e.preventDefault();
        scheduleZoom(pinchStartZoom * (touchDistance(e.touches[0], e.touches[1]) / pinchStartDist));
      }
    }, { passive: false });
    el.addEventListener("touchend", function(e){
      if (e.touches.length < 2) pinchStartDist = null;
    });
    // trackpad pinch — Chrome/Firefox/Safari all report it as a wheel event with ctrlKey set
    el.addEventListener("wheel", function(e){
      if (viewMode === "ayah") return;
      if (!e.ctrlKey) return;
      e.preventDefault();
      scheduleZoom(pageZoom - e.deltaY * 0.01);
    }, { passive: false });
  }

  // ---------------- swipe left/right to page turn (issue #12) ----------------
  // RTL paging feel (user-confirmed): dragging left-to-right (dx > 0) pulls the NEXT page in
  // from the left edge, right-to-left goes back. Deliberately skipped for: multi-touch
  // (that's a pinch), a single finger starting on a horizontally-scrollable mushaf line (that
  // drag should scroll the line, not the page), and while zoomed (that's panning). Requires
  // the horizontal component to clearly dominate so vertical page scrolling never pages.
  var SWIPE_MIN_DX = 60;
  var SWIPE_DOMINANCE = 1.5;

  function wireSwipeNavigation(el){
    var startX = 0, startY = 0, tracking = false;

    el.addEventListener("touchstart", function(e){
      if (e.touches.length !== 1){ tracking = false; return; } // pinch start — not a swipe
      var line = e.target.closest ? e.target.closest(".mushaf-line") : null;
      if (line && line.scrollWidth > line.clientWidth + 1){ tracking = false; return; }
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    el.addEventListener("touchcancel", function(){ tracking = false; });

    el.addEventListener("touchend", function(e){
      if (!tracking) return;
      tracking = false;
      if (pageZoom > 1.001) return; // panning a zoomed page, not turning it
      var t = e.changedTouches[0];
      var dx = t.clientX - startX, dy = t.clientY - startY;
      if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE) return;
      goToPage(dx > 0 ? currentPage + 1 : currentPage - 1);
    });
  }

  // ---------------- keyboard: space to reveal next word, backspace to undo ----------------
  document.addEventListener("keydown", function(e){
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input") return;

    if (e.code === "Space"){
      e.preventDefault();
      moveCursor(1);
    } else if (e.key === "Backspace"){
      e.preventDefault();
      moveCursor(-1);
    }

    if (e.key === "ArrowRight"){
      goToPage(currentPage + 1);
    } else if (e.key === "ArrowLeft"){
      goToPage(currentPage - 1);
    }
  });

  // ---------------- boot ----------------
  function boot(){
    renderSidebar();
    renderBookmarkList();
    buildReaderShell();
    wireSettingsPanel();
    wireAudioBar();
    renderPage(1);
  }

  try{
    boot();
  } catch(err){
    console.error(err);
    reader.innerHTML =
      '<div class="center-screen">' +
        '<div class="ar">تَعَذَّرَ التَحْمِيل</div>' +
        '<div>Gagal memuat aplikasi. Coba muat ulang halaman ini.</div>' +
      '</div>';
  }

  // collapse sidebar by default wherever it renders as an overlay (--ayah-size for narrow
  // screens is set in CSS)
  if (isOverlaySidebarMode()){
    shell.classList.add("collapsed");
    fitLinesToWidth();
  }
})();
