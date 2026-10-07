#!/usr/bin/env python3
"""
Capa Atlas — English Wikipedia text for the /en atlas.

Follows each page in data/wikipedia.json (built by fetch_wikipedia.py) to its
English counterpart through Wikipedia's interlanguage links, so the English
text is about the very same subject — no second search, no second guess.
Entries that already came from en.wiki are copied as they are. Pages with no
English version get no entry: the English atlas shows the Italian text there,
marked as such.

Usage:
  python scripts/fetch_wikipedia_en.py            fetch missing entries only (resumable)
  python scripts/fetch_wikipedia_en.py --refetch  re-fetch everything

Reads:  data/wikipedia.json
Writes: data/wikipedia_en.json — { "<node id>": {title, extract, url, about} }
  `about` as in wikipedia.json (album/song pages only; figures keep a bio).
"""

import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_wikipedia import (  # noqa: E402
    MAX_BIO_CHARS,
    REQUEST_DELAY,
    SEARCH_URL,
    fetch_about,
    fetch_summary,
    http_json,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "data", "wikipedia.json")
OUT = os.path.join(ROOT, "data", "wikipedia_en.json")


# en.wiki often has no page for a single and links the Italian one to the
# album instead ("Avrai ragione tu" → "Museica"): a song must not take it.
ALBUM_SUBJECT = re.compile(r"^[^.]{0,80}\bis (?:the|an?) [^.]{0,40}\b(?:album|compilation)\b", re.IGNORECASE)


def english_title(it_title: str) -> str | None:
    data = http_json(SEARCH_URL.format(lang="it"), {
        "action": "query", "prop": "langlinks", "lllang": "en",
        "titles": it_title, "redirects": 1, "format": "json",
    })
    time.sleep(REQUEST_DELAY)
    for page in data.get("query", {}).get("pages", {}).values():
        for link in page.get("langlinks", []):
            return link.get("*")
    return None


def clip_bio(extract: str) -> str:
    """Same whole-sentence cut as fetch_wikipedia.lookup_figure."""
    if len(extract) <= MAX_BIO_CHARS:
        return extract
    cut = extract.rfind(". ", 0, MAX_BIO_CHARS)
    return extract[: cut + 1] if cut > 120 else extract[:MAX_BIO_CHARS].rstrip() + "…"


def lookup(node_id: str, entry: dict) -> dict | None:
    figure = node_id.startswith("concept:")
    song = node_id.startswith("song:")
    if entry.get("lang") == "en":
        if song and ALBUM_SUBJECT.search(entry["extract"]):
            return None
        if figure:
            return {k: entry[k] for k in ("title", "extract", "url")}
        return {k: entry.get(k) for k in ("title", "extract", "url", "about")}
    title = english_title(entry["title"])
    if not title:
        return None
    summary = fetch_summary("en", title)
    time.sleep(REQUEST_DELAY)
    extract = summary.get("extract", "")
    if not extract or summary.get("type") == "disambiguation":
        return None
    if song and ALBUM_SUBJECT.search(extract):
        return None
    result = {
        "title": summary.get("title", title),
        "extract": clip_bio(extract) if figure else extract,
        "url": summary.get("content_urls", {}).get("desktop", {}).get("page"),
    }
    if not figure:
        result["about"] = fetch_about("en", result["title"])["about"]
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refetch", action="store_true", help="ignore the existing cache")
    args = ap.parse_args()

    with open(SOURCE, encoding="utf-8") as f:
        source = {k: v for k, v in json.load(f).items() if v}
    cache: dict[str, dict] = {}
    if not args.refetch and os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            cache = json.load(f)

    todo = [k for k in source if k not in cache]
    print(f"{len(cache)} cached, {len(todo)} to fetch")
    for i, node_id in enumerate(todo):
        cache[node_id] = lookup(node_id, source[node_id]) or {}
        status = "ok" if cache[node_id] else "—"
        print(f"[{i + 1}/{len(todo)}] {status:>3}  {node_id}  {cache[node_id].get('title', '')}")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    found = sum(1 for v in cache.values() if v)
    print(f"done: {found}/{len(cache)} have an English page → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
