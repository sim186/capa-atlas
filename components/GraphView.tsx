"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GraphData,
  GraphNode,
  Group,
  GROUP_COLOR,
  GROUP_LABEL,
  LINK_COLOR,
} from "@/lib/graph";

// react-force-graph-2d touches browser APIs on import → never SSR it.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

export default function GraphView({ data }: { data: GraphData }) {
  const fgRef = useRef<any>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);

  // node → neighbors map for the side panel
  const neighbors = useMemo(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const map = new Map<string, GraphNode[]>();
    for (const l of data.links) {
      const s = byId.get(String(l.source));
      const t = byId.get(String(l.target));
      if (!s || !t || s.id === t.id) continue;
      map.set(s.id, [...(map.get(s.id) ?? []), t]);
      map.set(t.id, [...(map.get(t.id) ?? []), s]);
    }
    for (const v of map.values()) {
      v.sort((a, b) => (b.val ?? 1) - (a.val ?? 1));
    }
    return map;
  }, [data]);

  const fit = useCallback(() => {
    requestAnimationFrame(() => {
      fgRef.current?.zoomToFit?.(500, 50);
    });
  }, []);

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const stats = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of data.nodes) c[n.group] = (c[n.group] ?? 0) + 1;
    return c;
  }, [data]);

  const selectedNeighbors = selected ? (neighbors.get(selected.id) ?? []) : [];
  const title = selected?.fragment ?? selected?.label ?? "";

  return (
    <div className="relative flex h-full">
      {/* graph */}
      <div className="relative flex-1">
        <ForceGraph2D
          ref={fgRef}
          graphData={data}
          width={undefined}
          height={undefined}
          nodeRelSize={4}
          nodeVal={(n: any) => n.val ?? 2}
          nodeColor={(n: any) => GROUP_COLOR[n.group as Group] ?? "#888"}
          nodeLabel={(n: any) =>
            `${n.label}\n${GROUP_LABEL[n.group as Group] ?? n.group}` +
            (n.song ? `\n— ${n.song}` : "")
          }
          linkColor={(l: any) => LINK_COLOR[l.kind as keyof typeof LINK_COLOR] ?? "#555"}
          linkWidth={(l: any) => (l.kind === "on" ? 0.5 : 1.2)}
          linkDirectionalParticles={(l: any) => (l.kind === "refers" ? 1 : 0)}
          linkDirectionalParticleWidth={1.5}
          onNodeClick={(n: any) => setSelected(n as GraphNode)}
          onNodeHover={(n: any) => setHovered(n as GraphNode | null)}
          onEngineStop={fit}
        />
        {/* legend / stats */}
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-lg border border-neutral-800 bg-black/70 p-3 text-xs text-neutral-300 backdrop-blur">
          <div className="mb-1 font-semibold text-neutral-100">
            The Capa Atlas
          </div>
          <div>
            {Object.entries(stats)
              .map(([g, n]) => `${GROUP_LABEL[g as Group]}: ${n}`)
              .join(" · ")}
            <span className="text-neutral-500"> · nodes {data.nodes.length}</span>
          </div>
        </div>
        <button
          onClick={fit}
          className="absolute bottom-3 right-3 z-10 rounded-md border border-neutral-800 bg-black/70 px-3 py-1.5 text-xs text-neutral-300 backdrop-blur hover:text-white"
        >
          ⟲ Centra
        </button>
      </div>

      {/* slide-over panel */}
      <aside
        className={`absolute right-0 top-0 z-20 h-full w-[26rem] max-w-[85vw] overflow-y-auto border-l border-neutral-800 bg-neutral-950/95 p-5 shadow-2xl transition-transform duration-300 ${
          selected ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selected ? (
          <div>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <span
                  className="mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: GROUP_COLOR[selected.group] + "22",
                    color: GROUP_COLOR[selected.group],
                  }}
                >
                  {GROUP_LABEL[selected.group] ?? selected.group}
                </span>
                <h2 className="text-lg font-semibold leading-snug text-neutral-50">
                  {title}
                </h2>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-white"
                aria-label="Chiudi pannello"
              >
                ✕
              </button>
            </div>

            {selected.group === "song" && (
              <dl className="mb-4 space-y-1 text-sm text-neutral-300">
                {selected.album && (
                  <div>
                    <dt className="inline text-neutral-500">Album: </dt>
                    <dd className="inline">{selected.album}</dd>
                  </div>
                )}
                {selected.release && (
                  <div>
                    <dt className="inline text-neutral-500">Uscita: </dt>
                    <dd className="inline">{selected.release}</dd>
                  </div>
                )}
                {selected.url && (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-blue-400 hover:underline"
                  >
                    Genius ↗
                  </a>
                )}
              </dl>
            )}

            {selected.group === "keyword" && (
              <>
                <p className="whitespace-pre-wrap rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-sm italic leading-relaxed text-neutral-200">
                  {selected.fragment}
                </p>
                {selected.annotation && (
                  <p className="mt-3 text-sm leading-relaxed text-neutral-300">
                    {selected.annotation}
                  </p>
                )}
                {selected.url && (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-blue-400 hover:underline"
                  >
                    Vedi annotazione su Genius ↗
                  </a>
                )}
              </>
            )}

            <div className="mt-5">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                Collegato a ({selectedNeighbors.length})
              </div>
              <ul className="space-y-1">
                {selectedNeighbors.slice(0, 40).map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => setSelected(n)}
                      className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white"
                    >
                      <span
                        className="inline-block h-2 w-2 shrink-0 self-center rounded-full"
                        style={{ backgroundColor: GROUP_COLOR[n.group] }}
                      />
                      <span className="truncate">{n.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="text-center text-sm text-neutral-500">
            {hovered ? (
              <p className="pt-40 text-neutral-400">
                Seleziona <span className="text-neutral-200">{hovered.label}</span>{" "}
                per i dettagli
              </p>
            ) : (
              <p className="pt-40">
                Clicca un nodo per vedere la citazione annotata e i collegamenti
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}