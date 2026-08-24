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

  // ---------------- state ----------------
  var currentPage = 1;
  var pageCursor = Object.create(null);      // pageNumber -> how many words (in reading order) are revealed
  var pageWordCountCache = Object.create(null);
  var pageWordAyahCache = Object.create(null); // pageNumber -> [[surah,ayah], ...] parallel to word reading order

  var reader = document.getElementById("reader");
  var shell = document.getElementById("shell");

  // ---------------- derived lookup tables (built once from the bundled data) ----------------
  var SAJDA_SET = Object.create(null);
  SAJDA_AYAHS.forEach(function(p){ SAJDA_SET[p[0] + ":" + p[1]] = true; });

  var SURAH_FIRST_PAGE = Object.create(null);
  for (var p = 1; p <= TOTAL_PAGES; p++){
    var linesOnPage = MUSHAF_PAGES[p - 1] || [];
    for (var i = 0; i < linesOnPage.length; i++){
      if (linesOnPage[i][0] === "h"){
        var sn = linesOnPage[i][1];
        if (SURAH_FIRST_PAGE[sn] === undefined) SURAH_FIRST_PAGE[sn] = p;
      }
    }
  }

  // ---------------- page helpers ----------------
  function countPageWords(pageNo){
    if (pageWordCountCache[pageNo] !== undefined) return pageWordCountCache[pageNo];
    var linesOnPage = MUSHAF_PAGES[pageNo - 1] || [];
    var total = 0;
    linesOnPage.forEach(function(line){
      if (line[0] === "t"){
        line[1].forEach(function(run){ total += run[3].split(" ").length; });
      }
    });
    pageWordCountCache[pageNo] = total;
    return total;
  }

  // which [surah,ayah] each word on the page belongs to, in the same reading order
  // the reveal cursor counts through — used to show "sedang di ayat N" and to let the
  // "1 ayat" button know where the current ayah ends.
  function getPageWordAyahList(pageNo){
    if (pageWordAyahCache[pageNo]) return pageWordAyahCache[pageNo];
    var linesOnPage = MUSHAF_PAGES[pageNo - 1] || [];
    var list = [];
    linesOnPage.forEach(function(line){
      if (line[0] === "t"){
        line[1].forEach(function(run){
          var surah = run[0], ayah = run[1], count = run[3].split(" ").length;
          for (var i = 0; i < count; i++) list.push([surah, ayah]);
        });
      }
    });
    pageWordAyahCache[pageNo] = list;
    return list;
  }

  function pageSurahNumbers(pageNo){
    var linesOnPage = MUSHAF_PAGES[pageNo - 1] || [];
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
  function renderSidebar(){
    var container = document.getElementById("surahList");
    container.innerHTML = "";
    SURAH_META.forEach(function(s){
      var number = s[0], nameAr = s[1], nameEn = s[2], nameTranslation = s[3], isMeccan = s[4], ayahCount = s[5];
      var item = document.createElement("div");
      item.className = "surah-item";
      item.dataset.number = number;
      item.dataset.search = (number + " " + nameAr + " " + nameEn + " " + nameTranslation).toLowerCase();
      item.innerHTML =
        '<div class="surah-num">' + number + '</div>' +
        '<div class="surah-info">' +
          '<div class="name-ar">' + nameAr + '</div>' +
          '<div class="name-lat">' +
            '<span>' + nameEn + '</span>' +
            '<span class="badge">' + (isMeccan ? "Makkiyah" : "Madaniyah") + '</span>' +
          '</div>' +
        '</div>';
      item.addEventListener("click", function(){
        goToPage(SURAH_FIRST_PAGE[number]);
        if (window.innerWidth <= 760) shell.classList.add("collapsed");
      });
      container.appendChild(item);
    });
  }

  document.getElementById("surahSearch").addEventListener("input", function(e){
    var q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".surah-item").forEach(function(el){
      el.style.display = el.dataset.search.indexOf(q) === -1 ? "none" : "flex";
    });
  });

  function highlightActiveSurah(surahNumber){
    document.querySelectorAll(".surah-item").forEach(function(el){
      el.classList.toggle("active", +el.dataset.number === surahNumber);
    });
  }

  // ---------------- sidebar tabs (Surah / Markah) ----------------
  document.getElementById("tabSurah").addEventListener("click", function(){ switchSidebarTab("surah"); });
  document.getElementById("tabBookmarks").addEventListener("click", function(){ switchSidebarTab("bookmarks"); });

  function switchSidebarTab(tab){
    var isSurah = tab === "surah";
    document.getElementById("tabSurah").classList.toggle("active", isSurah);
    document.getElementById("tabBookmarks").classList.toggle("active", !isSurah);
    document.getElementById("surahSearch").style.display = isSurah ? "" : "none";
    document.getElementById("surahList").style.display = isSurah ? "" : "none";
    document.getElementById("bookmarkList").style.display = isSurah ? "none" : "block";
  }

  // ---------------- bookmarks (saved to this device/browser only, via localStorage) ----------------
  var BOOKMARKS_KEY = "mushafHifzBookmarks";

  function loadBookmarks(){
    try{
      var arr = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
      return Array.isArray(arr) ? arr.filter(function(n){ return Number.isInteger(n) && n >= 1 && n <= TOTAL_PAGES; }) : [];
    } catch(e){
      return [];
    }
  }

  function saveBookmarks(){
    try{ localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks)); } catch(e){ /* storage unavailable (private mode/full) — bookmark just won't persist */ }
  }

  var bookmarks = loadBookmarks();

  function isBookmarked(pageNo){ return bookmarks.indexOf(pageNo) !== -1; }

  function toggleBookmark(pageNo){
    var idx = bookmarks.indexOf(pageNo);
    if (idx === -1) bookmarks.push(pageNo);
    else bookmarks.splice(idx, 1);
    bookmarks.sort(function(a, b){ return a - b; });
    saveBookmarks();
    updateBookmarkToggle();
    renderBookmarkList();
  }

  function updateBookmarkToggle(){
    var btn = document.getElementById("bookmarkToggle");
    if (!btn) return;
    var marked = isBookmarked(currentPage);
    btn.textContent = marked ? "★" : "☆";
    btn.classList.toggle("active", marked);
    btn.title = marked ? "Hapus markah halaman ini" : "Tandai halaman ini";
  }

  function renderBookmarkList(){
    var countEl = document.getElementById("bookmarkCount");
    if (countEl) countEl.textContent = bookmarks.length ? bookmarks.length : "";
    var container = document.getElementById("bookmarkList");
    if (!container) return;
    if (!bookmarks.length){
      container.innerHTML = '<div class="bookmark-empty">Belum ada halaman ditandai.<br>Klik ☆ di pembaca untuk menandai.</div>';
      return;
    }
    container.innerHTML = "";
    bookmarks.forEach(function(pageNo){
      var names = pageSurahNumbers(pageNo).map(function(n){ return SURAH_META[n - 1][1]; }).join(" · ");
      var item = document.createElement("div");
      item.className = "bookmark-item";
      item.innerHTML =
        '<div class="bm-page">' + pageNo + '</div>' +
        '<div class="bm-info"><div class="bm-surah">' + names + '</div></div>' +
        '<button class="bm-remove" type="button" title="Hapus markah">✕</button>';
      item.addEventListener("click", function(e){
        if (e.target.closest(".bm-remove")) return;
        goToPage(pageNo);
        if (window.innerWidth <= 760) shell.classList.add("collapsed");
      });
      item.querySelector(".bm-remove").addEventListener("click", function(e){
        e.stopPropagation();
        toggleBookmark(pageNo);
      });
      container.appendChild(item);
    });
  }

  // ---------------- reader shell ----------------
  var readerScroll = null; // the element that actually scrolls (set in buildReaderShell)

  function buildReaderShell(){
    reader.innerHTML =
      '<div class="reader-scroll" id="readerScroll">' +
        '<div class="page-toolbar">' +
          '<span class="status-group">' +
            '<span id="pageStatus" class="status"></span>' +
            '<button id="bookmarkToggle" class="bookmark-btn" type="button" title="Tandai halaman ini">☆</button>' +
          '</span>' +
          '<span id="surahStatus"></span>' +
        '</div>' +
        '<div class="mushaf-page" id="mushafPage"></div>' +
      '</div>' +
      '<div class="reveal-controls">' +
        '<button id="hideAll" class="minor" title="Sembunyikan semua">↺</button>' +
        '<button id="backspaceBtn" class="step">⌫ Batal</button>' +
        '<button id="spaceBtn" class="step">⎵ Lanjut</button>' +
        '<button id="ayahBtn" class="step">⏭ 1 Ayat</button>' +
        '<button id="revealAll" class="minor" title="Tampilkan semua">👁</button>' +
      '</div>';
    readerScroll = document.getElementById("readerScroll");
    wirePinchZoom(readerScroll);

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
    document.getElementById("bookmarkToggle").addEventListener("click", function(){ toggleBookmark(currentPage); });
  }

  function moveCursor(delta){
    var total = countPageWords(currentPage);
    var cur = pageCursor[currentPage] || 0;
    var next = Math.max(0, Math.min(total, cur + delta));
    if (next === cur) return;
    pageCursor[currentPage] = next;
    renderPage(currentPage, true);
  }

  // reveal the rest of whichever ayah comes next, in one go, instead of one word at a time
  function revealNextAyah(){
    var total = countPageWords(currentPage);
    var cur = pageCursor[currentPage] || 0;
    if (cur >= total) return;
    var ayahList = getPageWordAyahList(currentPage);
    var targetSurah = ayahList[cur][0], targetAyah = ayahList[cur][1];
    var next = cur;
    while (next < total && ayahList[next][0] === targetSurah && ayahList[next][1] === targetAyah){
      next++;
    }
    pageCursor[currentPage] = next;
    renderPage(currentPage, true);
  }

  // ---------------- page rendering ----------------
  function renderPage(pageNo, skipScrollReset){
    if (pageNo < 1 || pageNo > TOTAL_PAGES) return;
    currentPage = pageNo;
    var linesOnPage = MUSHAF_PAGES[pageNo - 1] || [];
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
          var surah = run[0], ayah = run[1], startWord = run[2], text = run[3];
          var words = text.split(" ");
          var ayahTotalWords = AYAH_LEN[surah - 1][ayah - 1];
          var isSajdaAyah = !!SAJDA_SET[surah + ":" + ayah];
          for (var wi = 0; wi < words.length; wi++){
            var wordInAyah = startWord + wi;
            var isLastOfAyah = wordInAyah === ayahTotalWords;
            var revealed = wordIndex < cursor;
            html += '<span class="word' + (revealed ? " revealed" : "") + '" data-idx="' + wordIndex + '">' +
                      words[wi] +
                      (isLastOfAyah ? '<span class="num">' + toArabicDigits(ayah) + '</span>' + (isSajdaAyah ? '<span class="sajda-tag">سجدة</span>' : "") : "") +
                    '</span> ';
            wordIndex++;
          }
        });
        html += '</div>';
      }
    });

    html += '</div><div class="page-number">— ' + toArabicDigits(pageNo) + ' —</div>';
    container.innerHTML = html;

    container.querySelectorAll(".word").forEach(function(el){
      el.addEventListener("click", function(){
        pageCursor[currentPage] = +el.dataset.idx + 1;
        renderPage(currentPage, true);
      });
    });

    document.getElementById("pageInput").value = pageNo;
    document.getElementById("prevPage").disabled = pageNo <= 1;
    document.getElementById("nextPage").disabled = pageNo >= TOTAL_PAGES;

    var surahsOnPage = pageSurahNumbers(pageNo);
    if (surahsOnPage.length) highlightActiveSurah(surahsOnPage[0]);

    updateStatus(surahsOnPage);
    fitLinesToWidth();
    if (!skipScrollReset){
      resetPageZoom();
      if (readerScroll) readerScroll.scrollTop = 0;
    }
  }

  function updateStatus(surahsOnPage){
    var total = countPageWords(currentPage);
    var revealedCount = Math.min(total, pageCursor[currentPage] || 0);
    var ayahList = getPageWordAyahList(currentPage);
    // "current ayah" = the ayah of the last word revealed so far, or the page's first
    // ayah if nothing's been revealed yet.
    var currentAyahLabel = "";
    var ayahPair = revealedCount > 0 ? ayahList[revealedCount - 1] : ayahList[0];
    if (ayahPair) currentAyahLabel = " — Ayat " + ayahPair[1];
    document.getElementById("pageStatus").textContent =
      "Halaman " + currentPage + " dari " + TOTAL_PAGES + currentAyahLabel +
      " — " + revealedCount + "/" + total + " kata tampil";
    var names = (surahsOnPage || pageSurahNumbers(currentPage)).map(function(n){ return SURAH_META[n - 1][1]; });
    document.getElementById("surahStatus").textContent = names.join(" · ");
    updateBookmarkToggle();
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
  document.getElementById("prevPage").addEventListener("click", function(){ goToPage(currentPage - 1); });
  document.getElementById("nextPage").addEventListener("click", function(){ goToPage(currentPage + 1); });
  document.getElementById("goPage").addEventListener("click", function(){
    var v = parseInt(document.getElementById("pageInput").value, 10);
    if (!isNaN(v)) goToPage(Math.min(TOTAL_PAGES, Math.max(1, v)));
  });
  document.getElementById("pageInput").addEventListener("keydown", function(e){
    if (e.key === "Enter") document.getElementById("goPage").click();
  });
  document.getElementById("toggleSidebar").addEventListener("click", function(){
    shell.classList.toggle("collapsed");
  });

  // ---------------- mobile: font/size settings tucked behind a gear icon ----------------
  var fontSettingsPanel = document.getElementById("fontSettings");
  document.getElementById("settingsToggle").addEventListener("click", function(e){
    e.stopPropagation();
    fontSettingsPanel.classList.toggle("open");
  });
  document.addEventListener("click", function(e){
    if (fontSettingsPanel.classList.contains("open") && !fontSettingsPanel.contains(e.target)){
      fontSettingsPanel.classList.remove("open");
    }
  });

  // ---------------- font settings ----------------
  document.getElementById("fontSelect").addEventListener("change", function(e){
    document.documentElement.style.setProperty("--ayah-font", e.target.value);
    fitLinesToWidth();
  });
  window.addEventListener("resize", function(){ fitLinesToWidth(); });

  // ---------------- pinch-to-zoom (zooms the page image itself, not the text size) ----------------
  var ZOOM_MIN = 1, ZOOM_MAX = 3;
  var pageZoom = 1;
  var pinchStartDist = null;
  var pinchStartZoom = 1;

  function setPageZoom(z){
    pageZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    document.documentElement.style.setProperty("--page-zoom", pageZoom.toFixed(3));
  }

  function resetPageZoom(){ setPageZoom(1); }

  function touchDistance(a, b){
    var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function wirePinchZoom(el){
    el.addEventListener("touchstart", function(e){
      if (e.touches.length === 2){
        pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
        pinchStartZoom = pageZoom;
      }
    }, { passive: true });
    el.addEventListener("touchmove", function(e){
      if (e.touches.length === 2 && pinchStartDist){
        e.preventDefault();
        setPageZoom(pinchStartZoom * (touchDistance(e.touches[0], e.touches[1]) / pinchStartDist));
      }
    }, { passive: false });
    el.addEventListener("touchend", function(e){
      if (e.touches.length < 2) pinchStartDist = null;
    });
    // trackpad pinch — Chrome/Firefox/Safari all report it as a wheel event with ctrlKey set
    el.addEventListener("wheel", function(e){
      if (!e.ctrlKey) return;
      e.preventDefault();
      setPageZoom(pageZoom - e.deltaY * 0.01);
    }, { passive: false });
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
    } else if (e.key === "ArrowRight"){
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
    renderPage(1);
  }

  try{
    boot();
  } catch(err){
    console.error(err);
    reader.innerHTML =
      '<div class="center-screen">' +
        '<div class="ar">تَعَذَّرَ التَحْمِيل</div>' +
        '<div>Data mushaf di dalam file ini tampaknya rusak atau tidak lengkap ' +
        '(mungkin file terpotong saat dikirim/diunduh). Coba minta ulang file HTML-nya.</div>' +
      '</div>';
  }

  // collapse sidebar by default on small screens (--ayah-size for this width is set in CSS)
  if (window.innerWidth <= 760){
    shell.classList.add("collapsed");
    fitLinesToWidth();
  }
})();
