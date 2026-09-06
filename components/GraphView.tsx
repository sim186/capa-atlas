"use client";

import dynamic from "next/dynamic";
import type { ForceGraphMethods } from "react-force-graph-3d";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GraphData,
  GraphLink,
  GraphNode,
  Group,
  GROUP_COLOR,
  GROUP_LABEL,
  LINK_COLOR,
} from "@/lib/graph";
import { sound } from "@/lib/sound";

// react-force-graph-3d relies on Three.js (browser APIs) → never SSR it.
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
});

const ALL_GROUPS: Group[] = ["album", "song", "keyword", "figure", "concept"];
// Keyword nodes are ~90% of the graph (the individual lyric annotations) —
// hidden by default so the physics sim + render stay smooth; toggle them on
// when you actually want to browse citations, not just structure.
const DEFAULT_VISIBLE: Group[] = ["album", "song", "figure", "concept"];

export default function GraphView({ data }: { data: GraphData }) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [visibleGroups, setVisibleGroups] = useState<Set<Group>>(
    () => new Set(DEFAULT_VISIBLE)
  );
  const [muted, setMuted] = useState(false);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const prevHoveredId = useRef<string | null>(null);

  const play = useCallback(
    (fn: () => void) => {
      if (!muted) fn();
    },
    [muted]
  );

  // node → neighbors map, built once from the FULL dataset (panel links work
  // regardless of what's currently toggled visible on the canvas).
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

  const visibleData = useMemo(() => {
    // A searched annotation joins the map by itself. Revealing all 3,607 lyric
    // fragments just to inspect one result turns the atlas into visual noise.
    const nodes = data.nodes.filter(
      (n) => visibleGroups.has(n.group) || n.id === selected?.id
    );
    const ids = new Set(nodes.map((n) => n.id));
    const links = data.links
      .filter(
        (l: GraphLink) => ids.has(String(l.source)) && ids.has(String(l.target))
      )
      // force-graph resolves source/target ids to node objects in place. Keep
      // that mutation out of the source dataset so later filter changes retain
      // their links instead of treating every endpoint as "[object Object]".
      .map((l) => ({ ...l }));
    return { nodes, links };
  }, [data, selected?.id, visibleGroups]);

  // Reframing is deliberately an explicit action. Automatically fitting when
  // the physics engine settles or a filter changes was overriding user zoom.
  const fit = useCallback(() => {
    fgRef.current?.zoomToFit(650, 90);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [fit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "/" && document.activeElement !== searchRef.current) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const stats = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of data.nodes) c[n.group] = (c[n.group] ?? 0) + 1;
    return c;
  }, [data]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return data.nodes
      .filter((n) => n.label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [data, query]);

  const toggleGroup = useCallback(
    (g: Group) => {
      setVisibleGroups((prev) => {
        const next = new Set(prev);
        const willShow = !next.has(g);
        if (willShow) next.add(g);
        else next.delete(g);
        play(() => sound.toggle(willShow));
        return next;
      });
    },
    [play]
  );

  const focusNode = useCallback(
    (n: GraphNode) => {
      setSelected(n);
      setQuery("");
      setSearchFocused(false);
      play(sound.select);

      // Let a newly revealed node receive simulation coordinates, then move the
      // camera toward it. This preserves the visitor's context rather than
      // fitting the whole graph (or a single giant node) after every selection.
      window.setTimeout(() => {
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        const z = n.z ?? 0;
        const distance = Math.max(Math.hypot(x, y, z), 1);
        const ratio = 1 + 110 / distance;
        fgRef.current?.cameraPosition(
          { x: x * ratio, y: y * ratio, z: z * ratio },
          { x, y, z },
          700
        );
      }, 100);
    },
    [play]
  );

  useEffect(() => {
    const id = hovered?.id ?? null;
    if (id && id !== prevHoveredId.current) play(sound.hover);
    prevHoveredId.current = id;
  }, [hovered, play]);

  const selectedNeighbors = selected ? (neighbors.get(selected.id) ?? []) : [];
  const title = selected?.fragment ?? selected?.label ?? "";

  return (
    <div className="relative flex h-full overflow-hidden bg-[#ececec] text-[#171717]">
      {/* graph */}
      <div className="relative flex-1">
        <ForceGraph3D
          ref={fgRef}
          graphData={visibleData}
          width={undefined}
          height={undefined}
          backgroundColor="#ececec"
          showNavInfo={false}
          nodeOpacity={0.9}
          nodeRelSize={4}
          nodeVal={(n) => n.val ?? 2}
          nodeColor={(n) => GROUP_COLOR[n.group as Group] ?? "#888"}
          nodeLabel={(n) =>
            `${n.label}\n${GROUP_LABEL[n.group as Group] ?? n.group}` +
            (n.song ? `\n— ${n.song}` : "")
          }
          linkColor={(l) => LINK_COLOR[l.kind as keyof typeof LINK_COLOR] ?? "#777"}
          linkWidth={(l) => (l.kind === "on" ? 0.35 : 0.8)}
          linkOpacity={0.35}
          onNodeClick={(n) => focusNode(n as GraphNode)}
          onNodeHover={(n) => setHovered(n as GraphNode | null)}
        />

        {/* Atlas controls: intentionally quiet, so the map remains the hero. */}
        <div className="absolute left-5 top-5 z-10 w-72 space-y-3 border border-black/15 bg-[#ececec]/92 p-4 font-mono text-[11px] text-[#171717] shadow-[8px_8px_0_rgba(23,23,23,0.08)] backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="mb-1 text-[9px] uppercase tracking-[0.24em] text-black/45">
                Caparezza × Genius
              </p>
              <h1 className="text-lg font-semibold uppercase leading-none tracking-[-0.06em]">
                The Capa Atlas
              </h1>
            </div>
            <button
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Attiva audio" : "Disattiva audio"}
              className="border border-black/15 px-1.5 py-1 text-black/55 transition hover:border-black hover:text-black"
            >
              {muted ? "audio off" : "audio on"}
            </button>
          </div>
          <p className="border-y border-black/10 py-2 text-[10px] leading-relaxed text-black/55">
            Trascina per ruotare <span className="px-1 text-black/30">·</span> scorri per zoomare
          </p>

          {/* search */}
          <div className="relative">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
              placeholder="cerca nel catalogo  /"
              aria-label="Cerca nel catalogo"
              className="w-full border border-black/15 bg-transparent px-2.5 py-2 text-[#171717] outline-none placeholder:text-black/35 focus:border-black"
            />
            {searchFocused && matches.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto border border-black/15 bg-[#f6f5f1] shadow-xl">
                {matches.map((n) => (
                  <li key={n.id}>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => focusNode(n)}
                      className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-black hover:text-white"
                    >
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: GROUP_COLOR[n.group] }}
                      />
                      <span className="truncate">{n.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* group toggles */}
          <div className="flex flex-wrap gap-1.5">
            {ALL_GROUPS.map((g) => {
              const on = visibleGroups.has(g);
              const color = GROUP_COLOR[g];
              return (
                <button
                  key={g}
                  onClick={() => toggleGroup(g)}
                  className="border px-2 py-1 transition-colors"
                  style={{
                    borderColor: on ? color : "rgba(23, 23, 23, 0.15)",
                    backgroundColor: on ? color + "18" : "transparent",
                    color: on ? "#171717" : "rgba(23, 23, 23, 0.45)",
                  }}
                >
                  {GROUP_LABEL[g]} · {stats[g] ?? 0}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[10px] text-black/45">
            <span>{visibleData.nodes.length} / {data.nodes.length} nodi</span>
            <button onClick={fit} className="text-[#171717] underline underline-offset-2 hover:no-underline">
              inquadra tutto
            </button>
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-5 left-5 z-10 font-mono text-[10px] uppercase tracking-[0.14em] text-black/40">
          Esplora liberamente · il punto di vista resta tuo
        </div>
      </div>

      {/* slide-over panel */}
      <aside
        className={`absolute right-0 top-0 z-20 h-full w-[26rem] max-w-[85vw] overflow-y-auto border-l border-black/15 bg-[#f6f5f1]/97 p-6 text-[#171717] shadow-[-12px_0_0_rgba(23,23,23,0.06)] transition-transform duration-500 ${
          selected ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selected ? (
          <div>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <span
                  className="mb-2 inline-block border px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em]"
                  style={{
                    backgroundColor: GROUP_COLOR[selected.group] + "22",
                    color: GROUP_COLOR[selected.group],
                  }}
                >
                  {GROUP_LABEL[selected.group] ?? selected.group}
                </span>
                <h2 className="text-2xl font-semibold leading-[1.05] tracking-[-0.04em]">
                  {title}
                </h2>
              </div>
              <button
                onClick={() => {
                  play(sound.close);
                  setSelected(null);
                }}
                className="border border-black/15 px-2 py-1 font-mono text-xs text-black/55 hover:border-black hover:text-black"
                aria-label="Chiudi pannello"
              >
                ✕
              </button>
            </div>

            {selected.group === "song" && (
              <dl className="mb-5 space-y-1.5 border-y border-black/10 py-4 text-sm text-black/75">
                {selected.album && (
                  <div>
                    <dt className="inline text-black/45">Album: </dt>
                    <dd className="inline">{selected.album}</dd>
                  </div>
                )}
                {selected.release && (
                  <div>
                    <dt className="inline text-black/45">Uscita: </dt>
                    <dd className="inline">{selected.release}</dd>
                  </div>
                )}
                {selected.url && (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block font-mono text-xs text-[#005dcc] underline underline-offset-2 hover:no-underline"
                  >
                    Genius ↗
                  </a>
                )}
              </dl>
            )}

            {selected.group === "keyword" && (
              <>
                <p className="whitespace-pre-wrap border-l-2 border-[#ff0080] bg-black/[0.035] p-4 text-sm italic leading-relaxed text-black/80">
                  {selected.fragment}
                </p>
                {selected.annotation && (
                  <p className="mt-4 text-sm leading-relaxed text-black/75">
                    {selected.annotation}
                  </p>
                )}
                {selected.url && (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-block font-mono text-xs text-[#005dcc] underline underline-offset-2 hover:no-underline"
                  >
                    Vedi annotazione su Genius ↗
                  </a>
                )}
              </>
            )}

            <div className="mt-5">
              <div className="mb-2 border-t border-black/10 pt-5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-black/45">
                Collegato a ({selectedNeighbors.length})
              </div>
              <ul className="space-y-1">
                {selectedNeighbors.slice(0, 40).map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => focusNode(n)}
                      className="flex w-full items-baseline gap-2 border-b border-black/5 px-1 py-2 text-left text-sm text-black/75 hover:bg-black hover:px-2 hover:text-white"
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
