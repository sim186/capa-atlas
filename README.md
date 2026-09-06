# The Capa Atlas 🗺️

Interactive knowledge graph of **Caparezza's** lyrics annotations (the "keywords"):
every Genius highlight per song, its annotation, and the recurring themes/figures
that connect songs and albums across his discography.

**Data source:** the public Genius web endpoints (no API token needed — verified
working). Lyrics pages embed the referent ids; `genius.com/api/referents/{id}`
returns the highlighted fragment + annotation.

## Quick start

```bash
npm install
npm run fetch      # harvest seed songs (5) → data/raw/referents.jsonl + public/graphData.json
npm run dev        # http://localhost:3000
```

Full crawl (all ~367 tracks on the artist page — a few minutes):

```bash
npm run fetch:all
```

## Pipeline

| Phase | Script | Output |
|---|---|---|
| 1. Harvest | `scripts/fetch_capa.py` | `data/raw/referents.jsonl` (resumable) |
| 2. Graph | `scripts/build_graph.py` | `public/graphData.json`, `data/keywords.csv` |
| 3. Frontend | Next.js App Router + `react-force-graph-2d` | interactive force graph |

### Node types

`album` (gray) · `song` (blue) · `keyword` (amber — the highlighted fragment +
annotation) · `figure` (red — Vincent van Gogh, alter-ego…) · `concept` (green —
"Consumismo e massificazione", "Cattolicesimo", "Rinascita"…)

### Links

- `on` — song → album
- `contains` — song → keyword
- `refers` — keyword → figure/concept (regex classification, `data/concepts.json`)

## How it works (data side)

1. `genius.com/api/artists/24580/songs?per_page=50&page=N` → song list
2. each song's lyrics page → `window.__PRELOADED_STATE__` → referent ids +
   song/album metadata
3. `genius.com/api/referents/{id}?text_format=plain` → `fragment` + annotation body

Polite 0.35s delay, browser User-Agent (Genius 403s on default UAs), resume via
`data/raw/done_ids.json`.

## Next steps

- [ ] full crawl + dedupe (features, live/remix versions appear on the artist page)
- [ ] LLM-assisted keyword → concept classification (replace regex seeds in `data/concepts.json`)
- [ ] album nodes → album cover art, year badges
- [ ] swap `react-force-graph-2d` → `react-force-graph-3d` (same API, `ssr: false`)