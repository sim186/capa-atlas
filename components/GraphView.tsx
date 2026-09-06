"use client";

import dynamic from "next/dynamic";
import type { ForceGraphMethods } from "react-force-graph-3d";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GraphData,
  GraphNode,
  Group,
  GROUP_LABEL,
} from "@/lib/graph";
import { sound } from "@/lib/sound";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
});

const ALL_GROUPS: Group[] = ["album", "song", "keyword", "figure", "concept"];
const DEFAULT_VISIBLE: Group[] = ["album", "song", "figure", "concept"];
const COLORS = {
  background: "#2e00aa",
  backgroundDeep: "#240083",
  gold: "#ffdc91",
  lavender: "#a88bd0",
  muted: "#7554ad",
  line: "rgba(255, 220, 145, 0.24)",
};

function endpointId(endpoint: unknown) {
  if (typeof endpoint === "object" && endpoint !== null && "id" in endpoint) {
    return String(endpoint.id);
  }
  return String(endpoint);
}

export default function GraphView({ data }: { data: GraphData }) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [visibleGroups, setVisibleGroups] = useState<Set<Group>>(
    () => new Set(DEFAULT_VISIBLE)
  );
  const [controlsOpen, setControlsOpen] = useState(false);
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

  const neighbors = useMemo(() => {
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    const map = new Map<string, GraphNode[]>();
    for (const link of data.links) {
      const source = byId.get(String(link.source));
      const target = byId.get(String(link.target));
      if (!source || !target || source.id === target.id) continue;
      map.set(source.id, [...(map.get(source.id) ?? []), target]);
      map.set(target.id, [...(map.get(target.id) ?? []), source]);
    }
    for (const nodes of map.values()) {
      nodes.sort((a, b) => (b.val ?? 1) - (a.val ?? 1));
    }
    return map;
  }, [data]);

  const selectedNeighbors = useMemo(
    () => (selected ? neighbors.get(selected.id) ?? [] : []),
    [neighbors, selected]
  );
  const highlightedIds = useMemo(
    () => new Set([selected?.id, ...selectedNeighbors.map((node) => node.id)]),
    [selected?.id, selectedNeighbors]
  );
  const visibleData = useMemo(() => {
    // A searched citation enters the map on its own. Turning on all 3,607
    // citations to inspect one result makes the graph impossible to read.
    const nodes = data.nodes.filter(
      (node) => visibleGroups.has(node.group) || node.id === selected?.id
    );
    const ids = new Set(nodes.map((node) => node.id));
    const links = data.links
      .filter((link) => ids.has(String(link.source)) && ids.has(String(link.target)))
      // force-graph resolves endpoints to objects in place. Its working links
      // must not mutate the source dataset or subsequent filtering loses links.
      .map((link) => ({ ...link }));
    return { nodes, links };
  }, [data, selected?.id, visibleGroups]);

  const fit = useCallback(() => {
    fgRef.current?.zoomToFit(650, 110);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [fit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
        setControlsOpen(false);
      }
      if (event.key === "/" && document.activeElement !== searchRef.current) {
        event.preventDefault();
        setControlsOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of data.nodes) counts[node.group] = (counts[node.group] ?? 0) + 1;
    return counts;
  }, [data]);

  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return data.nodes
      .filter((node) => node.label.toLowerCase().includes(normalized))
      .slice(0, 8);
  }, [data, query]);

  const toggleGroup = useCallback(
    (group: Group) => {
      setVisibleGroups((previous) => {
        const next = new Set(previous);
        const willShow = !next.has(group);
        if (willShow) next.add(group);
        else next.delete(group);
        play(() => sound.toggle(willShow));
        return next;
      });
    },
    [play]
  );

  const focusNode = useCallback(
    (node: GraphNode) => {
      setSelected(node);
      setQuery("");
      setSearchFocused(false);
      setControlsOpen(false);
      play(sound.select);

      // Never fit after selecting. The point of view belongs to the visitor;
      // selection only makes a short, intentional move toward its node.
      let attempts = 0;
      const moveToNode = () => {
        // A search result may have been hidden until this selection. Wait for
        // force-graph to assign it a position; focusing its default (0,0,0)
        // would leave the visitor looking into empty space.
        if (
          (node.x === undefined || node.y === undefined || node.z === undefined) &&
          attempts++ < 5
        ) {
          window.setTimeout(moveToNode, 120);
          return;
        }
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const z = node.z ?? 0;
        const distance = Math.max(Math.hypot(x, y, z), 1);
        const ratio = 1 + 110 / distance;
        fgRef.current?.cameraPosition(
          { x: x * ratio, y: y * ratio, z: z * ratio },
          { x, y, z },
          700
        );
      };
      window.setTimeout(moveToNode, 100);
    },
    [play]
  );

  useEffect(() => {
    const id = hovered?.id ?? null;
    if (id && id !== prevHoveredId.current) play(sound.hover);
    prevHoveredId.current = id;
  }, [hovered, play]);

  const title = selected?.fragment ?? selected?.label ?? "";

  return (
    <div className="relative flex h-full overflow-hidden bg-[#2e00aa] text-[#ffdc91]">
      <div className="relative flex-1">
        <ForceGraph3D
          ref={fgRef}
          graphData={visibleData}
          width={undefined}
          height={undefined}
          backgroundColor={COLORS.background}
          showNavInfo={false}
          nodeOpacity={0.88}
          nodeRelSize={4}
          nodeVal={(node) =>
            highlightedIds.has(String(node.id)) ? (node.val ?? 2) * 1.35 : node.val ?? 2
          }
          nodeColor={(node) =>
            highlightedIds.has(String(node.id))
              ? COLORS.gold
              : String(node.id) === hovered?.id
                ? COLORS.lavender
                : COLORS.muted
          }
          nodeLabel={(node) =>
            `${node.label}\n${GROUP_LABEL[node.group as Group] ?? node.group}` +
            (node.song ? `\n— ${node.song}` : "")
          }
          linkColor={(link) =>
            highlightedIds.has(endpointId(link.source)) ||
            highlightedIds.has(endpointId(link.target))
              ? COLORS.line
              : "rgba(168, 139, 208, 0.09)"
          }
          linkWidth={(link) =>
            highlightedIds.has(endpointId(link.source)) ||
            highlightedIds.has(endpointId(link.target))
              ? 0.8
              : 0.2
          }
          linkOpacity={0.8}
          onNodeClick={(node) => focusNode(node as GraphNode)}
          onNodeHover={(node) => setHovered(node as GraphNode | null)}
        />

        <div className="absolute left-7 top-7 z-10 flex gap-3">
          <button
            onClick={() => {
              setControlsOpen(true);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
            aria-label="Cerca nel catalogo"
            className="grid h-14 w-14 place-items-center rounded-full border border-[#ffdc91]/35 text-2xl text-[#ffdc91] transition hover:border-[#ffdc91] hover:bg-[#ffdc91]/10"
          >
            ⌕
          </button>
          <button
            onClick={() => setControlsOpen((open) => !open)}
            aria-label="Apri filtri"
            aria-expanded={controlsOpen}
            className="grid h-14 w-14 place-items-center rounded-full border border-[#ffdc91]/35 font-mono text-xs uppercase tracking-widest text-[#ffdc91] transition hover:border-[#ffdc91] hover:bg-[#ffdc91]/10"
          >
            index
          </button>
        </div>

        {(controlsOpen || searchFocused) && (
          <section className="absolute left-7 top-24 z-20 w-80 border border-[#ffdc91]/25 bg-[#240083]/90 p-5 font-mono text-xs text-[#ffdc91] shadow-[0_16px_50px_rgba(12,0,58,0.35)] backdrop-blur">
            <div className="relative">
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
                placeholder="cerca nell'atlante  /"
                aria-label="Cerca nel catalogo"
                className="w-full border-b border-[#ffdc91]/45 bg-transparent px-0 py-3 text-[#ffdc91] outline-none placeholder:text-[#ffdc91]/40 focus:border-[#ffdc91]"
              />
              {searchFocused && matches.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-30 max-h-64 overflow-y-auto border border-[#ffdc91]/25 bg-[#240083]">
                  {matches.map((node) => (
                    <li key={node.id}>
                      <button
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => focusNode(node)}
                        className="w-full border-b border-[#ffdc91]/10 px-3 py-3 text-left text-[#ffdc91] transition hover:bg-[#ffdc91] hover:text-[#2e00aa]"
                      >
                        {node.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5 border-t border-[#ffdc91]/20 pt-4">
              <p className="mb-3 uppercase tracking-[0.18em] text-[#ffdc91]/55">Mostra</p>
              <div className="flex flex-wrap gap-2">
                {ALL_GROUPS.map((group) => {
                  const enabled = visibleGroups.has(group);
                  return (
                    <button
                      key={group}
                      onClick={() => toggleGroup(group)}
                      className={`rounded-full border px-3 py-1.5 transition ${
                        enabled
                          ? "border-[#ffdc91]/70 bg-[#ffdc91]/10 text-[#ffdc91]"
                          : "border-[#ffdc91]/20 text-[#ffdc91]/40"
                      }`}
                    >
                      {GROUP_LABEL[group]} · {stats[group] ?? 0}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-[#ffdc91]/20 pt-4 text-[#ffdc91]/55">
              <span>{visibleData.nodes.length} / {data.nodes.length} nodi</span>
              <button onClick={fit} className="text-[#ffdc91] hover:underline">
                inquadra tutto
              </button>
            </div>
          </section>
        )}

        {hovered && !selected && (
          <div className="pointer-events-none absolute left-1/2 top-8 z-10 -translate-x-1/2 border border-[#ffdc91]/25 bg-[#240083]/80 px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-[#ffdc91]">
            {hovered.label}
          </div>
        )}

        <div className="pointer-events-none absolute bottom-8 left-8 z-10 font-mono">
          <p className="text-lg font-semibold tracking-[-0.06em] text-[#ffdc91]">THE CAPA ATLAS</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-[#ffdc91]/55">
            Trascina per ruotare · scorri per zoomare
          </p>
        </div>

        <div className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 gap-3">
          <button
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? "Attiva audio" : "Disattiva audio"}
            className="grid h-12 w-12 place-items-center rounded-full border border-[#ffdc91]/35 font-mono text-[10px] uppercase text-[#ffdc91] transition hover:border-[#ffdc91]"
          >
            {muted ? "off" : "on"}
          </button>
          <button
            onClick={fit}
            aria-label="Inquadra tutto il grafo"
            className="grid h-12 w-12 place-items-center rounded-full border border-[#ffdc91]/35 text-lg text-[#ffdc91] transition hover:border-[#ffdc91]"
          >
            ⟲
          </button>
        </div>
      </div>

      <aside
        className={`absolute right-0 top-0 z-20 h-full w-[34%] min-w-[25rem] max-w-[42rem] border-l border-[#ffdc91]/20 bg-[#240083]/88 p-9 text-[#ffdc91] shadow-[-18px_0_45px_rgba(12,0,58,0.2)] backdrop-blur-md transition-transform duration-500 ${
          selected ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selected && (
          <div className="flex h-full flex-col overflow-y-auto pr-1">
            <div className="flex items-center justify-between border-b border-[#ffdc91]/20 pb-6 font-mono text-xs uppercase tracking-[0.2em] text-[#ffdc91]/60">
              <span>{GROUP_LABEL[selected.group] ?? selected.group}</span>
              <button
                onClick={() => {
                  play(sound.close);
                  setSelected(null);
                }}
                className="grid h-12 w-12 place-items-center rounded-full border border-[#ffdc91]/35 text-xl text-[#ffdc91] transition hover:border-[#ffdc91]"
                aria-label="Chiudi pannello"
              >
                ×
              </button>
            </div>

            <h2 className="mt-10 text-5xl font-semibold leading-[0.95] tracking-[-0.07em] text-[#ffdc91]">
              {title}
            </h2>

            {selected.group === "song" && (
              <dl className="mt-8 border-y border-[#ffdc91]/20 py-6 text-lg leading-relaxed text-[#ffdc91]/80">
                {selected.album && <div>Album · {selected.album}</div>}
                {selected.release && <div>Uscita · {selected.release}</div>}
                {selected.url && (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block font-mono text-xs uppercase tracking-wider text-[#ffdc91] underline underline-offset-4 hover:no-underline"
                  >
                    Apri su Genius ↗
                  </a>
                )}
              </dl>
            )}

            {selected.group === "keyword" && (
              <>
                <p className="mt-8 border-l-2 border-[#ffdc91] bg-[#ffdc91]/10 p-5 text-lg italic leading-relaxed text-[#ffdc91]">
                  {selected.fragment}
                </p>
                {selected.annotation && (
                  <p className="mt-6 text-lg leading-relaxed text-[#ffdc91]/85">
                    {selected.annotation}
                  </p>
                )}
                {selected.url && (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-6 inline-block font-mono text-xs uppercase tracking-wider text-[#ffdc91] underline underline-offset-4 hover:no-underline"
                  >
                    Vedi annotazione su Genius ↗
                  </a>
                )}
              </>
            )}

            <div className="mt-10 border-t border-[#ffdc91]/20 pt-7">
              <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-[#ffdc91]/55">
                Collegato a · {selectedNeighbors.length}
              </p>
              <ul className="flex flex-wrap gap-2">
                {selectedNeighbors.slice(0, 40).map((node) => (
                  <li key={node.id}>
                    <button
                      onClick={() => focusNode(node)}
                      className="rounded-full border border-[#ffdc91]/30 px-3 py-2 text-sm text-[#ffdc91] transition hover:bg-[#ffdc91] hover:text-[#2e00aa]"
                    >
                      {node.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
