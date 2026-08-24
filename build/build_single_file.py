"""
Merges index.html + style.css + fonts.css + data.js + app.js into one
self-contained mushaf-hifz-offline.html — only needed if you want a single
file to send around again (e.g. over WhatsApp) instead of pointing people at
the hosted URL. The hosted site itself just uses the 5 files directly; this
script isn't part of that.

Usage:
    python build/build_single_file.py
Writes ../mushaf-hifz-offline.html (gitignored — regenerate on demand).
"""
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
OUT_PATH = os.path.join(ROOT, "mushaf-hifz-offline.html")


def read(name):
    with open(os.path.join(ROOT, name), "r", encoding="utf-8") as f:
        return f.read()


def main():
    html = read("index.html")

    html = html.replace(
        '<link rel="stylesheet" href="fonts.css">',
        "<style>\n" + read("fonts.css").rstrip() + "\n</style>",
    )
    html = html.replace(
        '<link rel="stylesheet" href="style.css">',
        "<style>\n" + read("style.css").rstrip() + "\n</style>",
    )
    html = html.replace(
        '<script src="data.js"></script>',
        "<script>\n" + read("data.js").rstrip() + "\n</script>",
    )
    html = html.replace(
        '<script src="app.js"></script>',
        "<script>\n" + read("app.js").rstrip() + "\n</script>",
    )

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    print("wrote", OUT_PATH, "(%.2f MB)" % (os.path.getsize(OUT_PATH) / 1024 / 1024))


if __name__ == "__main__":
    main()
