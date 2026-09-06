#!/usr/bin/env python3
"""
Capa Atlas — Phase 1: harvest Caparezza's lyrics annotations (the keywords).

Verified pipeline (no Genius API token required):
  https://genius.com/api/artists/{artist_id}/songs?per_page=50&page=N   -> song list
  https://genius.com/{song_slug}-lyrics                                 -> embedded referent ids + song meta
  https://genius.com/api/referents/{id}?text_format=plain               -> fragment (keyword) + annotation

Usage:
  python scripts/fetch_capa.py --seed                  harvest the demo seed songs (default)
  python scripts/fetch_capa.py --all                   harvest every song on the artist page (~367)
  python scripts/fetch_capa.py --limit 25              harvest first N songs (by artist-list order)
  python scripts/fetch_capa.py --max-referents 15      cap referents fetched per song (testing)

Output: data/raw/referents.jsonl (one JSON object per line, resumable)
"""

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request

ARTIST_ID = 24580  # Caparezza
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
BASE = "https://genius.com"

# Demo seed: (title, song page slug on the lyrics URL)
SEED = [
    ("Una Chiave", "Caparezza-una-chiave-lyrics"),
    ("Mica Van Gogh", "Caparezza-mica-van-gogh-lyrics"),
    ("Fuori dal tunnel", "Caparezza-fuori-dal-tunnel-lyrics"),
    ("La legge dell'ortica", "Caparezza-la-legge-dellortica-lyrics"),
    ("Exuvia", "Caparezza-exuvia-lyrics"),
]

STATE_RE = re.compile(r"__PRELOADED_STATE__ = JSON\.parse\('(.*?)'\)", re.S)


def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    })
    last_err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                return resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (429, 403, 500, 502, 503):
                last_err = f"HTTP {e.code}"
                time.sleep(2 + attempt * 2 + random.random())
                continue
            raise
        except urllib.error.URLError as e:
            last_err = str(e)
            time.sleep(1.5)
        except TimeoutError:
            last_err = "timeout"
            time.sleep(1.5)
    raise RuntimeError(f"giving up on {url}: {last_err}")


def parse_preloaded(html: str) -> dict | None:
    m = STATE_RE.search(html)
    if not m:
        return None
    s = m.group(1)
    s = s.replace(r"\/", "/").replace("\\'", "'")
    s = s.encode("utf-8").decode("unicode_escape")
    try:
        return json.loads(s)
    except json.JSONDecodeError as e:
        print(f"    [warn] preloaded state parse failed: {e}", file=sys.stderr)
        return None


def song_urls_to_crawl(args: argparse.Namespace):
    """Yield (song_id, lyrics_url) to crawl."""
    if args.seed:
        for _title, slug in SEED:
            yield slug.replace("-lyrics", ""), f"{BASE}/{slug}"
        return
    page = 1
    seen = 0
    while True:
        url = f"{BASE}/api/artists/{ARTIST_ID}/songs?per_page=50&page={page}"
        data = json.loads(http_get(url))
        songs = data["response"]["songs"]
        for s in songs:
            if args.limit and seen >= args.limit:
                return
            seen += 1
            yield str(s["id"]), s["url"]
        nxt = data["response"].get("next_page")
        if not nxt or not songs:
            return
        page = nxt
        time.sleep(0.3)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", action="store_true", help="harvest the demo seed songs (default)")
    ap.add_argument("--all", action="store_true", help="harvest every song on the artist page")
    ap.add_argument("--limit", type=int, default=0, help="cap songs per run (for testing)")
    ap.add_argument("--max-referents", type=int, default=0, help="cap referents per song")
    ap.add_argument("--out", default="data/raw", help="output dir")
    ap.add_argument("--sleep", type=float, default=0.35, help="base delay between requests")
    args = ap.parse_args()
    if args.all:
        args.seed = False

    out_dir = args.out
    os.makedirs(out_dir, exist_ok=True)
    jsonl_path = os.path.join(out_dir, "referents.jsonl")
    done_path = os.path.join(out_dir, "done_ids.json")

    done = set()
    if os.path.exists(done_path):
        done = set(json.load(open(done_path)))

    out = open(jsonl_path, "a", encoding="utf-8")
    harvested = skipped = 0

    for sid, lyrics_url in song_urls_to_crawl(args):
        if sid in done:
            continue
        time.sleep(args.sleep + random.random() * 0.15)
        try:
            html = http_get(lyrics_url)
        except RuntimeError as e:
            print(f"[skip] {sid} {e}")
            continue
        state = parse_preloaded(html)
        if not state:
            print(f"[skip] {sid}: no preloaded state (removed lyrics or bot-blocked)")
            done.add(sid)
            continue

        song_id = str(state.get("songPage", {}).get("song") or sid)
        songs_map = state.get("entities", {}).get("songs") or {}
        song = songs_map.get(song_id)
        if not isinstance(song, dict):  # some entity values are bare id ints
            try:
                num = int(song_id)
            except ValueError:
                num = None
            song = next(
                (v for v in songs_map.values()
                 if isinstance(v, dict) and num is not None and v.get("id") == num),
                {})
        album = song.get("album") if isinstance(song, dict) else None
        albums_map = state.get("entities", {}).get("albums") or {}
        album_name = None
        if isinstance(album, dict):
            album_name = album.get("name")
        elif isinstance(album, int) or (isinstance(album, str) and album.isdigit()):
            a = albums_map.get(str(album))
            if isinstance(a, dict):
                album_name = a.get("name")
        meta = {
            "songId": song_id,
            "songTitle": song.get("title") or song_id,
            "songUrl": song.get("url") or lyrics_url,
            "songAlbum": album_name or (song.get("album_name") if isinstance(song, dict) else None),
            "songRelease": song.get("releaseDateForDisplay") or song.get("releaseDate"),
            "songArt": song.get("songArtImageUrl") or song.get("headerImageUrl"),
        }

        ref_ids = (state.get("songPage", {})
                   .get("lyricsData", {}).get("referents") or [])
        if args.max_referents:
            ref_ids = ref_ids[:args.max_referents]

        n_kept = 0
        for rid in ref_ids:
            time.sleep(args.sleep + random.random() * 0.15)
            try:
                payload = json.loads(http_get(
                    f"{BASE}/api/referents/{rid}?text_format=plain"))
            except RuntimeError as e:
                print(f"    [warn] referent {rid}: {e}")
                continue
            ref = payload.get("response", {}).get("referent") or {}
            fragment = ref.get("fragment")
            annotations = ref.get("annotations") or []
            if not fragment or not annotations:
                continue
            ann = annotations[0]
            rec = {
                **meta,
                "referentId": rid,
                "fragment": fragment,
                "annotation": (ann.get("body") or {}).get("plain") or "",
                "annotationMarkdown": (ann.get("body") or {}).get("markdown") or "",
                "referentUrl": ref.get("url"),
                "verified": bool(ann.get("verified")),
                "createdAt": ann.get("createdAt"),
                "authors": [a.get("user") for a in (ann.get("authors") or [])],
            }
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            n_kept += 1
        out.flush()
        harvested += 1
        print(f"[ok] {meta['songTitle']:<24} {len(ref_ids):>3} referents, kept {n_kept}")
        done.add(sid)
        with open(done_path, "w") as f:
            json.dump(sorted(done), f)

    out.close()
    print(f"\nDone: {harvested} songs harvested, {skipped} skipped, "
          f"{len(done)} total done. → {jsonl_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())