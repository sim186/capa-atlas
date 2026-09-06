#!/usr/bin/env python3
"""
Capa Atlas — Phase 2: build public/graphData.json from data/raw/referents.jsonl.

Node types:
  album    (group: album)    one per album
  song     (group: song)     one per song
  keyword  (group: keyword)  one per unique fragment (the Genius highlight)
  figure / concept           from data/concepts.json classification

Links:
  song → album     (kind: on)
  song → keyword   (kind: contains)
  keyword → figure/concept  (kind: refers)   [first-match classification]

Also writes data/keywords.csv for spreadsheet-friendly browsing.
"""

import csv
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "referents.jsonl")
CONCEPTS = os.path.join(ROOT, "data", "concepts.json")
REFERENT_OVERRIDES_PATH = os.path.join(ROOT, "data", "referent_overrides.json")
OUT = os.path.join(ROOT, "public", "graphData.json")
CSV_OUT = os.path.join(ROOT, "data", "keywords.csv")


def load_referents():
    if not os.path.exists(RAW):
        print("No data yet — run: python scripts/fetch_capa.py --seed")
        sys.exit(1)
    with open(RAW, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


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


def clean(label: str, maxlen: int = 46) -> str:
    return " ".join(label.split())[:maxlen]


def main() -> int:
    refs = load_referents()
    concepts = json.load(open(CONCEPTS, encoding="utf-8"))["concepts"]
    concept_by_id = {c["id"]: c for c in concepts}
    referent_overrides = load_referent_overrides()

    albums: dict[str, dict] = {}
    songs: dict[str, dict] = {}
    keywords: dict[str, dict] = {}
    concepts_final: dict[str, dict] = {}
    links: list[dict] = []
    seen_kw: set[tuple[str, str]] = set()  # (songId, fragment) de-dup

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
                "url": r.get("songUrl"), "art": r.get("songArt"),
            }
            songs[song_id] = song
            links.append({"source": song["id"], "target": album["id"], "kind": "on"})

        key = (song_id, fragment.strip())
        if key in seen_kw:
            continue
        seen_kw.add(key)
        kw_id = f"kw:{r['referentId']}"
        keyword = keywords.setdefault(kw_id, {
            "id": kw_id, "label": clean(fragment), "group": "keyword", "val": 1,
            "fragment": fragment, "annotation": r["annotation"],
            "url": r.get("referentUrl"), "song": r["songTitle"],
        })
        links.append({"source": song["id"], "target": keyword["id"], "kind": "contains"})

        cids = classify(fragment, r["annotation"], r["songTitle"], concepts)
        for cid in referent_overrides.get(r["referentId"], []):
            if cid not in cids:
                cids.append(cid)
        for cid in cids:
            c = concept_by_id[cid]
            node_id = f"concept:{cid}"
            concepts_final.setdefault(node_id, {
                "id": node_id, "label": c["label"], "group": c["group"], "val": 1,
            })
            links.append({"source": keyword["id"], "target": node_id, "kind": "refers"})

    nodes = (list(albums.values()) + list(songs.values())
             + list(keywords.values()) + list(concepts_final.values()))

    # degree-based sizing
    degree: dict[str, int] = {}
    for l in links:
        degree[l["source"]] = degree.get(l["source"], 0) + 1
        degree[l["target"]] = degree.get(l["target"], 0) + 1
    for n in nodes:
        n["val"] = 1 + min(8, degree.get(n["id"], 0) ** 0.7)

    graph = {"nodes": nodes, "links": links}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, indent=1)

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