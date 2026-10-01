#!/usr/bin/env python3
"""
Capa Atlas — images: portraits of Caparezza (background) and album covers
(thumbnail in the album/song detail panel).

Portraits come from Wikimedia Commons (Category:Caparezza), restricted to
freely licensed files (public domain / CC BY / CC BY-SA) wide enough to be
used full-bleed. They are downloaded to public/portraits/ and described, with
author and licence, in data/portraits.json — the licences require crediting
the author, and AboutPanel renders that file.

Album covers are NOT freely licensed. They are never downloaded or committed:
we only store a URL (Cover Art Archive via MusicBrainz, iTunes as a fallback)
in data/covers.json, and the browser loads the image straight from there.

Usage:
  python scripts/fetch_images.py                 portraits + covers
  python scripts/fetch_images.py --portraits     portraits only
  python scripts/fetch_images.py --covers        covers only
  python scripts/fetch_images.py --max 8         keep at most N portraits

Reads:  data/raw/referents.jsonl (album names)
Writes: data/portraits.json, public/portraits/*.jpg, data/covers.json
"""

import argparse
import html
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
PORTRAITS_JSON = os.path.join(ROOT, "data", "portraits.json")
PORTRAITS_DIR = os.path.join(ROOT, "public", "portraits")
COVERS_JSON = os.path.join(ROOT, "data", "covers.json")

UA = "capa-atlas/1.0 (https://github.com/; personal fan project)"
COMMONS = "https://commons.wikimedia.org/w/api.php"
MB = "https://musicbrainz.org/ws/2/release-group/"
CAA = "https://coverartarchive.org/release-group/{id}/front-500"
ITUNES = "https://itunes.apple.com/search"

MIN_WIDTH = 1000
# Hand-picked after eyeballing the category: close enough to read as a
# face/figure behind the graph. When non-empty only these (in this order) are
# kept; clear it to fall back to "biggest frame per shoot".
PICKS = [
    "Caparezza live @ Koko, London 12 10 2014 (15528942992).jpg",
    "Caparezza.jpg",
    "Caparezza live @ Koko, London 12 10 2014 (14908207664).jpg",
    "Caparezza live @ Koko, London 12 10 2014 (15342885610).jpg",
]
FREE_LICENSE = re.compile(r"^(public domain|cc[ -]by(-sa)?\b|cc0)", re.IGNORECASE)


def request(url: str, params: dict | None = None, method: str = "GET"):
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA}, method=method)
    last_err = None
    for attempt in range(4):
        try:
            return urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last_err = e
            time.sleep(2 + attempt * 3 if e.code in (429, 503) else 1 + attempt)
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            time.sleep(1 + attempt)
    print(f"  ! giving up on {url}: {last_err}", file=sys.stderr)
    return None


def get_json(url: str, params: dict | None = None) -> dict:
    resp = request(url, params)
    if resp is None:
        return {}
    with resp:
        return json.loads(resp.read().decode("utf-8"))


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


# --- portraits -------------------------------------------------------------


def burst_key(title: str) -> str:
    """Photos from one shoot share a name up to a trailing id/counter, e.g.
    "Caparezza live @ Koko, London 12 10 2014 (149082...)". Collapse them so
    the pick is varied instead of 40 frames of the same gig."""
    t = re.sub(r"\.\w+$", "", title.removeprefix("File:"))
    t = re.sub(r"\s*\(\d{6,}\).*$", "", t)
    t = re.sub(r"[\s-]*\d{1,3}\s*[a-z]?$", "", t)
    return t.strip().casefold()


def fetch_portraits(max_keep: int) -> None:
    params = {
        "action": "query",
        "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
        "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist",
        "iiurlwidth": 1800, "format": "json",
    }
    if PICKS:
        params["titles"] = "|".join(f"File:{t}" for t in PICKS)
    else:
        params.update({"generator": "categorymembers", "gcmtitle": "Category:Caparezza",
                       "gcmtype": "file", "gcmlimit": 100})
    # imageinfo comes back a few files at a time; follow `continue` to get all
    pages: dict[str, dict] = {}
    while True:
        data = get_json(COMMONS, params)
        for pid, page in data.get("query", {}).get("pages", {}).items():
            pages.setdefault(pid, page).setdefault("imageinfo", page.get("imageinfo", []))
        if "continue" not in data:
            break
        params.update(data["continue"])
        time.sleep(1)
    data = {"query": {"pages": pages}}
    candidates = []
    for page in data.get("query", {}).get("pages", {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        license_name = meta.get("LicenseShortName", {}).get("value", "")
        if info.get("mime") != "image/jpeg" or info.get("width", 0) < MIN_WIDTH:
            continue
        if not FREE_LICENSE.match(license_name):
            continue
        candidates.append({
            "title": page["title"],
            "page": f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(page['title'].replace(' ', '_'))}",
            "src": info.get("thumburl") or info["url"],
            "width": info["width"],
            "height": info["height"],
            "author": strip_tags(meta.get("Artist", {}).get("value", "")) or "Autore sconosciuto",
            "license": license_name,
            "licenseUrl": meta.get("LicenseUrl", {}).get("value"),
        })

    # one frame per shoot, biggest first, then keep the top N
    by_shoot: dict[str, dict] = {}
    for c in sorted(candidates, key=lambda c: -c["width"] * c["height"]):
        by_shoot.setdefault(burst_key(c["title"]), c)
    picked = list(by_shoot.values())[:max_keep]
    if PICKS:
        by_title = {c["title"].removeprefix("File:"): c for c in candidates}
        picked = [by_title[t] for t in PICKS if t in by_title]

    os.makedirs(PORTRAITS_DIR, exist_ok=True)
    out = []
    for i, c in enumerate(picked):
        slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", c["title"].removeprefix("File:").rsplit(".", 1)[0]).encode("ascii", "ignore").decode().lower()).strip("-")
        name = f"{slug}.jpg"
        path = os.path.join(PORTRAITS_DIR, name)
        if not os.path.exists(path):
            resp = request(c["src"])
            if resp is None:
                continue
            with resp, open(path, "wb") as f:
                f.write(resp.read())
            time.sleep(1)
        out.append({
            "file": f"/portraits/{name}",
            "title": c["title"].removeprefix("File:"),
            "page": c["page"], "author": c["author"],
            "license": c["license"], "licenseUrl": c["licenseUrl"],
            "width": c["width"], "height": c["height"],
        })
        print(f"[{i + 1}/{len(picked)}] {c['license']:<12} {c['width']}x{c['height']}  {name}")

    if not out:
        print("no portraits fetched (rate limited? retry in a minute) — keeping existing file", file=sys.stderr)
        sys.exit(1)
    with open(PORTRAITS_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"done: {len(out)} portraits → {PORTRAITS_JSON}")


# --- album covers ----------------------------------------------------------


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def album_names() -> list[str]:
    if not os.path.exists(RAW):
        print("No data yet — run: python scripts/fetch_capa.py --seed")
        sys.exit(1)
    names: set[str] = set()
    with open(RAW, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                name = (json.loads(line).get("songAlbum") or "").strip()
                if name and name != "Singoli / altro":
                    names.add(name)
    return sorted(names)


def musicbrainz_groups() -> dict[str, str]:
    """normalized title -> release-group id, studio albums first."""
    groups: dict[str, str] = {}
    data = get_json(MB, {"query": "artist:Caparezza AND primarytype:album", "fmt": "json", "limit": 100})
    for g in data.get("release-groups", []):
        if g.get("secondary-types"):  # skip live / compilation / soundtrack editions
            continue
        groups.setdefault(normalize(g["title"]), g["id"])
    return groups


def itunes_cover(name: str) -> str | None:
    data = get_json(ITUNES, {"term": f"Caparezza {name}", "entity": "album", "limit": 5, "country": "it"})
    for r in data.get("results", []):
        if "caparezza" in normalize(r.get("artistName", "")) and normalize(r.get("collectionName", "")).startswith(normalize(name)):
            return r["artworkUrl100"].replace("100x100bb", "600x600bb")
    return None


def fetch_covers() -> None:
    groups = musicbrainz_groups()
    time.sleep(1.1)
    out: dict[str, dict] = {}
    for name in album_names():
        cover = None
        gid = groups.get(normalize(name))
        if gid:
            url = CAA.format(id=gid)
            resp = request(url, method="HEAD")
            if resp is not None:
                resp.close()
                cover = {"url": url, "source": "Cover Art Archive", "sourceUrl": f"https://musicbrainz.org/release-group/{gid}"}
            time.sleep(1.1)
        if cover is None:
            art = itunes_cover(name)
            if art:
                cover = {"url": art, "source": "iTunes", "sourceUrl": None}
            time.sleep(1.1)
        out[f"album:{name}"] = cover or {}
        print(f"{'ok' if cover else '—':>3}  {cover['source'] if cover else '':<18} {name}")

    with open(COVERS_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"done: {sum(1 for v in out.values() if v)}/{len(out)} albums have a cover → {COVERS_JSON}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--portraits", action="store_true")
    ap.add_argument("--covers", action="store_true")
    ap.add_argument("--max", type=int, default=8, help="keep at most N portraits")
    args = ap.parse_args()
    both = not (args.portraits or args.covers)
    if both or args.portraits:
        fetch_portraits(args.max)
    if both or args.covers:
        fetch_covers()
    return 0


if __name__ == "__main__":
    sys.exit(main())
