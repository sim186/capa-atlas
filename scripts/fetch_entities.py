#!/usr/bin/env python3
"""
Capa Atlas — Wikipedia pages for the named references in data/entities.json.

data/entities.json holds, per Genius referent, the people, characters, works,
groups, places/events and brands its lyric line alludes to (an LLM read of
every annotation). Each entity carries the it.wiki title the reader proposed,
or null. This script checks those titles against Wikipedia instead of
trusting them: a title only counts if the page exists (after redirects) and
is not a disambiguation page. A title that fails (or a missing one) falls
back to the entity's own name, then to the top search hit for that name,
kept only when the hit's title contains the name (fetch_wikipedia's
same_subject). Redirects matter twice: they fix near-miss titles and they
merge variants ("Gesù" / "Gesù di Nazareth") into one page.

Lookups go through the batch query API (50 titles a request, 20 for
extracts), so the whole corpus takes a few minutes, not hours.

Usage:
  python scripts/fetch_entities.py            fetch missing titles only (resumable)
  python scripts/fetch_entities.py --refetch  re-fetch everything

Reads:  data/entities.json
Writes: data/entity_wiki.json — { "<candidate title>": {title, extract, url,
  en: {title, extract, url}?} } — {} when the candidate has no usable page.
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_wikipedia import REQUEST_DELAY, SEARCH_URL, http_json, same_subject, search_title  # noqa: E402
from fetch_wikipedia_en import clip_bio  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTITIES = os.path.join(ROOT, "data", "entities.json")
OUT = os.path.join(ROOT, "data", "entity_wiki.json")
TITLES_PER_REQUEST = 50
EXTRACTS_PER_REQUEST = 20  # the extracts module's own cap


def candidates(entities: dict[str, list[dict]]) -> dict[str, str]:
    """Every title worth checking (the proposed one, else the entity's name)
    -> the entity name to fall back on."""
    seen: dict[str, str] = {}
    for ents in entities.values():
        for e in ents:
            seen.setdefault(e["wiki"] or e["name"], e["name"])
    return seen


def chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def resolve(lang: str, titles: list[str]) -> dict[str, str]:
    """candidate title -> page title it lands on, for pages that exist and
    are not disambiguations."""
    data = http_json(SEARCH_URL.format(lang=lang), {
        "action": "query", "titles": "|".join(titles), "redirects": 1,
        "prop": "pageprops", "ppprop": "disambiguation", "format": "json",
    })
    time.sleep(REQUEST_DELAY)
    query = data.get("query", {})
    hop = {t: t for t in titles}
    for step in ("normalized", "redirects"):
        moves = {m["from"]: m["to"] for m in query.get(step, [])}
        hop = {t: moves.get(at, at) for t, at in hop.items()}
    good = {
        page["title"] for page in query.get("pages", {}).values()
        if "missing" not in page and "invalid" not in page
        and "disambiguation" not in page.get("pageprops", {})
    }
    return {t: at for t, at in hop.items() if at in good}


def summaries(lang: str, titles: list[str]) -> dict[str, dict]:
    """page title -> {title, extract, url}, the lead cut to a short bio."""
    data = http_json(SEARCH_URL.format(lang=lang), {
        "action": "query", "titles": "|".join(titles), "prop": "extracts|info",
        "exintro": 1, "explaintext": 1, "exlimit": "max", "inprop": "url",
        "format": "json",
    })
    time.sleep(REQUEST_DELAY)
    out = {}
    for page in data.get("query", {}).get("pages", {}).values():
        extract = " ".join(page.get("extract", "").split())
        if extract:
            out[page["title"]] = {
                "title": page["title"], "extract": clip_bio(extract), "url": page.get("fullurl"),
            }
    return out


def english_titles(titles: list[str]) -> dict[str, str]:
    """it.wiki page title -> its en.wiki counterpart, via interlanguage links."""
    data = http_json(SEARCH_URL.format(lang="it"), {
        "action": "query", "titles": "|".join(titles), "prop": "langlinks",
        "lllang": "en", "lllimit": "max", "format": "json",
    })
    time.sleep(REQUEST_DELAY)
    out = {}
    for page in data.get("query", {}).get("pages", {}).values():
        for link in page.get("langlinks", []):
            out[page["title"]] = link["*"]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refetch", action="store_true", help="ignore the existing cache")
    args = ap.parse_args()

    with open(ENTITIES, encoding="utf-8") as f:
        entities = json.load(f)
    cache: dict[str, dict] = {}
    if not args.refetch and os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            cache = json.load(f)
    fallback = candidates(entities)
    todo = [t for t in fallback if t not in cache]
    print(f"{len(cache)} cached, {len(todo)} to fetch")

    landed: dict[str, str] = {}
    for batch in chunks(todo, TITLES_PER_REQUEST):
        landed.update(resolve("it", batch))
    names = {t: fallback[t] for t in todo if t not in landed and fallback[t] != t}
    by_name: dict[str, str] = {}
    for batch in chunks(sorted(set(names.values())), TITLES_PER_REQUEST):
        by_name.update(resolve("it", batch))
    for title, name in names.items():
        if name in by_name:
            landed[title] = by_name[name]
    for title in [t for t in todo if t not in landed]:
        hit = search_title("it", fallback[title])
        time.sleep(REQUEST_DELAY)
        if hit and same_subject(fallback[title], hit):
            landed.update({title: at for at in resolve("it", [hit]).values()})
    print(f"  {len(landed)}/{len(todo)} titles land on a page")
    pages = sorted(set(landed.values()))

    it_pages: dict[str, dict] = {}
    for batch in chunks(pages, EXTRACTS_PER_REQUEST):
        it_pages.update(summaries("it", batch))
    en_title: dict[str, str] = {}
    for batch in chunks(pages, TITLES_PER_REQUEST):
        en_title.update(english_titles(batch))
    en_pages: dict[str, dict] = {}
    for batch in chunks(sorted(set(en_title.values())), EXTRACTS_PER_REQUEST):
        en_pages.update(summaries("en", batch))
    print(f"  {len(it_pages)} it pages, {len(en_pages)} en pages")

    for title in todo:
        page = it_pages.get(landed.get(title, ""))
        if not page:
            cache[title] = {}
            continue
        entry = dict(page)
        en = en_pages.get(en_title.get(page["title"], ""))
        if en:
            entry["en"] = en
        cache[title] = entry

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(cache.items())), f, ensure_ascii=False, indent=1)
    found = sum(1 for v in cache.values() if v)
    print(f"done: {found}/{len(cache)} titles have a page → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
