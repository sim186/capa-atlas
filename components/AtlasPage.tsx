import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import GraphView from "@/components/GraphView";
import { loadGraph, nodePath } from "@/lib/atlasData";
import type { Portrait } from "@/lib/graph";
import { DICTIONARIES, type Locale } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/locale";
import { SITE_COPY, SITE_NAME, siteTitle } from "@/lib/site";

/** The whole atlas in one language; app/(it)/page.tsx and app/(en)/en/page.tsx. */
export default function AtlasPage({ locale }: { locale: Locale }) {
  const data = loadGraph(locale);

  let portraits: Portrait[] = [];
  try {
    portraits = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "portraits.json"), "utf-8")
    ) as Portrait[];
  } catch {
    // no portraits fetched: the atlas just renders without a backdrop
  }

  if (!data) {
    return (
      <main className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <h1 className="mb-2 text-xl font-semibold tracking-[-0.03em] text-[var(--atlas-ink)]">
            {SITE_NAME}
          </h1>
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-[color-mix(in_oklch,var(--atlas-ink)_68%,transparent)]">
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
      {/* Crawler / screen-reader view of what the canvas draws. Its links lead
          to the node pages; kept out of the Tab order, which belongs to the map. */}
      <div className="sr-only">
        <h1>{siteTitle(locale)}</h1>
        <p>{SITE_COPY[locale].description}</p>
        <h2>{DICTIONARIES[locale].groupPlural.album}</h2>
        <ul>
          {albums.map((a) => (
            <li key={a.id}>
              <Link href={nodePath(a, locale)} tabIndex={-1}>{a.label}</Link>
              {a.description ? ` — ${a.description}` : ""}
              <ul>
                {songs
                  .filter((s) => s.album === a.label)
                  .map((s) => (
                    <li key={s.id}>
                      <Link href={nodePath(s, locale)} tabIndex={-1}>{s.label}</Link>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
        {(["figure", "concept"] as const).map((group) => (
          <section key={group}>
            <h2>{DICTIONARIES[locale].groupPlural[group]}</h2>
            <ul>
              {data.nodes
                .filter((n) => n.group === group)
                .map((n) => (
                  <li key={n.id}>
                    <Link href={nodePath(n, locale)} tabIndex={-1}>{n.label}</Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
      <LocaleProvider locale={locale}>
        <GraphView data={data} portraits={portraits} />
      </LocaleProvider>
    </main>
  );
}