import fs from "node:fs";
import path from "node:path";
import GraphView from "@/components/GraphView";
import type { GraphData, Portrait } from "@/lib/graph";
import { DICTIONARIES, type Locale } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/locale";
import { localizeGraph } from "@/lib/localize";
import { SITE_COPY, SITE_NAME, siteTitle } from "@/lib/site";

/** The whole atlas in one language; app/(it)/page.tsx and app/(en)/en/page.tsx. */
export default function AtlasPage({ locale }: { locale: Locale }) {
  let data: GraphData | null = null;
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "public", "graphData.json"),
      "utf-8"
    );
    data = localizeGraph(JSON.parse(raw) as GraphData, locale);
  } catch {
    // no data yet
  }

  let portraits: Portrait[] = [];
  try {
    portraits = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "portraits.json"), "utf-8")
    ) as Portrait[];
  } catch {
    // no portraits fetched: the atlas just renders without a backdrop
  }

  if (!data || data.nodes.length === 0) {
    return (
      <main className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <h1 className="mb-2 text-xl font-semibold tracking-[-0.03em] text-[var(--atlas-ink)]">
            {SITE_NAME}
          </h1>
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-[color-mix(in_oklch,var(--atlas-ink)_55%,transparent)]">
            Nessun dato. Genera il grafo con:
          </p>
          <pre className="mt-3 rounded-lg border border-[var(--atlas-hair)] p-3 text-left font-mono text-xs">
            python3 scripts/fetch_capa.py --seed{"\n"}python3 scripts/build_graph.py
          </pre>
        </div>
      </main>
    );
  }

  const albums = data.nodes.filter((n) => n.group === "album");
  const songs = data.nodes.filter((n) => n.group === "song");

  return (
    <main className="h-full">
      {/* Crawler / screen-reader view of what the canvas draws. */}
      <div className="sr-only">
        <h1>{siteTitle(locale)}</h1>
        <p>{SITE_COPY[locale].description}</p>
        <h2>{DICTIONARIES[locale].groupPlural.album}</h2>
        <ul>
          {albums.map((a) => (
            <li key={a.id}>
              {a.label}
              {a.description ? ` — ${a.description}` : ""}
              <ul>
                {songs
                  .filter((s) => s.album === a.label)
                  .map((s) => (
                    <li key={s.id}>{s.label}</li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      <LocaleProvider locale={locale}>
        <GraphView data={data} portraits={portraits} />
      </LocaleProvider>
    </main>
  );
}