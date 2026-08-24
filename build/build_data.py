"""
Regenerates data.js (the offline-bundled Qur'an text + Madinah 15-line layout +
surah metadata + sajda list) for the Mushaf Hifz app.

Only needed if:
  - the upstream mushaf-layout dataset needs re-pulling, or
  - another text/rendering bug like the tatweel one (see normalize_rasm below)
    turns up and needs a fix applied dataset-wide.

Requires internet (downloads the source dataset + fetches surah/sajda metadata
from api.alquran.cloud) and Python 3, no other dependencies. The app itself
(index.html + data.js) needs none of that at runtime — this script is a
build-time tool only.

Usage:
    python build/build_data.py
Writes ../data.js (i.e. the project root's data.js) that index.html loads via
<script src="data.js">.
"""
import json
import os
import re
import shutil
import urllib.request
import zipfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
WORK_DIR = os.path.join(SCRIPT_DIR, "_work")
ZIP_PATH = os.path.join(WORK_DIR, "mushaf-layout.zip")
PAGES_DIR = os.path.join(WORK_DIR, "mushaf-layout-main", "mushaf")
OUT_PATH = os.path.join(PROJECT_ROOT, "data.js")

DATASET_ZIP_URL = "https://github.com/zonetecde/mushaf-layout/archive/refs/heads/main.zip"

TRAILING_AYAH_DIGITS = re.compile(r"\s[٠-٩]+$")


# The source dataset encodes the small "dagger alif" (U+0670) as tatweel+dagger-alif
# ("ـٰ") in ~61% of its occurrences — a KFGQPC/QPC-glyph-font convention.
# api.alquran.cloud's plain-text edition (and general-purpose Arabic fonts like the
# ones this app embeds — Amiri Quran etc., not the proprietary QPC glyph fonts) don't
# expect that tatweel there and render it as a stray dash. Confirmed by diffing a
# whole surah (71/Nuh) against api.alquran.cloud word-for-word: every difference was
# exactly this tatweel, nothing else — so it's safe to strip everywhere. Other tatweel
# uses (e.g. before a hamza-above seat, U+0654) are left alone — those also appear in
# api.alquran.cloud's text, so they're a real part of the rasm, not a glyph-font artifact.
def normalize_rasm(s):
    return s.replace("ـٰ", "ٰ")


def ensure_dataset():
    if os.path.isdir(PAGES_DIR):
        return
    os.makedirs(WORK_DIR, exist_ok=True)
    print("downloading mushaf-layout dataset...")
    urllib.request.urlretrieve(DATASET_ZIP_URL, ZIP_PATH)
    with zipfile.ZipFile(ZIP_PATH) as zf:
        zf.extractall(WORK_DIR)
    if not os.path.isdir(PAGES_DIR):
        raise RuntimeError("extracted zip but %s not found — dataset layout may have changed" % PAGES_DIR)


def load_page(n):
    path = os.path.join(PAGES_DIR, "page-%03d.json" % n)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    ensure_dataset()

    # ---------- pass 1: validate + compute per-ayah word counts ----------
    ayah_len = {}  # (surah, ayah) -> max word-in-ayah seen
    line_number_errors = []
    total_word_occurrences = 0

    for n in range(1, 605):
        data = load_page(n)
        assert data["page"] == n, "page number mismatch in file %d" % n
        for idx, line in enumerate(data["lines"]):
            if line["line"] != idx + 1:
                line_number_errors.append((n, line["line"], idx + 1))
            if line["type"] == "text":
                for w in line["words"]:
                    s, a, wi = (int(x) for x in w["location"].split(":"))
                    total_word_occurrences += 1
                    key = (s, a)
                    if key not in ayah_len or wi > ayah_len[key]:
                        ayah_len[key] = wi

    print("line number sequencing errors:", len(line_number_errors), line_number_errors[:5])
    print("total word occurrences:", total_word_occurrences)
    print("distinct ayat seen:", len(ayah_len))
    assert len(ayah_len) == 6236, "expected 6236 ayat, got %d" % len(ayah_len)

    ayah_len_table = []
    for s in range(1, 115):
        ayahs_for_surah = [k for k in ayah_len if k[0] == s]
        max_ayah = max(a for _, a in ayahs_for_surah)
        ayah_len_table.append([ayah_len[(s, a)] for a in range(1, max_ayah + 1)])

    total_words_from_table = sum(sum(r) for r in ayah_len_table)
    print("total words (sum of ayah lengths):", total_words_from_table)

    # ---------- pass 2: build compact page structures ----------
    # Page format: MUSHAF_PAGES[pageNo-1] = [lineEntry, ...]
    #   surah header line: ["h", surahNumber, arabicTitle]
    #   basmala line:      ["b"]   (front-end draws its own hardcoded Basmalah text)
    #   text line:         ["t", [[surah, ayah, startWordInAyah, "word1 word2 ..."], ...]]
    #     — one array entry per run of consecutive words belonging to the same ayah;
    #       most lines have exactly one run, a line spanning an ayah boundary has two+.
    pages_out = []
    for n in range(1, 605):
        data = load_page(n)
        lines_out = []
        for line in data["lines"]:
            t = line["type"]
            if t == "surah-header":
                lines_out.append(["h", int(line["surah"]), normalize_rasm(line["text"])])
            elif t == "basmala":
                lines_out.append(["b"])
            elif t == "text":
                runs = []
                cur_s = cur_a = cur_start = None
                cur_words = []
                for w in line["words"]:
                    s, a, wi = (int(x) for x in w["location"].split(":"))
                    word_text = normalize_rasm(w["word"])
                    if wi == ayah_len[(s, a)]:
                        # strip the trailing embedded ayah-number digits (e.g. "...ٱلرَّحِيمِ ١")
                        # — the front-end renders its own styled ayah-number badge instead.
                        stripped = TRAILING_AYAH_DIGITS.sub("", word_text)
                        assert stripped != word_text, "expected trailing digits on last word %d:%d:%d" % (s, a, wi)
                        word_text = stripped
                    if cur_s == s and cur_a == a:
                        cur_words.append(word_text)
                    else:
                        if cur_words:
                            runs.append([cur_s, cur_a, cur_start, " ".join(cur_words)])
                        cur_s, cur_a, cur_start = s, a, wi
                        cur_words = [word_text]
                if cur_words:
                    runs.append([cur_s, cur_a, cur_start, " ".join(cur_words)])
                lines_out.append(["t", runs])
            else:
                raise ValueError("unknown line type %r on page %d" % (t, n))
        pages_out.append(lines_out)

    print("pages_out length:", len(pages_out))

    # ---------- fetch surah meta + sajda list (one-time, from api.alquran.cloud) ----------
    with urllib.request.urlopen("https://api.alquran.cloud/v1/meta") as resp:
        meta = json.load(resp)["data"]

    surah_meta_out = [
        [
            s["number"], s["name"], s["englishName"], s["englishNameTranslation"],
            1 if s["revelationType"] == "Meccan" else 0, s["numberOfAyahs"],
        ]
        for s in meta["surahs"]["references"]
    ]
    assert len(surah_meta_out) == 114

    sajda_out = [[r["surah"], r["ayah"]] for r in meta["sajdas"]["references"]]
    assert len(sajda_out) == 15

    # ---------- write data.js ----------
    def dump(obj):
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write("// Auto-generated by build/build_data.py. Do not hand-edit — re-run the script instead.\n")
        f.write("const MUSHAF_PAGES=" + dump(pages_out) + ";\n")
        f.write("const AYAH_LEN=" + dump(ayah_len_table) + ";\n")
        f.write("const SURAH_META=" + dump(surah_meta_out) + ";\n")
        f.write("const SAJDA_AYAHS=" + dump(sajda_out) + ";\n")

    print("wrote", OUT_PATH, "(%.2f MB)" % (os.path.getsize(OUT_PATH) / 1024 / 1024))


if __name__ == "__main__":
    main()
