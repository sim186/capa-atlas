#!/usr/bin/env python3
"""
Capa Atlas — Wikipedia enrichment: short descriptions for album and song
nodes, pulled from Italian Wikipedia (falls back to English if a page
exists there but not on it.wiki).

For each candidate title we search Wikipedia, then fetch the page summary
and only keep it if the summary text actually mentions "Caparezza" — most
album tracks have no dedicated article, and without this check a common
song title (e.g. a single word) would happily match an unrelated page.

Usage:
  python scripts/fetch_wikipedia.py            fetch missing entries only (resumable)
  python scripts/fetch_wikipedia.py --refetch  re-fetch everything, ignoring the cache
  python scripts/fetch_wikipedia.py --limit 20 stop after N new lookups (testing)

Output: data/wikipedia.json — { "<node id>": {title, extract, url, lang} }
Reads: data/raw/referents.jsonl (for the album/song id → title list)
"""

import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "referents.jsonl")
OUT = os.path.join(ROOT, "data", "wikipedia.json")

UA = "capa-atlas/1.0 (https://github.com/; research/personal project)"
LANGS = ["it", "en"]  # try Italian first, English as fallback
SEARCH_URL = "https://{lang}.wikipedia.org/w/api.php"
SUMMARY_URL = "https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}"
REQUEST_DELAY = 0.6


def http_json(url: str, params: dict | None = None) -> dict:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    last_err = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {}
            if e.code == 429:
                retry_after = e.headers.get("Retry-After")
                time.sleep(float(retry_after) if retry_after else 8 + attempt * 4)
            else:
                time.sleep(1 + attempt)
            last_err = e
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            time.sleep(1 + attempt)
    print(f"  ! giving up on {url}: {last_err}", file=sys.stderr)
    return {}


def search_title(lang: str, query: str) -> str | None:
    data = http_json(SEARCH_URL.format(lang=lang), {
        "action": "query", "list": "search", "srsearch": query,
        "srlimit": 1, "format": "json",
    })
    hits = data.get("query", {}).get("search", [])
    return hits[0]["title"] if hits else None


def fetch_summary(lang: str, title: str) -> dict:
    encoded = urllib.parse.quote(title.replace(" ", "_"))
    return http_json(SUMMARY_URL.format(lang=lang, title=encoded))


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"\([^)]*\)", " ", s)  # drop disambiguation parentheticals
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def same_subject(wanted_title: str, result_title: str) -> bool:
    """The search API happily returns an unrelated top hit when nothing
    matches — e.g. querying a track with no article of its own can land on
    the artist's most prominent album, which still legitimately mentions
    "Caparezza" and would otherwise pass the topic check. Require the
    result's (normalized) title to actually contain the title we searched
    for, not just be Caparezza-adjacent."""
    wanted = normalize(wanted_title)
    result = normalize(result_title)
    return bool(wanted) and wanted in result


# Some songs share their exact title with an album/compilation of the same
# name (e.g. the title track "Exuvia" vs. the album "Exuvia (album)"); the
# search+same_subject check alone can't tell them apart, since the page really
# is about "this exact title" — just the wrong *kind* of thing. Reject a
# song-kind match whose page is actually about a release.
#
# Can't just blocklist "album in studio" anywhere in the extract: a
# legitimate single's summary routinely mentions its parent album later in
# the same sentence ("...è un singolo... estratto dal quarto album in studio
# Le dimensioni del mio caos"). Only the clause right after the subject's
# "è" states what the *page itself* is.
SUBJECT_CLAUSE_RE = re.compile(r"\bè\b([^,.]{0,60})", re.IGNORECASE)


def wrong_kind(kind: str, extract: str) -> bool:
    if kind != "song":
        return False
    m = SUBJECT_CLAUSE_RE.search(extract)
    clause = m.group(1).casefold() if m else ""
    return "album" in clause or "raccolta" in clause


def lookup(title: str, kind: str) -> dict | None:
    """Search + summary in each language, kept only if the result page is
    plausibly *about this exact title* (see same_subject), the right kind
    of thing (see wrong_kind), and mentions Caparezza (filters out unrelated
    same-named pages)."""
    query = f"{title} Caparezza {kind}" if kind == "album" else f"{title} Caparezza"
    for lang in LANGS:
        result_title = search_title(lang, query)
        time.sleep(REQUEST_DELAY)
        if not result_title or not same_subject(title, result_title):
            continue
        summary = fetch_summary(lang, result_title)
        time.sleep(REQUEST_DELAY)
        extract = summary.get("extract", "")
        description = summary.get("description", "")
        haystack = f"{extract}\n{description}".casefold()
        if "caparezza" not in haystack or not extract or wrong_kind(kind, extract):
            continue
        return {
            "title": summary.get("title", result_title),
            "extract": extract,
            "url": summary.get("content_urls", {}).get("desktop", {}).get("page"),
            "lang": lang,
        }
    return None


def load_referents() -> list[dict]:
    if not os.path.exists(RAW):
        print("No data yet — run: python scripts/fetch_capa.py --seed")
        sys.exit(1)
    with open(RAW, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refetch", action="store_true", help="ignore the existing cache")
    ap.add_argument("--limit", type=int, default=None, help="stop after N new lookups")
    args = ap.parse_args()

    refs = load_referents()
    albums: dict[str, str] = {}   # node id -> title
    songs: dict[str, str] = {}
    for r in refs:
        album_name = r.get("songAlbum") or "Singoli / altro"
        if album_name != "Singoli / altro":
            albums[f"album:{album_name}"] = album_name
        songs[f"song:{r['songId']}"] = r["songTitle"]

    cache: dict[str, dict] = {}
    if not args.refetch and os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            cache = json.load(f)

    todo = [(node_id, title, "album") for node_id, title in albums.items() if node_id not in cache]
    todo += [(node_id, title, "song") for node_id, title in songs.items() if node_id not in cache]
    if args.limit:
        todo = todo[: args.limit]

    print(f"{len(cache)} cached, {len(todo)} to fetch")
    for i, (node_id, title, kind) in enumerate(todo):
        # A few album names carry a stray trailing space from the Genius
        # scrape (e.g. "Tequila "); the node id keeps it (must match
        # build_graph's id), the search query doesn't need to.
        result = lookup(title.strip(), kind)
        cache[node_id] = result or {}
        status = "ok" if result else "—"
        print(f"[{i + 1}/{len(todo)}] {status:>3}  {kind:5}  {title}")
        if (i + 1) % 20 == 0:
            with open(OUT, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False, indent=1)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)

    found = sum(1 for v in cache.values() if v)
    print(f"done: {found}/{len(cache)} nodes have a Wikipedia description → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
