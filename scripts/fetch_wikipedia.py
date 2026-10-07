#!/usr/bin/env python3
"""
Capa Atlas — Wikipedia enrichment: short descriptions for album and song
nodes, pulled from Italian Wikipedia (falls back to English if a page
exists there but not on it.wiki).

For each candidate title we search Wikipedia, then fetch the page summary
and only keep it if the summary text actually mentions "Caparezza" — most
album tracks have no dedicated article, and without this check a common
song title (e.g. a single word) would happily match an unrelated page.

Figure nodes (Van Gogh, Dante...) get a short bio looked up by explicit title.

Usage:
  python scripts/fetch_wikipedia.py            fetch missing entries only (resumable)
  python scripts/fetch_wikipedia.py --refetch  re-fetch everything, ignoring the cache
  python scripts/fetch_wikipedia.py --limit 20 stop after N new lookups (testing)

Output: data/wikipedia.json — { "<node id>": {title, extract, url, lang, about} }
  `extract` is the one-line lead ("X è un singolo ... pubblicato il ...");
  `about` is the substance of the page — a list of {heading, text} for the
  sections that say what the album/song is *about* (concept, meaning,
  composition...), minus track lists, credits, charts and other boilerplate.
  Album entries also carry `tracklist` (titles in disc order, from "Tracce")
  and `trackNotes` ({title, text} per track, from "Brani"): the per-song
  commentary belongs to the song, so build_graph moves it there.
  Entries cached before `about`/`tracklist` existed are backfilled without
  re-searching.
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
        page_title = summary.get("title", result_title)
        return {
            "title": page_title,
            "extract": extract,
            "url": summary.get("content_urls", {}).get("desktop", {}).get("page"),
            "lang": lang,
            **fetch_about(lang, page_title),
        }
    return None


# Sections that are lists/credits/reception rather than "what is this about".
SKIP_SECTIONS = {
    "tracce", "formazione", "classifiche", "classifica", "note", "bibliografia",
    "altri progetti", "collegamenti esterni", "voci correlate", "video musicale",
    "video", "promozione", "tour", "riconoscimenti", "certificazioni",
    "successo commerciale", "date di pubblicazione", "crediti", "produzione",
    "musicisti", "altre versioni", "cover", "versioni", "edizioni", "singoli",
    "pubblicazione", "accoglienza", "critica", "ricezione", "vendite",
    # English pages (fallback language)
    "track listing", "personnel", "charts", "weekly charts", "year-end charts",
    "certifications", "critical reception", "reception", "release", "promotion",
    "music video", "notes", "references", "external links", "see also",
    "credits", "release history", "accolades", "tour", "sales",
    "commercial performance", "bonus tracks", "track list", "chart performance",
}
HEADING_RE = re.compile(r"^(={2,6})\s*(.*?)\s*\1\s*$")
MAX_SECTION_CHARS = 1400
# Album sections that walk through the record one track at a time. Their
# commentary is split per track and handed to the songs, not the album.
TRACK_SECTIONS = {"brani", "i brani", "le canzoni", "canzoni", "i testi", "testi"}
TRACKLIST_SECTIONS = {"tracce", "tracce dell'album", "track listing"}
# "Mica van Gogh – 3:55" / "Fai da tela (feat. Diego Perrone) – 3:59 (...)"
TRACKLIST_LINE = re.compile(r"^\s*(?:\d+\.\s*)?(.+?)\s+[–—-]\s+\d{1,2}:\d{2}\b")
MAX_TRACK_NOTE_CHARS = 1400


def clip(body: str, limit: int) -> str:
    """Cut at a sentence boundary when over the limit."""
    if len(body) <= limit:
        return body
    cut = body.rfind(". ", 0, limit)
    return body[: cut + 1] if cut > 400 else body[:limit].rstrip() + "…"


def fetch_page_text(lang: str, title: str) -> str:
    data = http_json(SEARCH_URL.format(lang=lang), {
        "action": "query", "prop": "extracts", "explaintext": 1,
        "exsectionformat": "wiki", "titles": title, "format": "json",
        "redirects": 1,
    })
    time.sleep(REQUEST_DELAY)
    pages = data.get("query", {}).get("pages", {})
    return next(iter(pages.values()), {}).get("extract", "") if pages else ""


def parse_page(text: str) -> dict:
    """Split a page's plain text into `about` sections, plus (album pages)
    `tracklist` and `trackNotes`. Level-3+ headings are folded into their
    parent so the panel stays flat, except inside a track section, where
    each sub-heading is a track."""
    about: list[dict] = []
    tracklist: list[str] = []
    notes: list[dict] = []
    heading, kind, buf = None, "skip", []  # lead paragraph is already `extract`
    sub, sub_buf = None, []

    def flush_sub():
        body = "\n".join(sub_buf).strip()
        if sub and body:
            notes.append({"title": sub, "text": clip(body, MAX_TRACK_NOTE_CHARS)})

    def flush():
        body = "\n".join(buf).strip()
        if kind == "about" and heading and body:
            about.append({"heading": heading, "text": clip(body, MAX_SECTION_CHARS)})
        elif kind == "tracks":
            flush_sub()
            # No per-track sub-headings: one paragraph per track (or two),
            # matched to titles by build_graph.
            if body:
                notes.append({"title": None, "text": body})
        elif kind == "tracklist":
            for line in buf:
                m = TRACKLIST_LINE.match(line)
                if m:
                    tracklist.append(m.group(1).strip())

    for line in text.splitlines():
        m = HEADING_RE.match(line)
        if m and len(m.group(1)) == 2:
            flush()
            heading, buf, sub, sub_buf = m.group(2), [], None, []
            key = heading.casefold()
            kind = ("tracks" if key in TRACK_SECTIONS
                    else "tracklist" if key in TRACKLIST_SECTIONS
                    else "skip" if key in SKIP_SECTIONS else "about")
        elif m and kind == "tracks":
            flush_sub()
            sub, sub_buf = m.group(2), []
        elif m:
            buf.append(m.group(2) + ".")  # sub-heading → inline lead-in
        elif kind == "tracks" and sub is not None:
            sub_buf.append(line)
        else:
            buf.append(line)
    flush()
    return {"about": about, "tracklist": tracklist, "trackNotes": notes}


def fetch_about(lang: str, title: str) -> dict:
    """`about`, `tracklist` and `trackNotes` for a page (see parse_page)."""
    return parse_page(fetch_page_text(lang, title))


# The 13 `figure` nodes (data/concepts.json) are real people / characters,
# not Caparezza releases, so the search + "mentions Caparezza" check doesn't
# apply: look the page up directly by an explicit title. Stored under the
# node id ("concept:<id>") as a short bio.
FIGURE_TITLES = {
    "van_gogh": "Vincent van Gogh", "dante": "Dante Alighieri", "gesu_cristo": "Gesù",
    "beethoven": "Ludwig van Beethoven", "berlusconi": "Silvio Berlusconi",
    "galileo": "Galileo Galilei", "eraclito": "Eraclito", "nietzsche": "Friedrich Nietzsche",
    "freud": "Sigmund Freud", "darwin": "Charles Darwin", "lewis_carroll": "Lewis Carroll",
    "ulisse": "Ulisse", "kubrick": "Stanley Kubrick",
}
MAX_BIO_CHARS = 420


def lookup_figure(title: str) -> dict | None:
    summary = fetch_summary("it", title)
    time.sleep(REQUEST_DELAY)
    extract = summary.get("extract", "")
    if not extract or summary.get("type") == "disambiguation":
        return None
    if len(extract) > MAX_BIO_CHARS:  # keep whole sentences
        cut = extract.rfind(". ", 0, MAX_BIO_CHARS)
        extract = extract[: cut + 1] if cut > 120 else extract[:MAX_BIO_CHARS].rstrip() + "…"
    return {
        "title": summary.get("title", title),
        "extract": extract,
        "url": summary.get("content_urls", {}).get("desktop", {}).get("page"),
        "lang": "it",
    }


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

    # Backfill: entries fetched before `about` existed — page is already
    # known to be right, so just pull its sections.
    backfill = [
        k for k, v in cache.items()
        if v and not k.startswith("concept:")  # figures keep just their bio
        and ("about" not in v or (k.startswith("album:") and "tracklist" not in v))
    ]
    for k in backfill:
        v = cache[k]
        v.update(fetch_about(v["lang"], v["title"]))
        print(f"  backfilled about: {k} ({len(v['about'])} sections, "
              f"{len(v['tracklist'])} tracks, {len(v['trackNotes'])} notes)")
    if backfill:
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=1)

    for cid, wiki_title in FIGURE_TITLES.items():
        node_id = f"concept:{cid}"
        if node_id in cache and not args.refetch:
            continue
        cache[node_id] = lookup_figure(wiki_title) or {}
        print(f"  figure {'ok' if cache[node_id] else '—'}  {wiki_title}")

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
