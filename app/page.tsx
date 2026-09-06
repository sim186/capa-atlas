import fs from "node:fs";
import path from "node:path";
import GraphView from "@/components/GraphView";
import type { GraphData } from "@/lib/graph";

export const dynamic = "force-static";

export default function Home() {
  let data: GraphData | null = null;
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "public", "graphData.json"),
      "utf-8"
    );
    data = JSON.parse(raw) as GraphData;
  } catch {
    // no data yet
  }

  if (!data || data.nodes.length === 0) {
    return (
      <main className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <h1 className="mb-2 text-xl font-semibold text-neutral-100">
            The Capa Atlas
          </h1>
          <p className="text-sm text-neutral-400">
            Nessun dato. Genera il grafo con:
          </p>
          <pre className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-left text-xs text-neutral-300">
            python3 scripts/fetch_capa.py --seed{"\n"}python3 scripts/build_graph.py
          </pre>
        </div>
      </main>
    );
  }

  return (
    <main className="h-full">
      <GraphView data={data} />
    </main>
  );
}