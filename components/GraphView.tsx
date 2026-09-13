"use client";

import dynamic from "next/dynamic";
import type { ForceGraphMethods } from "react-force-graph-3d";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigOptions } from "3d-force-graph";
import {
  CanvasTexture,
  Group as ThreeGroup,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";

type Renderer = NonNullable<ConfigOptions["extraRenderers"]>[number];
import {
  GraphData,
  GraphNode,
  Group,
  GROUP_LABEL,
} from "@/lib/graph";
import {
  DrawablyBadge,
  DrawablyButton,
  DrawablyCard,
  DrawablyInput,
} from "drawably/react";
import { CATEGORY_THEMES, MONO_THEME, type AtlasTheme } from "@/lib/theme";
import { sound } from "@/lib/sound";
import NodeDetail from "@/components/NodeDetail";
import IntroOverlay from "@/components/IntroOverlay";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
});

const ALL_GROUPS: Group[] = ["album", "song", "keyword", "figure", "concept"];
// Permanent labels only for the sparse orientation layers — songs and (esp.)
// keywords number in the thousands and turn the view into text soup.
const LABELED_GROUPS = new Set<Group>(["album", "figure", "concept"]);
const DEFAULT_VISIBLE: Group[] = ["album", "song", "figure", "concept"];
// Labels fade out past this camera distance so the overview isn't a wall of
// text — they only earn their keep once you've zoomed toward a cluster.
const LABEL_MAX_DISTANCE = 260;

type ColorMode = "mono" | "group";

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
  // The node rendered inside the detail panel. It survives slightly longer
  // than `selected` so the panel can play its slide-out transition before
  // unmounting.
  const [panelNode, setPanelNode] = useState<GraphNode | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [visibleGroups, setVisibleGroups] = useState<Set<Group>>(
    () => new Set(DEFAULT_VISIBLE)
  );
  const [controlsOpen, setControlsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>("mono");
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const prevHoveredId = useRef<string | null>(null);
  const labelDivsRef = useRef(new Map<string, { obj: CSS2DObject; div: HTMLDivElement }>());
  // Live-updated flat discs. One shared canvas texture; three shared
  // materials (idle / hover / highlighted) swapped per node in the tick
  // loop, so no per-node materials or rebuilds — and crucially, the
  // nodeThreeObject callback below stays identity-stable (react-force-graph
  // treats a changed reference as "rebuild every node", orphaning CSS2D
  // labels forever).
  const spriteRefs = useRef(new Map<string, { sprite: Sprite; base: number }>());
  // Read live inside the tick loop instead of as node-object closure deps.
  const highlightedIdsRef = useRef<Set<string>>(new Set());
  const hoveredIdRef = useRef<string | null>(null);

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
  const panelNodeNeighbors = useMemo(
    () => (panelNode ? neighbors.get(panelNode.id) ?? [] : []),
    [neighbors, panelNode]
  );
  const highlightedIds = useMemo(
    () => new Set([selected?.id, ...selectedNeighbors.map((node) => node.id)]),
    [selected?.id, selectedNeighbors]
  );
  useEffect(() => {
    highlightedIdsRef.current = highlightedIds as Set<string>;
  }, [highlightedIds]);
  useEffect(() => {
    hoveredIdRef.current = hovered?.id ?? null;
  }, [hovered]);
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

  // ---- shared flat-disc texture + state materials --------------------
  const discTexture = useMemo(() => {
    if (typeof window === "undefined") return null;
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Solid fill; the outer ring is a lighter pass of the same tint, so a
    // single white texture can be colorized per theme via material color.
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = size * 0.03;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
    ctx.stroke();
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }, []);

  const materials = useMemo(() => {
    if (!discTexture) return null;
    const make = (opacity: number) =>
      new SpriteMaterial({
        map: discTexture,
        transparent: true,
        opacity,
        depthWrite: false,
      });
    return { idle: make(0.55), hover: make(0.9), hi: make(1) };
  }, [discTexture]);

  // Colorize mode retints the whole scene (bg + idle nodes + idle links) to
  // the selected node's category. Nothing selected falls back to mono.
  const theme: AtlasTheme =
    colorMode === "group" && selected
      ? CATEGORY_THEMES[selected.group]
      : MONO_THEME;

  useEffect(() => {
    if (!materials) return;
    for (const material of Object.values(materials)) {
      material.color.set(theme.node);
    }
  }, [materials, theme.node]);

  useEffect(() => {
    let raf = 0;
    const tmp = new Vector3();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const camera = fgRef.current?.camera();
      if (!camera) return;
      const mats = materials;
      if (!mats) return;
      const highlighted = highlightedIdsRef.current;
      const hoveredId = hoveredIdRef.current;
      for (const [id, { sprite, base }] of spriteRefs.current.entries()) {
        const state = highlighted.has(id) ? "hi" : id === hoveredId ? "hover" : "idle";
        const material = mats[state];
        if (sprite.material !== material) sprite.material = material;
        const factor = state === "hi" ? 1.3 : 1;
        if (sprite.scale.x !== base * factor) {
          sprite.scale.set(base * factor, base * factor, 1);
        }
      }
      for (const [id, { obj, div }] of labelDivsRef.current.entries()) {
        obj.getWorldPosition(tmp);
        // CSS2DRenderer re-derives element.style.display from object.visible
        // every frame (it only skips fully-hidden branches) — toggling the
        // DOM style directly gets clobbered on the next render pass.
        obj.visible = camera.position.distanceTo(tmp) < LABEL_MAX_DISTANCE;
        div.style.color =
          highlighted.has(id) || id === hoveredId
            ? "var(--atlas-label-hi)"
            : "var(--atlas-label)";
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [materials]);

  const closeDetail = useCallback(() => {
    play(sound.close);
    setSelected(null);
    // Keep the node mounted through the slide-out transition (~620ms).
    closeTimerRef.current = window.setTimeout(() => setPanelNode(null), 700);
  }, [play]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selected) closeDetail();
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
  }, [selected, closeDetail]);

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
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setPanelNode(node);
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

        // Approach from wherever the camera already is, not from a vantage
        // picked off the origin-to-node ray.
        const camera = fgRef.current?.camera();
        const curPos = camera
          ? { x: camera.position.x, y: camera.position.y, z: camera.position.z }
          : { x: 0, y: 0, z: 400 };
        const dx = curPos.x - x;
        const dy = curPos.y - y;
        const dz = curPos.z - z;
        const distance = Math.max(Math.hypot(dx, dy, dz), 1);
        const standoff = 110;
        const ratio = standoff / distance;
        fgRef.current?.cameraPosition(
          { x: x + dx * ratio, y: y + dy * ratio, z: z + dz * ratio },
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

  // Node labels rendered permanently (via CSS2D overlay) instead of only on
  // hover — at rest, a raycast target with no visible anchor is
  // essentially unclickable inside a dense force-directed cluster.
  const css2dRenderer = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const renderer = new CSS2DRenderer();
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.top = "0px";
    renderer.domElement.style.pointerEvents = "none";
    return renderer;
  }, []);
  const extraRenderers = useMemo(
    () => (css2dRenderer ? [css2dRenderer as unknown as Renderer] : []),
    [css2dRenderer]
  );

  // Identity must stay stable across renders: react-force-graph-3d treats a
  // changed nodeThreeObject reference as "throw away and rebuild every
  // node's three-object", orphaning CSS2DObjects (duplicated labels
  // stacking forever). Colors/visibility are instead driven live by the
  // tick loop via spriteRefs/labelDivsRef.
  const makeNodeThreeObject = useCallback(
    (node: object) => {
      const n = node as GraphNode;
      const group = new ThreeGroup();

      // Flat disc, billboarded (a Sprite always faces the camera), tinted
      // by the shared materials — no shading, no specular: flat editorial.
      if (materials) {
        const sprite = new Sprite(materials.idle);
        // Visual radius follows the node weight, same spirit as the old
        // cbrt(val) sizing of the shaded spheres.
        const base = 9 + Math.cbrt(n.val ?? 2) * 5;
        sprite.scale.set(base, base, 1);
        sprite.userData.base = base;
        group.add(sprite);
        spriteRefs.current.set(String(n.id), { sprite, base });
      }

      if (LABELED_GROUPS.has(n.group)) {
        const div = document.createElement("div");
        div.className = "atlas-label";
        div.textContent = n.label;
        const obj = new CSS2DObject(div);
        const base = 9 + Math.cbrt(n.val ?? 2) * 5;
        obj.position.set(0, -(base / 2 + 5), 0);
        group.add(obj);
        labelDivsRef.current.set(String(n.id), { obj, div });
      }

      return group;
    },
    [materials]
  );

  const handleNavigate = useCallback(
    (node: GraphNode) => {
      focusNode(node);
    },
    [focusNode]
  );

  return (
    <div
      className="relative flex h-full overflow-hidden transition-colors duration-700"
      style={{
        backgroundColor: theme.bg,
        color: theme.ink,
        "--atlas-bg": theme.bg,
        "--atlas-ink": theme.ink,
        "--atlas-node": theme.node,
        "--atlas-label": `color-mix(in oklch, ${theme.ink} 55%, transparent)`,
        "--atlas-label-hi": theme.ink,
        // The pen strokes follow the theme ink/paper, so sketches recolour
        // together with the canvas when the rgb mode kicks in.
        "--drawably-stroke": theme.ink,
        "--drawably-fill": theme.ink,
        "--drawably-paper": theme.bg,
      } as React.CSSProperties}
    >
      <div className="relative flex-1">
        <ForceGraph3D
          ref={fgRef}
          graphData={visibleData}
          width={undefined}
          height={undefined}
          // Trackball (the lib default) ships with staticMoving=false, i.e.
          // built-in momentum on rotate/zoom. Orbit has no residual motion
          // once input stops.
          controlType="orbit"
          enableNodeDrag={false}
          extraRenderers={extraRenderers}
          backgroundColor={theme.bg}
          showNavInfo={false}
          nodeVal={(node) => node.val ?? 2}
          nodeThreeObject={makeNodeThreeObject}
          nodeLabel={() => ""}
          linkColor={(link) =>
            highlightedIds.has(endpointId(link.source)) ||
            highlightedIds.has(endpointId(link.target))
              ? theme.lineHi
              : theme.line
          }
          linkWidth={(link) =>
            highlightedIds.has(endpointId(link.source)) ||
            highlightedIds.has(endpointId(link.target))
              ? 0.8
              : 0.25
          }
          linkOpacity={0.9}
          onNodeClick={(node) => focusNode(node as GraphNode)}
          onNodeHover={(node) => setHovered(node as GraphNode | null)}
        />

        {/* top-left controls */}
        <div className="absolute left-6 top-6 z-10 flex gap-2.5">
          <DrawablyButton
            onClick={() => {
              setControlsOpen(true);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
            aria-label="Cerca nel catalogo"
            width={1.6}
            className="h-12 w-12 p-0 font-mono text-lg"
          >
            ⌕
          </DrawablyButton>
          <DrawablyButton
            onClick={() => setControlsOpen((open) => !open)}
            aria-label="Apri filtri"
            aria-expanded={controlsOpen}
            variant={controlsOpen ? "solid" : "outline"}
            width={1.6}
            className="h-12 w-12 p-0 font-mono text-[10px] uppercase tracking-[0.12em]"
          >
            index
          </DrawablyButton>
        </div>

        {(controlsOpen || searchFocused) && (
          <DrawablyCard
            paper={theme.bg}
            className="atlas-reveal atlas-controls absolute left-6 top-20 z-20 w-80 p-5 font-mono text-xs"
            style={{
              "--i": 0,
              boxShadow: "0 16px 50px -20px rgba(0, 0, 0, 0.35)",
              animationDelay: "0ms",
            } as React.CSSProperties}
          >
            <div className="relative">
              <DrawablyInput
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
                placeholder="cerca nell'atlante  /"
                aria-label="Cerca nel catalogo"
                width={1.6}
                className="block w-full"
              />
              {searchFocused && matches.length > 0 && (
                <DrawablyCard
                  paper={theme.bg}
                  width={1.6}
                  className="absolute left-0 right-0 top-full z-30 max-h-64 overflow-y-auto p-0"
                >
                  <ul>
                    {matches.map((node) => (
                      <li key={node.id}>
                        <button
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => focusNode(node)}
                          className="w-full border-b px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-[color-mix(in_oklch,var(--atlas-ink)_8%,transparent)]"
                          style={{ borderColor: "var(--atlas-hair)", color: theme.ink }}
                        >
                          {node.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </DrawablyCard>
              )}
            </div>

            <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--atlas-hair)" }}>
              <p className="mb-3 text-[0.6rem] font-bold uppercase tracking-[0.2em] opacity-55">
                Mostra
              </p>
              <div className="flex flex-wrap gap-2">
                {ALL_GROUPS.map((group) => {
                  const enabled = visibleGroups.has(group);
                  return (
                    <DrawablyButton
                      key={group}
                      onClick={() => toggleGroup(group)}
                      variant={enabled ? "solid" : "outline"}
                      width={1.4}
                      className="px-3 py-1.5 text-[0.72rem] font-medium tracking-wide"
                    >
                      {GROUP_LABEL[group]} · {stats[group] ?? 0}
                    </DrawablyButton>
                  );
                })}
              </div>
            </div>

            <div
              className="mt-5 flex items-center justify-between border-t pt-4 opacity-55"
              style={{ borderColor: "var(--atlas-hair)" }}
            >
              <span>
                {visibleData.nodes.length} / {data.nodes.length} nodi
              </span>
              <button onClick={fit} className="underline underline-offset-2 hover:opacity-70">
                inquadra tutto
              </button>
            </div>
          </DrawablyCard>
        )}

        {/* hover pill */}
        {hovered && !selected && (
          <DrawablyBadge
            className="atlas-reveal atlas-hover-pill pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 px-4 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.16em]"
            style={{
              "--i": 0,
              background: theme.bg,
              animationDelay: "0ms",
            } as React.CSSProperties}
          >
            {hovered.label}
            {hovered.song ? ` — ${hovered.song}` : ""}
          </DrawablyBadge>
        )}

        {/* brand block */}
        <div className="pointer-events-none absolute bottom-7 left-7 z-10">
          <p className="atlas-pen text-2xl tracking-[-0.02em]">THE CAPA ATLAS</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] opacity-55">
            Trascina per ruotare · scorri per zoomare
          </p>
        </div>

        {/* bottom-center controls */}
        <div className="absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 gap-2.5">
          <DrawablyButton
            onClick={() => {
              setColorMode((mode) => {
                const next = mode === "mono" ? "group" : "mono";
                play(() => sound.toggle(next === "group"));
                return next;
              });
            }}
            aria-label={
              colorMode === "group" ? "Passa a colore uniforme" : "Colora per categoria"
            }
            aria-pressed={colorMode === "group"}
            variant={colorMode === "group" ? "solid" : "outline"}
            width={1.4}
            className="h-10 p-0 font-mono text-[10px] uppercase tracking-[0.1em]"
          >
            {colorMode === "group" ? "rgb" : "gry"}
          </DrawablyButton>
          <DrawablyButton
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? "Attiva audio" : "Disattiva audio"}
            variant={muted ? "outline" : "solid"}
            width={1.4}
            className="h-10 p-0 font-mono text-[10px] uppercase tracking-[0.1em]"
          >
            {muted ? "off" : "on"}
          </DrawablyButton>
          <DrawablyButton
            onClick={fit}
            aria-label="Inquadra tutto il grafo"
            width={1.6}
            className="h-10 p-0 text-lg"
          >
            ⟲
          </DrawablyButton>
        </div>
      </div>

      {panelNode && (
        <NodeDetail
          node={panelNode}
          neighbors={panelNodeNeighbors}
          open={selected !== null}
          onClose={closeDetail}
          onNavigate={handleNavigate}
        />
      )}

      <IntroOverlay />
    </div>
  );
}
