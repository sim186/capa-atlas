#!/usr/bin/env python3
"""
Capa Atlas — official YouTube video for each song.

Only Caparezza's own channel (telecaparezza, which also hosts the label's
auto-generated "art tracks" for every album) is considered, so a link is never
a fan upload or a re-post. For each song the best available upload wins:

  video   official music video
  lyric   official lyric video
  audio   "Official Audio" upload, or the album's art track

Live recordings, backstage/making-of clips, teasers and spots are ignored.
Songs with no match get no entry; MANUAL pins the few titles the matcher
can't resolve on its own.

Needs yt-dlp — on PATH, or run through uvx (tried automatically).

Usage:
  python scripts/fetch_youtube.py

Reads:  public/graphData.json (song nodes)
Writes: data/youtube.json   song node id -> {id, kind, title}
"""

import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRAPH = os.path.join(ROOT, "public", "graphData.json")
OUT = os.path.join(ROOT, "data", "youtube.json")

CHANNEL = "https://www.youtube.com/channel/UCn4UDdM2G-_soVW6B7WbEyw"
RANK = {"video": 0, "lyric": 1, "audio": 2}
SKIP = re.compile(
    r"\blive\b|backstage|teaser|making of|spot\b|coming soon|episodio|tour\b|intervista|uncensored|\blp\b",
    re.IGNORECASE,
)
# A song label carrying one of these is a different recording than the album
# cut, so it only matches an upload whose full title (parentheticals and all)
# is the same — in practice its own art track.
VARIANT = re.compile(r"demo|live|remix", re.IGNORECASE)

# song label -> video id, for uploads that cover more than one song or are
# titled too loosely to match.
MANUAL: dict[str, tuple[str, str]] = {
    "Canzone all’entrata": ("h_coqpV0zDM", "video"),
    "Canzone all’uscita": ("h_coqpV0zDM", "video"),
    # Il Sogno Eretico's own playlist uses this upload as the track.
    "Cose Che Non Capisco": ("6fYDrwBCkJA", "video"),
}


def ytdlp() -> list[str]:
    if shutil.which("yt-dlp"):
        return ["yt-dlp"]
    if shutil.which("uvx"):
        return ["uvx", "yt-dlp"]
    sys.exit("yt-dlp not found — install it (brew install yt-dlp) or uv (for uvx)")


def flat(url: str) -> list[tuple[str, str]]:
    """(id, title) of every entry in a channel tab or playlist."""
    out = subprocess.run(
        ytdlp() + ["--flat-playlist", "--print", "%(id)s\t%(title)s", url],
        capture_output=True, text=True, check=True,
    ).stdout
    return [tuple(line.split("\t", 1)) for line in out.splitlines() if "\t" in line]


def key(title: str, keep_parens: bool = False) -> str:
    """Same loose identity as build_graph.title_key, optionally keeping
    parentheticals so "Mea culpa (Demo)" doesn't collapse onto "Mea culpa"."""
    if not keep_parens:
        title = re.sub(r"\([^)]*\)", "", title)
    title = unicodedata.normalize("NFKD", title.casefold())
    title = "".join(ch for ch in title if not unicodedata.combining(ch))
    # Punctuation splits words: "Dell' Ingiuria" and "dell’ingiuria" agree.
    title = "".join(ch if ch.isalnum() else " " for ch in title)
    return " ".join(title.split())


def song_part(title: str) -> str:
    """Strip the "CAPAREZZA (feat. X) - " prefix, a trailing " - Video Ufficiale"
    style suffix and any trailing feat. credit from an upload title."""
    m = re.match(r"^\s*caparezza\b.*?-\s*(.+)$", title, re.IGNORECASE)
    if m:
        title = m.group(1)
    else:
        title = re.sub(r"^\s*caparezza\b\s*", "", title, flags=re.IGNORECASE)
    title = re.split(r"\s+-\s+", title)[0]
    title = re.sub(r"\s+(feat\.?|ft\.)\s.*$", "", title, flags=re.IGNORECASE)
    return title


def kind_of(title: str) -> str:
    low = title.casefold()
    if "lyric" in low:
        return "lyric"
    if "audio" in low:
        return "audio"
    return "video"


def main() -> int:
    with open(GRAPH, encoding="utf-8") as f:
        songs = [n for n in json.load(f)["nodes"] if n["group"] == "song"]

    # candidates: (loose key, strict key, id, kind, title, album key or None)
    # An art track only stands for songs on its own album: "Intro" on ?! is
    # not the "Intro (Skit)" on Zappa.
    candidates: list[tuple[str, str, str, str, str, str | None]] = []
    print("listing channel videos…", file=sys.stderr)
    for vid, title in flat(f"{CHANNEL}/videos"):
        if SKIP.search(title):
            continue
        part = song_part(title)
        candidates.append((key(part), key(part, True), vid, kind_of(title), title, None))

    print("listing channel releases…", file=sys.stderr)
    for pid, album in flat(f"{CHANNEL}/releases"):
        if SKIP.search(album):
            continue
        for vid, title in flat(f"https://www.youtube.com/playlist?list={pid}"):
            candidates.append(
                (key(title), key(title, True), vid, "audio", f"{title} · {album}", key(album))
            )

    result: dict[str, dict] = {}
    for song in songs:
        label = song["label"]
        if label in MANUAL:
            vid, kind = MANUAL[label]
            result[song["id"]] = {"id": vid, "kind": kind, "title": label}
            continue
        strict = VARIANT.search(label) is not None
        want = key(label, keep_parens=strict)
        best = None
        album = key(song.get("album") or "")
        for loose_k, strict_k, vid, kind, title, release in candidates:
            if (strict_k if strict else loose_k) != want:
                continue
            if release is not None and release != album:
                continue
            if best is None or RANK[kind] < RANK[best[1]]:
                best = (vid, kind, title)
        if best:
            result[song["id"]] = {"id": best[0], "kind": best[1], "title": best[2]}

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")

    counts = {k: sum(1 for v in result.values() if v["kind"] == k) for k in RANK}
    print(f"{len(result)}/{len(songs)} songs matched {counts}", file=sys.stderr)
    missing = sorted(s["label"] for s in songs if s["id"] not in result)
    print("unmatched:", ", ".join(missing), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
