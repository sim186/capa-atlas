#!/usr/bin/env python3
"""
Capa Atlas — Phase 2: build public/graphData.json from data/raw/referents.jsonl.

Node types:
  album    (group: album)    one per album
  song     (group: song)     one per song, carries `quoteCount` + `quotesFile`; the quotes
                              themselves are in public/quotes/<n>.json and are
                              shown in the sidebar, not as graph nodes
  figure / concept           from data/concepts.json classification

Links:
  song → album              (kind: on)
  song → figure/concept     (kind: refers)   [collapsed from per-quote
                             classification: one edge per song per concept,
                             weighted by how many quotes support it]
  figure/concept → figure/concept  (kind: co_occurs)  [two concepts/figures
                             that surface in the same song — densifies the
                             thematic layer now that quotes aren't nodes]
  album → figure/concept    (kind: album_refers)  [how many songs of the album
                             cite it; lets the overview connect albums to
                             themes with the songs hidden]

Also writes data/keywords.csv for spreadsheet-friendly browsing.

Album/song nodes additionally carry a `description`/`descriptionUrl` when
data/wikipedia.json (built by scripts/fetch_wikipedia.py) has an entry for
that node id — most tracks won't, only singles/albums with their own page.
An album page's per-track commentary ("Brani") goes to the songs it
describes, not the album; the album carries `tracks`, its track list in disc
order, each linked to its song node when the song is in the graph.
Album nodes (and the songs on them) also carry `cover`/`coverSource`/
`coverSourceUrl` from data/covers.json (scripts/fetch_images.py) — URLs only,
the artwork itself is never stored in the repo.
Song nodes carry `youtube` ({id, kind}) from data/youtube.json
(scripts/fetch_youtube.py) when Caparezza's channel has an upload for them.
"""

import csv
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "referents.jsonl")
CONCEPTS = os.path.join(ROOT, "data", "concepts.json")
REFERENT_OVERRIDES_PATH = os.path.join(ROOT, "data", "referent_overrides.json")
WIKIPEDIA_PATH = os.path.join(ROOT, "data", "wikipedia.json")
COVERS_PATH = os.path.join(ROOT, "data", "covers.json")
YOUTUBE_PATH = os.path.join(ROOT, "data", "youtube.json")
OUT = os.path.join(ROOT, "public", "graphData.json")
QUOTES_DIR = os.path.join(ROOT, "public", "quotes")
CSV_OUT = os.path.join(ROOT, "data", "keywords.csv")


def load_referents():
    if not os.path.exists(RAW):
        print("No data yet — run: python scripts/fetch_capa.py --seed")
        sys.exit(1)
    with open(RAW, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def load_wikipedia() -> dict[str, dict]:
    """node id -> {title, extract, url, lang}, built by fetch_wikipedia.py.
    Missing entries (and entries fetch_wikipedia.py couldn't confirm) are {}."""
    if not os.path.exists(WIKIPEDIA_PATH):
        return {}
    with open(WIKIPEDIA_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_covers() -> dict[str, dict]:
    """album node id -> {url, source, sourceUrl}, built by fetch_images.py.
    Albums without a known cover are {}."""
    if not os.path.exists(COVERS_PATH):
        return {}
    with open(COVERS_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_youtube() -> dict[str, dict]:
    """song node id -> {id, kind, title}, built by fetch_youtube.py."""
    if not os.path.exists(YOUTUBE_PATH):
        return {}
    with open(YOUTUBE_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_referent_overrides() -> dict[int, list[str]]:
    """Per-keyword concept assignments from a manual LLM semantic read of the
    corpus (paraphrases/one-offs regex can't catch). Keyed by referentId."""
    if not os.path.exists(REFERENT_OVERRIDES_PATH):
        return {}
    with open(REFERENT_OVERRIDES_PATH, encoding="utf-8") as f:
        return {int(k): v for k, v in json.load(f).items()}


# Whole-song semantic overrides: songs read in full where the allegory (not
# literal keyword matches) makes the theme unambiguous — e.g. "Gli insetti del
# podere" is a sustained animal-metaphor satire of Berlusconi ("il ragno")
# that a regex on the word "berlusconi" would mostly miss.
SONG_OVERRIDES: dict[str, list[str]] = {
    "Gli insetti del podere": ["berlusconi", "polizia_proteste"],
    "Gli Arbitri Ti Picchiano": ["polizia_proteste"],
    "Abiura Di Me": ["videogiochi"],
    "La Marchetta Di Popolino": ["fumetti"],
    "Limiti": ["nostalgia_anni80"],
    "La sindrome di Lorena": ["violenza_di_genere"],
    "Non Siete Stato Voi": ["stato_e_potere"],
    "Titoli": ["finanza"],
}


def classify(fragment: str, annotation: str, song_title: str, concepts: list[dict]) -> list[str]:
    hay = f"{fragment}\n{annotation}".casefold()
    hits = []
    for c in concepts:
        for pat in c["patterns"]:
            if re.search(pat, hay):
                hits.append(c["id"])
                break
    for cid in SONG_OVERRIDES.get(song_title, []):
        if cid not in hits:
            hits.append(cid)
    return hits


def title_key(title: str) -> str:
    """Loose song-title identity across Genius and Wikipedia: no
    parentheticals (feat., subtitles), accents, case or punctuation. Spaces
    stay: "Prosopagnosia" and "Prosopagno sia!" are two different tracks."""
    title = re.sub(r"\([^)]*\)", "", title)
    title = unicodedata.normalize("NFKD", title.casefold())
    title = "".join(ch if ch.isalnum() or ch.isspace() else "" for ch in title)
    return " ".join(title.split())


def note_targets(note_title: str, by_key: dict[str, dict]) -> list[dict]:
    """Songs a per-track sub-heading names: one title, or a pair such as
    "Nessun dorma e Tutti dormano"."""
    whole = by_key.get(title_key(note_title))
    if whole:
        return [whole]
    parts = re.split(r"\s+e\s+|\s*/\s*|,\s*", note_title)
    return [by_key[k] for k in map(title_key, parts) if k in by_key]


def paragraph_target(paragraph: str, by_key: dict[str, dict]) -> dict | None:
    """The song a paragraph opens on, when a section has no per-track
    sub-headings ("In Annunciatemi al pubblico Caparezza ...")."""
    head = title_key(paragraph[:90])
    found = [(head.find(k), song) for k, song in by_key.items() if len(k) > 3 and k in head]
    found = [entry for entry in found if entry[0] <= 6]  # "In ", "Il brano ", ...
    return min(found, key=lambda entry: entry[0])[1] if found else None


def attach_tracks(album: dict, entry: dict, album_songs: list[dict]) -> None:
    """Move the album page's per-track commentary onto its songs and give the
    album its track list."""
    by_key = {title_key(song["label"]): song for song in album_songs}
    notes: dict[str, list[str]] = {}
    for note in entry.get("trackNotes", []):
        if note["title"]:
            for song in note_targets(note["title"], by_key):
                notes.setdefault(song["id"], []).append(note["text"])
            continue
        last = None
        for paragraph in filter(None, (p.strip() for p in note["text"].split("\n"))):
            last = paragraph_target(paragraph, by_key) or last
            if last:
                notes.setdefault(last["id"], []).append(paragraph)
    for song in album_songs:
        if song["id"] not in notes or song.get("about"):
            continue  # a song with its own page already says what it is about
        song["about"] = [{"heading": "Il brano", "text": "\n".join(notes[song["id"]])}]
        if entry.get("url") and not song.get("descriptionUrl"):
            song["descriptionUrl"] = entry["url"]

    tracks, seen = [], set()
    for title in entry.get("tracklist", []):
        key = title_key(title)
        if key in seen:
            continue
        seen.add(key)
        song = by_key.get(key)
        tracks.append({"label": song["label"] if song else re.sub(r"\s*\((?:feat|con)\.? [^)]*\)", "", title)}
                      | ({"id": song["id"]} if song else {}))
    # songs Wikipedia doesn't list (bonus tracks, or no page at all)
    for song in sorted(album_songs, key=lambda song: song["label"].casefold()):
        if title_key(song["label"]) not in seen:
            tracks.append({"label": song["label"], "id": song["id"]})
    if tracks:
        album["tracks"] = tracks


def clean(label: str, maxlen: int = 46) -> str:
    return " ".join(label.split())[:maxlen]


def usage_line(node: dict, songs_cited: list[tuple[dict, int]]) -> str:
    """One factual sentence for a concept/figure node, derived from the graph:
    how many songs touch it, on which albums, over which years, and the song
    where it weighs most. `songs_cited` is [(song node, quote count)]."""
    n = len(songs_cited)
    verb = "Citato" if node["group"] == "figure" else "Ricorre"
    parts = [f"{verb} in {n} {'canzone' if n == 1 else 'canzoni'}"]
    per_album: dict[str, int] = {}
    for song, _ in songs_cited:
        if song["album"] != "Singoli / altro":
            per_album[song["album"]] = per_album.get(song["album"], 0) + 1
    # a single song on an album isn't a pattern — only name albums with 2+
    top = [kv for kv in sorted(per_album.items(), key=lambda kv: (-kv[1], kv[0]))[:2] if kv[1] > 1]
    if top:
        parts[0] += ", soprattutto in " + " e ".join(f"{a} ({c})" for a, c in top)
    years = sorted(int(m.group()) for song, _ in songs_cited
                   if (m := re.search(r"\d{4}", song.get("release") or "")))
    if years:
        parts.append(f"Dal {years[0]}" + (f" al {years[-1]}" if years[-1] != years[0] else ""))
    strongest = max(songs_cited, key=lambda sc: (sc[1], sc[0]["label"]))
    if n > 1 and strongest[1] > 1:
        parts.append(f"Presenza più forte: «{strongest[0]['label']}»")
    return ". ".join(parts) + "."


def main() -> int:
    refs = load_referents()
    concepts = json.load(open(CONCEPTS, encoding="utf-8"))["concepts"]
    concept_by_id = {c["id"]: c for c in concepts}
    referent_overrides = load_referent_overrides()
    wikipedia = load_wikipedia()
    covers = load_covers()
    youtube = load_youtube()

    albums: dict[str, dict] = {}
    songs: dict[str, dict] = {}
    concepts_final: dict[str, dict] = {}
    links: list[dict] = []
    seen_kw: set[tuple[str, str]] = set()  # (songId, fragment) de-dup
    # song_id -> concept_node_id -> quote count (for weighting + co-occurrence)
    song_concepts: dict[str, dict[str, int]] = {}

    for r in refs:
        song_id, fragment = f"song:{r['songId']}", r["fragment"]
        album_name = r.get("songAlbum") or "Singoli / altro"

        album = albums.setdefault(album_name, {
            "id": f"album:{album_name}", "label": album_name, "group": "album", "val": 1,
        })
        song = songs.get(song_id)
        if song is None:
            song = {
                "id": song_id, "label": r["songTitle"], "group": "song", "val": 1,
                "album": album_name, "release": r.get("songRelease"),
                "url": r.get("songUrl"), "art": r.get("songArt"), "quotes": [],
            }
            songs[song_id] = song
            links.append({"source": song["id"], "target": album["id"], "kind": "on"})

        key = (song_id, fragment.strip())
        if key in seen_kw:
            continue
        seen_kw.add(key)
        song["quotes"].append({
            "fragment": clean(fragment, 200),
            "annotation": r["annotation"],
            "url": r.get("referentUrl"),
        })

        cids = classify(fragment, r["annotation"], r["songTitle"], concepts)
        for cid in referent_overrides.get(r["referentId"], []):
            if cid not in cids:
                cids.append(cid)
        song_cids = song_concepts.setdefault(song_id, {})
        for cid in cids:
            c = concept_by_id[cid]
            node_id = f"concept:{cid}"
            concepts_final.setdefault(node_id, {
                "id": node_id, "label": c["label"], "group": c["group"], "val": 1,
            })
            song_cids[node_id] = song_cids.get(node_id, 0) + 1

    # Collapse per-quote classification into one song → concept/figure edge
    # per pair, weighted by how many quotes in that song support it, plus a
    # co-occurrence edge between every pair of concepts/figures sharing a
    # song — this is the density the graph loses now that quotes aren't
    # individual nodes threading songs to themes.
    # Pairs that co-occur in fewer than CO_OCCURS_MIN songs are pruned:
    # single-song pairs are mostly noise, and popular themes otherwise form
    # near-cliques that turn the thematic layer into an unreadable hairball.
    co_occurs_min = int(os.environ.get("CO_OCCURS_MIN", "3"))
    co_occurs: dict[tuple[str, str], int] = {}
    for song_id, cids in song_concepts.items():
        for node_id, weight in cids.items():
            links.append({
                "source": song_id, "target": node_id, "kind": "refers", "weight": weight,
            })
        ordered = sorted(cids)
        for i, a in enumerate(ordered):
            for b in ordered[i + 1:]:
                pair = (a, b)
                co_occurs[pair] = co_occurs.get(pair, 0) + 1
    for (a, b), weight in co_occurs.items():
        if weight < co_occurs_min:
            continue
        links.append({"source": a, "target": b, "kind": "co_occurs", "weight": weight})

    # Album → concept/figure: number of the album's songs that cite it. Pairs
    # backed by a single song are pruned, same reasoning as co_occurs.
    album_refers_min = int(os.environ.get("ALBUM_REFERS_MIN", "2"))
    album_refers: dict[tuple[str, str], int] = {}
    for song_id, cids in song_concepts.items():
        album_id = f"album:{songs[song_id]['album']}"
        for node_id in cids:
            pair = (album_id, node_id)
            album_refers[pair] = album_refers.get(pair, 0) + 1
    for (album_id, node_id), weight in album_refers.items():
        if weight < album_refers_min:
            continue
        links.append({
            "source": album_id, "target": node_id, "kind": "album_refers", "weight": weight,
        })

    for node in list(albums.values()) + list(songs.values()):
        entry = wikipedia.get(node["id"])
        if entry:
            node["description"] = entry["extract"]
            if entry.get("about"):
                node["about"] = entry["about"]
            if entry.get("url"):
                node["descriptionUrl"] = entry["url"]

    for album_name, album in albums.items():
        if album_name == "Singoli / altro":
            continue
        album_songs = [song for song in songs.values() if song["album"] == album_name]
        attach_tracks(album, wikipedia.get(album["id"]) or {}, album_songs)

    for node in list(albums.values()) + list(songs.values()):
        album_id = node["id"] if node["group"] == "album" else f"album:{node.get('album')}"
        cover = covers.get(album_id)
        if cover:
            node["cover"] = cover["url"]
            node["coverSource"] = cover["source"]
            if cover.get("sourceUrl"):
                node["coverSourceUrl"] = cover["sourceUrl"]

    for song in songs.values():
        video = youtube.get(song["id"])
        if video:
            song["youtube"] = {"id": video["id"], "kind": video["kind"]}

    # concept/figure nodes: computed usage line, Wikipedia bio for figures,
    # and the hand-written `blurb` from data/concepts.json when present.
    cited_by: dict[str, list[tuple[dict, int]]] = {}
    for song_id, cids in song_concepts.items():
        for node_id, weight in cids.items():
            cited_by.setdefault(node_id, []).append((songs[song_id], weight))
    for node_id, node in concepts_final.items():
        if node_id in cited_by:
            node["description"] = usage_line(node, cited_by[node_id])
        blurb = concept_by_id[node_id.split(":", 1)[1]].get("blurb")
        if blurb:
            node["blurb"] = blurb
        bio = wikipedia.get(node_id)
        if bio:
            node["bio"] = bio["extract"]
            if bio.get("url"):
                node["bioUrl"] = bio["url"]

    nodes = list(albums.values()) + list(songs.values()) + list(concepts_final.values())

    # degree-based sizing
    degree: dict[str, int] = {}
    for l in links:
        degree[l["source"]] = degree.get(l["source"], 0) + 1
        degree[l["target"]] = degree.get(l["target"], 0) + 1
    for n in nodes:
        n["val"] = 1 + min(8, degree.get(n["id"], 0) ** 0.7)

    # Quotes are ~90% of the payload and only matter once a song is open, so
    # they live in one small file per song (public/quotes/<n>.json) that the
    # detail panel fetches on demand. The graph keeps just the count + file.
    if os.path.isdir(QUOTES_DIR):
        for stale in os.listdir(QUOTES_DIR):
            if stale.endswith(".json"):
                os.remove(os.path.join(QUOTES_DIR, stale))
    os.makedirs(QUOTES_DIR, exist_ok=True)
    for i, song in enumerate(songs.values()):
        quotes = song.pop("quotes")
        if not quotes:
            continue
        song["quoteCount"] = len(quotes)
        song["quotesFile"] = f"{i}.json"
        with open(os.path.join(QUOTES_DIR, song["quotesFile"]), "w", encoding="utf-8") as f:
            json.dump(quotes, f, ensure_ascii=False, separators=(",", ":"))

    graph = {"nodes": nodes, "links": links}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, separators=(",", ":"))

    with open(CSV_OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["song", "album", "keyword", "annotation", "url"])
        for r in refs:
            w.writerow([r["songTitle"], r.get("songAlbum") or "",
                        clean(r["fragment"], 80),
                        " ".join(r["annotation"].split())[:200],
                        r.get("referentUrl") or ""])

    counts: dict[str, int] = {}
    for n in nodes:
        counts[n["group"]] = counts.get(n["group"], 0) + 1
    print(f"nodes: {len(nodes)} ({', '.join(f'{k}={v}' for k, v in counts.items())})")
    print(f"links: {len(links)}  → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())