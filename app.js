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

  // ---------------- live page data: fetched from api.quran.com per page, cached ----------------
  // pageNo -> line array (see page-layout.js), populated once a page finishes loading. Every
  // helper below reads from here instead of a bundled global — the whole mushaf isn't in memory
  // at once, only pages actually visited.
  var pageLinesCache = Object.create(null);
  var pageLoadPromises = Object.create(null); // pageNo -> in-flight promise, dedupes concurrent loads

  function loadPageLines(pageNo){
    if (pageLinesCache[pageNo]) return Promise.resolve(pageLinesCache[pageNo]);
    if (pageLoadPromises[pageNo]) return pageLoadPromises[pageNo];
    var promise = QuranApi.loadRawPage(pageNo).then(function(verses){
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

  // ---------------- page helpers ----------------
  function countPageWords(pageNo){
    if (pageWordCountCache[pageNo] !== undefined) return pageWordCountCache[pageNo];
    var linesOnPage = pageLinesCache[pageNo] || [];
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
    var linesOnPage = pageLinesCache[pageNo] || [];
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
  function renderSidebar(){
    var container = document.getElementById("surahList");
    container.innerHTML = "";
    SURAH_META.forEach(function(s){
      var number = s[0], nameAr = s[1], nameEn = s[2], nameTranslation = s[3], isMeccan = s[4], ayahCount = s[5], firstPage = s[6];
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
        goToPage(firstPage);
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

  function wireLongPressBookmark(el){
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
        var ayahPair = getPageWordAyahList(currentPage)[+el.dataset.idx];
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
    reader.innerHTML =
      '<div class="reader-scroll" id="readerScroll">' +
        '<div class="page-toolbar">' +
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
    mushafPageEl = document.getElementById("mushafPage");
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
  function renderPage(pageNo, skipScrollReset){
    if (pageNo < 1 || pageNo > TOTAL_PAGES) return;
    currentPage = pageNo;

    var cached = pageLinesCache[pageNo];
    if (cached){
      renderPageContent(pageNo, cached, skipScrollReset);
      return;
    }

    document.getElementById("mushafPage").innerHTML =
      '<div class="page-loading"><div class="ar">جَارٍ التَحْمِيل…</div><span>Memuat halaman…</span></div>';
    loadPageLines(pageNo).then(function(lines){
      if (currentPage !== pageNo) return;
      renderPageContent(pageNo, lines, skipScrollReset);
    }).catch(function(err){
      console.error(err);
      if (currentPage !== pageNo) return;
      document.getElementById("mushafPage").innerHTML =
        '<div class="page-loading">' +
          '<div>Gagal memuat halaman. Cek koneksi internet.</div>' +
          '<button id="retryPageLoad" type="button">Coba lagi</button>' +
        '</div>';
      document.getElementById("retryPageLoad").addEventListener("click", function(){ renderPage(pageNo, true); });
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
          var surah = run[0], ayah = run[1], startWord = run[2], text = run[3], endsAyah = run[4], isSajdaAyah = run[5];
          var words = text.split(" ");
          for (var wi = 0; wi < words.length; wi++){
            var isLastOfAyah = endsAyah && wi === words.length - 1;
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
        if (suppressNextWordClick){ suppressNextWordClick = false; return; }
        pageCursor[currentPage] = +el.dataset.idx + 1;
        renderPage(currentPage, true);
      });
      wireLongPressBookmark(el);
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
    var names = (surahsOnPage || pageSurahNumbers(currentPage)).map(function(n){ return SURAH_META[n - 1][1]; });
    document.getElementById("surahStatus").textContent = names.join(" · ");
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

  // Clicking anywhere outside the sidebar closes it — same as tapping ☰ again. On mobile the
  // sidebar is a fixed overlay (the dimmed reader behind it counts as "outside" too); on
  // desktop/landscape it's in-flow, but the same click-anywhere-else behavior was requested
  // there too (GitHub issue #3).
  document.addEventListener("click", function(e){
    if (shell.classList.contains("collapsed")) return;
    var sidebarEl = document.getElementById("sidebar");
    var toggleBtn = document.getElementById("toggleSidebar");
    if (sidebarEl.contains(e.target) || toggleBtn.contains(e.target)) return;
    shell.classList.add("collapsed");
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
      if (e.touches.length === 2){
        pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
        pinchStartZoom = pageZoom;
      }
    }, { passive: true });
    el.addEventListener("touchmove", function(e){
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
      if (!e.ctrlKey) return;
      e.preventDefault();
      scheduleZoom(pageZoom - e.deltaY * 0.01);
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
        '<div>Gagal memuat aplikasi. Coba muat ulang halaman ini.</div>' +
      '</div>';
  }

  // collapse sidebar by default on small screens (--ayah-size for this width is set in CSS)
  if (window.innerWidth <= 760){
    shell.classList.add("collapsed");
    fitLinesToWidth();
  }
})();
