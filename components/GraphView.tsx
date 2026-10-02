"use client";

import dynamic from "next/dynamic";
import type { ForceGraphMethods } from "react-force-graph-3d";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigOptions } from "3d-force-graph";
import {
  CanvasTexture,
  Group as ThreeGroup,
  type Object3D,
  type PerspectiveCamera,
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
  GraphLink,
  GraphNode,
  Group,
  GROUP_COLOR,
  GROUP_LABEL,
  GROUP_SHAPE,
  Portrait,
} from "@/lib/graph";
import GroupGlyph from "@/components/GroupGlyph";
import {
  DrawablyBadge,
  DrawablyButton,
  DrawablyCard,
  DrawablyInput,
} from "drawably/react";
import { CATEGORY_THEMES, MONO_THEME, type AtlasTheme } from "@/lib/theme";
import { sound } from "@/lib/sound";
import { useIsDesktop, useIsTouch } from "@/lib/useIsDesktop";
import NodeDetail from "@/components/NodeDetail";
import IntroOverlay from "@/components/IntroOverlay";
import PortraitBackdrop from "@/components/PortraitBackdrop";
import AboutPanel from "@/components/AboutPanel";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
});

const ALL_GROUPS: Group[] = ["album", "song", "figure", "concept"];

// Link-kind visibility. co_occurs is the near-clique layer (every pair of
// themes sharing a song gets an edge) and is the main readability killer,
// so it ships toggled off; the build script also prunes weak pairs.
type LinkKind = GraphLink["kind"];
const ALL_KINDS: LinkKind[] = ["on", "refers", "co_occurs"];
const KIND_LABEL: Record<LinkKind, string> = {
  on: "album",
  refers: "citazioni",
  co_occurs: "tematiche",
};
const DEFAULT_KINDS: LinkKind[] = ["on", "refers"];

/** #rrggbb + alpha → rgba() string, for ink-colored edge highlighting. */
function inkAlpha(hex: string, alpha: number) {
  const n = hex.replace("#", "");
  return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(
    n.slice(2, 4),
    16
  )}, ${parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}
const DEFAULT_VISIBLE: Group[] = ["album", "song", "figure", "concept"];
// Labels are layered by camera distance so the overview isn't a wall of
// text: the sparse orientation layers (themes, figures) read from afar,
// albums once you approach a cluster. Songs number in the hundreds, so they
// are only named while they belong to the selected neighborhood.
const LABEL_MAX_DISTANCE: Record<Group, number> = {
  concept: 700,
  figure: 1400,
  album: 520,
  song: 520,
};
// Below this camera distance a disc fills the screen; keep the visitor out.
const MIN_CAMERA_DISTANCE = 150;

// Tilt clamp: the atlas is readable as a turntable, not a flight sim. The
// polar angle (0 = straight down, π/2 = horizon) is kept within a band that
// still allows a near-plan view and a slight peek below the equator, so a
// pointer drag can never strand the visitor upside down or edge-on.
const MIN_POLAR = Math.PI * 0.12;
const MAX_POLAR = Math.PI * 0.52;

// Camera distance band after selecting a node. Selection pans, not
// teleports: closer than the floor would tunnel-vision into a single disc,
// farther than the ceiling turns the clicked cluster into confetti. Between
// the two, the visitor's own zoom level wins.
const FOCUS_MIN_DISTANCE = 320;
const FOCUS_MAX_DISTANCE = 430;
// A finger is blunter than a pointer: a tap picks the nearest node within
// this many screen px, since discs are only ~15px across in the overview.
const TAP_RADIUS = 28;
const PHONE_MAX_SONG_LABELS = 16;
// Cap on unlit labels on screen at once (themes, figures, albums).
const MAX_AMBIENT_LABELS = 40;
const PHONE_MAX_AMBIENT_LABELS = 14;
const DOUBLE_TAP_MS = 320;

type ColorMode = "mono" | "group";

/** Width of the desktop detail panel (mirrors .atlas-panel in globals.css). */
function desktopPanelWidth() {
  if (typeof window === "undefined" || window.innerWidth < 800) return 0;
  return Math.min(window.innerWidth / 3, 42 * 16);
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Camera flight duration, collapsed to an instant cut for reduced motion. */
const flightMs = (ms: number) => (prefersReducedMotion() ? 0 : ms);

function hash01(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function linkKey(link: { source?: unknown; target?: unknown }) {
  return endpointId(link.source) + ">" + endpointId(link.target);
}

function endpointId(endpoint: unknown) {
  if (typeof endpoint === "object" && endpoint !== null && "id" in endpoint) {
    return String(endpoint.id);
  }
  return String(endpoint);
}

// Engine ticks the scene must draw before the intro curtain lifts.
const WARM_TICKS = 40;

// How long each portrait holds the map before the next fades in.
const IDLE_PORTRAIT_MS = 9000;

// How many of the selected node's edges get the bright, animated treatment.
// Phone idle map: only the strongest theme-to-theme links (of 314).
const PHONE_MIN_CO_WEIGHT = 6;

const PRIMARY_LINKS_DESKTOP = 20;
const PRIMARY_LINKS_PHONE = 10;

const GROUP_ORDER: Group[] = ["album", "song", "figure", "concept"];

export default function GraphView({ data, portraits }: { data: GraphData; portraits: Portrait[] }) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  // Phones: the detail sheet covers the map, so it opens and closes on its own.
  // Closing it keeps `selected`, so the highlighted neighbourhood stays on the
  // map to be looked at; a tap on empty space (or the chip's ✕) clears it.
  const [sheetOpen, setSheetOpen] = useState(false);
  // Each category retints the page; the portrait changes with it so the
  // backdrop shifts together with the colour instead of sitting apart.
  // Idle, the portraits take turns on the map so all of them get seen — on a
  // phone the detail sheet hides the map, so selection alone never shows them.
  const [idlePortrait, setIdlePortrait] = useState(0);
  const backdropIndex = selected ? GROUP_ORDER.indexOf(selected.group) + 1 : idlePortrait;
  const idleRotates = selected === null && portraits.length > 1;
  useEffect(() => {
    if (!idleRotates || prefersReducedMotion()) return;
    const timer = window.setInterval(
      () => setIdlePortrait((i) => (i + 1) % portraits.length),
      IDLE_PORTRAIT_MS
    );
    return () => window.clearInterval(timer);
  }, [idleRotates, portraits.length]);
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
  // rgb is the default: notes carry their category color from the first
  // frame, no selection required.
  const [colorMode, setColorMode] = useState<ColorMode>("group");
  const [visibleKinds, setVisibleKinds] = useState<Set<LinkKind>>(
    () => new Set(DEFAULT_KINDS)
  );
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  // "elenco": a plain, keyboard-reachable list of every node — the
  // non-3D way into the atlas.
  const [browse, setBrowse] = useState(false);
  const [reduceMotion] = useState(prefersReducedMotion);
  const reduceMotionRef = useRef(reduceMotion);
  const viewOffsetRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const isDesktop = useIsDesktop();
  // Layout (side panel vs sheet) follows the width; the rendering profile also
  // follows the input. A tablet is wide enough for the desktop layout but is a
  // touch device with a much weaker GPU, so it gets the lite profile too:
  // songs hidden until focused, straight edges, no particles, no antialiasing.
  const isTouch = useIsTouch();
  const lite = !isDesktop || isTouch;
  // Phone-only first-run hint that the scene is draggable. Shown once the intro
  // has lifted, gone at the first touch (or after a while if never touched).
  const [hintOn, setHintOn] = useState(false);
  const hintDoneRef = useRef(false);
  // Real loading progress for the intro: the dynamic chunk mounted, then a few
  // dozen engine ticks drawn (shaders compiled, textures uploaded, frames
  // flowing). The unfurl entrance waits for the curtain, so it's actually seen.
  const [sceneMounted, setSceneMounted] = useState(false);
  const [warmTicks, setWarmTicks] = useState(0);
  const tickCountRef = useRef(0);
  const revealedRef = useRef(false);
  const sceneReady = sceneMounted && warmTicks >= WARM_TICKS;
  const introProgress = sceneMounted ? 0.4 + 0.6 * Math.min(1, warmTicks / WARM_TICKS) : 0.12;
  useEffect(() => {
    if (!lite) return;
    const show = window.setTimeout(() => {
      if (!hintDoneRef.current) setHintOn(true);
    }, 2800);
    const hide = window.setTimeout(() => {
      hintDoneRef.current = true;
      setHintOn(false);
    }, 14000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [lite]);

  // Phones start with the sparse layers (albums, themes, figures). Songs stay
  // hidden — kept in the layout, so nothing shifts — until they belong to the
  // selected node's neighborhood, or the visitor turns them all on.
  const [songMode, setSongMode] = useState<"focus" | "all">("focus");
  const ghostSongs = lite && songMode === "focus";
  const ghostSongsRef = useRef(ghostSongs);
  const liteRef = useRef(lite);
  useEffect(() => {
    liteRef.current = lite;
  }, [lite]);
  // A phone can't hold dozens of song names around one hub: past this many
  // lit nodes only the dots show, and the sheet lists them instead.
  const songLabelsRef = useRef(true);
  useEffect(() => {
    ghostSongsRef.current = ghostSongs;
  }, [ghostSongs]);
  const lastTapRef = useRef({ t: 0, x: 0, y: 0 });
  // While a finger drags the map the phone tab bar slides away so the whole
  // scene is visible; it comes back a moment after the finger lifts.
  const [barHidden, setBarHidden] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const barTimerRef = useRef<number | null>(null);
  const prevHoveredId = useRef<string | null>(null);
  const labelDivsRef = useRef(
    new Map<string, { obj: CSS2DObject; div: HTMLDivElement; group: Group }>()
  );
  // Live-updated flat discs. One shared canvas texture; three shared
  // materials (idle / hover / highlighted) swapped per node in the tick
  // loop, so no per-node materials or rebuilds — and crucially, the
  // nodeThreeObject callback below stays identity-stable (react-force-graph
  // treats a changed reference as "rebuild every node", orphaning CSS2D
  // labels forever).
  const spriteRefs = useRef(
    new Map<
      string,
      { sprite: Sprite; base: number; group: Group; hit: Sprite["raycast"] }
    >()
  );
  const play = useCallback(
    (fn: () => void) => {
      if (!muted) fn();
    },
    [muted]
  );

  // A searched node enters the map on its own, even if its group is
  // currently toggled off. Only that case changes the graph data: feeding
  // every selection into it re-heated the layout and the node slid out of
  // frame right after the camera flew to it.
  const forcedId =
    selected && !visibleGroups.has(selected.group) ? selected.id : null;
  const visibleData = useMemo(() => {
    const nodes = data.nodes.filter(
      (node) => visibleGroups.has(node.group) || node.id === forcedId
    );
    const ids = new Set(nodes.map((node) => node.id));
    const links = data.links
      .filter(
        (link) =>
          // Phone default hides the songs, which are the only hubs for `on` and
          // `refers`: without the theme-to-theme layer the map would have no edges.
          (visibleKinds.has(link.kind) ||
            (ghostSongs && link.kind === "co_occurs" && (link.weight ?? 0) >= PHONE_MIN_CO_WEIGHT)) &&
          ids.has(String(link.source)) &&
          ids.has(String(link.target))
      )
      // force-graph resolves endpoints to objects in place. Its working links
      // must not mutate the source dataset or subsequent filtering loses links.
      .map((link) => ({ ...link }));
    return { nodes, links };
  }, [data, forcedId, visibleGroups, visibleKinds, ghostSongs]);

  // Adjacency is computed from the *visible* links only, so hover/selection
  // never lights up a relationship the visitor can't actually see.
  const neighbors = useMemo(() => {
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    const map = new Map<string, GraphNode[]>();
    for (const link of visibleData.links) {
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
  }, [data.nodes, visibleData.links]);

  const selectedNeighbors = useMemo(
    () => (selected ? neighbors.get(selected.id) ?? [] : []),
    [neighbors, selected]
  );
  const panelNodeNeighbors = useMemo(
    () => (panelNode ? neighbors.get(panelNode.id) ?? [] : []),
    [neighbors, panelNode]
  );
  const highlightedIds = useMemo(() => {
    const set = new Set<string>();
    if (selected) {
      set.add(selected.id);
      for (const node of selectedNeighbors) set.add(node.id);
    }
    return set;
  }, [selected, selectedNeighbors]);
  // A hub like "Consumismo" has ~100 edges; lighting them all is a hairball
  // (and ~400 flowing particles). Rank the selected node's edges by weight and
  // let only the strongest few be "primary": bright, thick and animated. The
  // rest of its edges stay as faint context, everything else is hidden.
  const primaryLinks = useMemo(() => {
    if (!selected) return null;
    const touching = visibleData.links.filter(
      (link) =>
        endpointId(link.source) === selected.id || endpointId(link.target) === selected.id
    );
    touching.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
    return new Set(touching.slice(0, lite ? PRIMARY_LINKS_PHONE : PRIMARY_LINKS_DESKTOP).map(linkKey));
  }, [selected, visibleData.links, lite]);

  useEffect(() => {
    songLabelsRef.current = !lite || highlightedIds.size <= PHONE_MAX_SONG_LABELS;
  }, [lite, highlightedIds]);
  // The selection owns the focus context — and nothing else. Hovering is
  // deliberately inert (just the label pill + tick sound): highlighting,
  // dimming and the edge flux only ever follow the clicked node, so the
  // frame never flickers as the pointer sweeps across notes. Memoized so
  // the focusRef effect only runs on real changes.
  const focus = useMemo(
    () => (selected ? { self: selected.id, ids: highlightedIds } : null),
    [selected, highlightedIds]
  );
  // Live focus context for the render loop.
  const focusRef = useRef<{ self: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);
  // OrbitControls instance, kept for the planet gizmo (azimuth readout +
  // top-down snap). Populated by the tilt-clamp effect once the graph mounts.
  const controlsRef = useRef<{
    target: { x: number; y: number; z: number };
    minDistance: number;
    minPolarAngle: number;
    maxPolarAngle: number;
  } | null>(null);
  const gizmoDotRef = useRef<HTMLDivElement | null>(null);
  const gizmoHeadingRef = useRef<HTMLSpanElement | null>(null);

  const fit = useCallback(() => {
    fgRef.current?.zoomToFit(flightMs(650), 110);
  }, []);

  // Hair layout: `val` (degree-derived, 2–9) decides how far a node sits
  // from the centre — hubs at the crown, minor nodes out on the rim. The
  // target radius is lobed (curl-sized bumps) and squashed on y, so the cloud
  // reads as a head of curls rather than a sphere. Custom force because
  // 3d-force-graph's built-in radial force is per-node-static.
  useEffect(() => {
    const RADIUS_CORE = 30;
    const RADIUS_RIM = 420;
    const STRENGTH = 0.12;
    const VAL_MIN = 2;
    const VAL_MAX = 9;
    const LOBE = 0.22; // curl bump amplitude, fraction of radius
    const FLAT = 0.75; // y squash
    const UNFURL_MS = 2600;
    let tries = 0;
    const timer = window.setInterval(() => {
      const fg = fgRef.current;
      if (!fg && ++tries < 50) return;
      window.clearInterval(timer);
      if (!fg) return;
      let nodes: GraphNode[] = [];
      let t0 = 0;
      const radial = (alpha: number) => {
        // one-off entrance: curls start tight and spring open. It holds
        // tight until the intro curtain lifts, so the visitor sees it happen.
        if (revealedRef.current && t0 === 0) t0 = performance.now();
        const u = reduceMotionRef.current
          ? 1
          : t0 === 0
            ? 0
            : Math.min(1, (performance.now() - t0) / UNFURL_MS);
        const unfurl = 0.15 + 0.85 * (1 - (1 - u) ** 3);
        for (const n of nodes) {
          const t = Math.min(
            1,
            Math.max(0, ((n.val ?? VAL_MIN) - VAL_MIN) / (VAL_MAX - VAL_MIN))
          );
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const z = n.z ?? 0;
          const r = Math.hypot(x, y / FLAT, z) || 1;
          const lump =
            1 +
            (LOBE / 3) *
              (Math.sin(5.3 * (x / r) + 0.7) +
                Math.sin(4.7 * (y / FLAT / r) + 1.9) +
                Math.sin(5.9 * (z / r) + 3.1));
          // ease so only the top few land in the very centre
          const target =
            (RADIUS_CORE + (RADIUS_RIM - RADIUS_CORE) * (1 - t) ** 1.5) *
            lump *
            unfurl;
          const k = ((target - r) / r) * STRENGTH * alpha;
          const node = n as GraphNode & { vx?: number; vy?: number; vz?: number };
          node.vx = (node.vx ?? 0) + x * k;
          node.vy = (node.vy ?? 0) + y * k;
          node.vz = (node.vz ?? 0) + z * k;
        }
      };
      radial.initialize = (ns: GraphNode[]) => {
        nodes = ns;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fg as any).d3Force("importance", radial);
      fg.d3ReheatSimulation();
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  // Planet gizmo click: swing the camera to a top-down plan view over
  // whatever the visitor is currently looking at (not the origin), keeping
  // their zoom level. The z-offset matches the polar clamp so OrbitControls
  // never needs to correct us back on the next drag.
  const snapTopView = useCallback(() => {
    play(sound.select);
    const controls = controlsRef.current;
    const camera = fgRef.current?.camera();
    if (!controls || !camera) return;
    const t = controls.target;
    const dist = camera.position.distanceTo(t);
    fgRef.current?.cameraPosition(
      { x: t.x, y: t.y + dist, z: t.z + dist * Math.tan(MIN_POLAR) },
      { x: t.x, y: t.y, z: t.z },
      flightMs(700)
    );
  }, [play]);

  // Initial framing. ForceGraph3D is a dynamic() import, so on a slow device
  // (or a cold dev server) it mounts well after this effect: timers started
  // here would find fgRef empty and the camera would stay at its default,
  // far too close. Poll until the graph exists, then frame it.
  //
  // Phones don't open on the whole cloud: framing it means fitting the far
  // rim nodes, so ~200 nodes end up as specks in 390px. Instead the camera
  // follows the core (themes and figures) while the layout is still unfurling,
  // until the visitor first touches the scene or the layout stops; they drag
  // out to the rest themselves. (Double tap still frames everything.)
  const userMovedRef = useRef(false);
  const layoutDoneRef = useRef(false);
  useEffect(() => {
    const phone = liteRef.current;
    let follow: number | undefined;
    const startedAt = performance.now();
    const ready = window.setInterval(() => {
      if (!fgRef.current) return;
      window.clearInterval(ready);
      setSceneMounted(true);
      fit();
      if (!phone) return;
      follow = window.setInterval(() => {
        if (
          userMovedRef.current ||
          layoutDoneRef.current ||
          performance.now() - startedAt > 30000
        ) {
          window.clearInterval(follow);
          return;
        }
        fgRef.current?.zoomToFit(flightMs(700), 150, (node) => {
          const group = (node as GraphNode).group;
          return group === "concept" || group === "figure";
        });
      }, 800);
    }, 100);
    return () => {
      window.clearInterval(ready);
      window.clearInterval(follow);
    };
  }, [fit]);

  // Clamp the orbit tilt as soon as the controls exist (they're created
  // lazily by 3d-force-graph, hence the retry loop).
  useEffect(() => {
    let attempts = 0;
    const apply = () => {
      const controls = fgRef.current?.controls() as
        | {
            target: { x: number; y: number; z: number };
            minDistance: number;
            minPolarAngle: number;
            maxPolarAngle: number;
          }
        | undefined;
      if (!controls || typeof controls.minPolarAngle !== "number") {
        if (attempts++ < 20) window.setTimeout(apply, 150);
        return;
      }
      controls.minDistance = MIN_CAMERA_DISTANCE;
      // Phones report a pixel ratio of 3; two is plenty for flat discs. A
      // tablet (pixel ratio 2, but a big screen) fills far more pixels per
      // frame, so it gets 1.5.
      if (liteRef.current) {
        const cap = window.innerWidth < 800 ? 2 : 1.5;
        fgRef.current?.renderer().setPixelRatio(Math.min(window.devicePixelRatio, cap));
      }
      controls.minPolarAngle = MIN_POLAR;
      controls.maxPolarAngle = MAX_POLAR;
      controlsRef.current = controls;
    };
    apply();
  }, []);

  // ---- shared flat-shape textures + state materials -------------------
  // One white texture per category silhouette; colour comes from the
  // material, so a texture is never rebuilt on theme change.
  const shapeTextures = useMemo(() => {
    if (typeof window === "undefined") return null;
    const size = 128;
    const out = {} as Record<Group, CanvasTexture>;
    for (const group of ALL_GROUPS) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const path = new Path2D(GROUP_SHAPE[group]);
      ctx.scale(size / 100, size / 100);
      ctx.fillStyle = "#ffffff";
      ctx.fill(path);
      // Outer ring: a lighter pass of the same silhouette, slightly larger.
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = 2.4;
      ctx.translate(50, 50);
      ctx.scale(1.12, 1.12);
      ctx.translate(-50, -50);
      ctx.stroke(path);
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      out[group] = texture;
    }
    return out;
  }, []);

  const materials = useMemo(() => {
    if (!shapeTextures) return null;
    const make = (opacity: number) => {
      const byGroup = {} as Record<Group, SpriteMaterial>;
      for (const group of ALL_GROUPS) {
        byGroup[group] = new SpriteMaterial({
          map: shapeTextures[group],
          transparent: true,
          opacity,
          depthWrite: false,
        });
      }
      return byGroup;
    };
    // dim: everything outside the selected neighborhood. The point
    // of the selection animation is contrast — disconnected structure
    // recedes far enough that the connected cluster reads as the only
    // subject. idle is per-group: in rgb mode with nothing selected each
    // category keeps its own color instead of one shared tint.
    return {
      idle: make(0.55),
      hover: make(0.95),
      hi: make(1),
      dim: make(0.09),
    };
  }, [shapeTextures]);

  // Colorize mode retints the whole scene (bg + idle nodes + idle links) to
  // the selected node's category. Nothing selected falls back to mono.
  const theme: AtlasTheme =
    colorMode === "group" && selected
      ? CATEGORY_THEMES[selected.group]
      : MONO_THEME;

  // In rgb mode with nothing selected, idle notes wear their category
  // color. Selecting a note retints the whole scene to its category
  // (existing colorize behavior); mono mode paints every state with ink.
  useEffect(() => {
    if (!materials) return;
    const categoryIdle = colorMode === "group" && !selected;
    for (const group of ALL_GROUPS) {
      materials.idle[group].color.set(
        categoryIdle ? GROUP_COLOR[group] : theme.node
      );
    }
    for (const group of ALL_GROUPS) {
      materials.hover[group].color.set(theme.node);
      materials.hi[group].color.set(theme.node);
      materials.dim[group].color.set(theme.node);
    }
  }, [materials, theme.node, colorMode, selected]);

  useEffect(() => {
    let raf = 0;
    const tmp = new Vector3();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const camera = fgRef.current?.camera();
      if (!camera) return;
      const mats = materials;
      if (!mats) return;
      const focus = focusRef.current;

      // The desktop detail panel covers the right third of the screen. A
      // projection view-offset slides the whole scene left by half the panel
      // width, so the selected node sits in the middle of what is still
      // visible. Unlike moving the camera, it can't fight the orbit controls'
      // polar clamp, and CSS2D labels + raycasting follow it. (Phones show
      // the detail as a full page, so they need no offset.)
      const wanted = focus ? desktopPanelWidth() / 2 : 0;
      const view = viewOffsetRef.current;
      const next = reduceMotionRef.current || Math.abs(wanted - view.x) < 0.5
        ? wanted
        : view.x + (wanted - view.x) * 0.14;
      const dom = fgRef.current?.renderer().domElement;
      if (dom && (next !== view.x || (next !== 0 && dom.clientWidth !== view.w))) {
        const persp = camera as PerspectiveCamera;
        if (next === 0) persp.clearViewOffset();
        else persp.setViewOffset(dom.clientWidth, dom.clientHeight, next, 0, dom.clientWidth, dom.clientHeight);
        viewOffsetRef.current = { x: next, y: 0, w: dom.clientWidth, h: dom.clientHeight };
      }
      for (const [id, { sprite, base, group, hit }] of spriteRefs.current.entries()) {
        // Ghost songs are neither drawn nor hit-testable.
        const ghost =
          group === "song" && ghostSongsRef.current && !(focus && focus.ids.has(id));
        if (sprite.visible === ghost) {
          sprite.visible = !ghost;
          sprite.raycast = ghost ? () => {} : hit;
        }
        const state = !focus
          ? "idle"
          : id === focus.self
            ? "hover"
            : focus.ids.has(id)
              ? "hi"
              : "dim";
        const material = mats[state][group];
        if (sprite.material !== material) sprite.material = material;
        const factor =
          state === "hover" ? 1.35 : state === "hi" ? 1.25 : state === "dim" ? 0.85 : 1;
        if (sprite.scale.x !== base * factor) {
          sprite.scale.set(base * factor, base * factor, 1);
        }
      }
      const scene = fgRef.current?.scene();
      // Pass 1: reap, then rank every in-range label by camera distance.
      const candidates: { obj: CSS2DObject; distance: number }[] = [];
      for (const [id, { obj, div, group }] of labelDivsRef.current.entries()) {
        // A node removed from the graph (its group toggled off, say) takes its
        // 3D group out of the scene, but three never tells the CSS2D label
        // child: the <div> would hang in mid-air forever. Reap it ourselves.
        let root: Object3D = obj;
        while (root.parent) root = root.parent;
        if (scene && root !== scene) {
          div.remove();
          labelDivsRef.current.delete(id);
          continue;
        }
        obj.getWorldPosition(tmp);
        const lit = focus !== null && (id === focus.self || focus.ids.has(id));
        // CSS2DRenderer re-derives element.style.display from object.visible
        // every frame (it only skips fully-hidden branches) — toggling the
        // DOM style directly gets clobbered on the next render pass.
        // Songs are named only inside the selected neighborhood.
        if (group === "song") {
          obj.visible = lit && songLabelsRef.current;
        } else if (lit) {
          obj.visible = true;
        } else {
          const distance = camera.position.distanceTo(tmp);
          obj.visible = false;
          if (distance < LABEL_MAX_DISTANCE[group]) candidates.push({ obj, distance });
        }
        div.style.color = lit ? "var(--atlas-label-hi)" : "var(--atlas-label)";
        div.style.opacity = focus && !lit ? "0.12" : "1";
      }
      // Pass 2: however close the camera is, only the nearest few unlit
      // labels may show — dozens of names in one view are unreadable soup.
      candidates.sort((a, b) => a.distance - b.distance);
      const budget = liteRef.current ? PHONE_MAX_AMBIENT_LABELS : MAX_AMBIENT_LABELS;
      for (let i = 0; i < candidates.length && i < budget; i++) candidates[i].obj.visible = true;
      // Planet gizmo: the satellite sits on the orbit ring at the camera's
      // azimuth, and the mono readout shows the heading in degrees.
      const dot = gizmoDotRef.current;
      const controls = controlsRef.current;
      if (dot && controls) {
        const azimuth = Math.atan2(
          camera.position.x - controls.target.x,
          camera.position.z - controls.target.z
        );
        dot.style.transform = `rotate(${azimuth}rad) translateY(-25px)`;
        const heading = gizmoHeadingRef.current;
        if (heading) {
          const deg = Math.round((((-azimuth * 180) / Math.PI) % 360 + 360) % 360);
          const text = `${String(deg).padStart(3, "0")}°`;
          if (heading.textContent !== text) heading.textContent = text;
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [materials]);

  const closeSheet = useCallback(() => {
    play(sound.close);
    setSheetOpen(false);
  }, [play]);

  const closeDetail = useCallback(() => {
    play(sound.close);
    setSelected(null);
    setSheetOpen(false);
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

  const kindStats = useMemo(() => {
    const counts: Record<LinkKind, number> = { on: 0, refers: 0, co_occurs: 0 };
    for (const link of data.links) counts[link.kind] += 1;
    return counts;
  }, [data]);

  const toggleKind = useCallback(
    (kind: LinkKind) => {
      setVisibleKinds((previous) => {
        const next = new Set(previous);
        const willShow = !next.has(kind);
        if (willShow) next.add(kind);
        else next.delete(kind);
        play(() => sound.toggle(willShow));
        return next;
      });
    },
    [play]
  );

  const listing = query.trim() !== "" || browse;
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized && !browse) return [];
    return data.nodes
      .filter((node) => !normalized || node.label.toLowerCase().includes(normalized))
      .sort((a, b) => {
        const starts = (node: GraphNode) =>
          normalized && node.label.toLowerCase().startsWith(normalized) ? 0 : 1;
        return (
          starts(a) - starts(b) ||
          ALL_GROUPS.indexOf(a.group) - ALL_GROUPS.indexOf(b.group) ||
          a.label.localeCompare(b.label)
        );
      })
      .slice(0, 150);
  }, [data, query, browse]);

  // On a phone the Canzone layer is "revealed on selection" vs "all", not a
  // hard filter; every other group is a plain show/hide.
  const layerOn = (group: Group) =>
    group === "song" && lite ? songMode === "all" : visibleGroups.has(group);
  const toggleLayer = (group: Group) => {
    if (group === "song" && lite) {
      play(() => sound.toggle(songMode === "focus"));
      setSongMode((mode) => (mode === "focus" ? "all" : "focus"));
    } else {
      toggleGroup(group);
    }
  };

  const toggleColorMode = () => {
    setColorMode((mode) => {
      const next = mode === "mono" ? "group" : "mono";
      play(() => sound.toggle(next === "group"));
      return next;
    });
  };

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
      setSheetOpen(true);
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setPanelNode(node);
      setQuery("");
      setBrowse(false);
      setSearchFocused(false);
      setControlsOpen(false);
      play(sound.select);

      // Never fit after selecting. The point of view belongs to the visitor;
      // selection only re-centers the frame on the node at the zoom level
      // they already have — the rest of the atlas stays in view.
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
        // Selection settles at a comfortable reading distance: never inside
        // the cluster (tunnel vision) and never all the way out at the
        // overview zoom, where the focused neighborhood shrinks to dots. In
        // between, the visitor's own zoom level is respected.
        const standoff = Math.min(
          Math.max(distance, FOCUS_MIN_DISTANCE),
          FOCUS_MAX_DISTANCE
        );
        const ratio = standoff / distance;

        fgRef.current?.cameraPosition(
          { x: x + dx * ratio, y: y + dy * ratio, z: z + dz * ratio },
          { x, y, z },
          flightMs(700)
        );
      };
      // On a phone the detail is a full page that hides the map, so there is
      // nothing to frame — and flying in would leave the visitor inside the
      // cluster when they come back.
      if (window.innerWidth < 800) return;
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
        const sprite = new Sprite(materials.idle[n.group]);
        // Visual radius follows the node weight, same spirit as the old
        // cbrt(val) sizing of the shaded spheres.
        const base = 9 + Math.cbrt(n.val ?? 2) * 5;
        sprite.scale.set(base, base, 1);
        sprite.userData.base = base;
        group.add(sprite);
        spriteRefs.current.set(String(n.id), {
          sprite,
          base,
          group: n.group,
          hit: sprite.raycast,
        });
      }

      // The same node can be rebuilt (group toggled back on): drop the old
      // label first so two copies never coexist.
      labelDivsRef.current.get(String(n.id))?.div.remove();
      const div = document.createElement("div");
      div.className = "atlas-label";
      div.textContent = n.label;
      const obj = new CSS2DObject(div);
      const base = 9 + Math.cbrt(n.val ?? 2) * 5;
      obj.position.set(0, -(base / 2 + 5), 0);
      group.add(obj);
      labelDivsRef.current.set(String(n.id), { obj, div, group: n.group });

      return group;
    },
    [materials]
  );

  const groupById = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node.group])),
    [data.nodes]
  );

  // On touch the sprite hit-test alone is too fiddly: when a tap misses
  // every disc, pick the nearest visible node within a finger's reach.
  // Only a tap with nothing near it deselects (or, twice, re-frames all).
  const handleBackgroundClick = (event: MouseEvent) => {
    if (lite) {
      const fg = fgRef.current;
      const dom = fg?.renderer().domElement;
      if (fg && dom) {
        const rect = dom.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        let best: GraphNode | null = null;
        let bestDistance = TAP_RADIUS;
        for (const node of visibleData.nodes) {
          if (node.x === undefined || node.y === undefined || node.z === undefined) continue;
          if (ghostSongs && node.group === "song" && !highlightedIds.has(node.id)) continue;
          const screen = fg.graph2ScreenCoords(node.x, node.y, node.z);
          const distance = Math.hypot(screen.x - px, screen.y - py);
          if (distance < bestDistance) {
            best = node;
            bestDistance = distance;
          }
        }
        if (best) {
          focusNode(best);
          return;
        }
      }
      const now = Date.now();
      const last = lastTapRef.current;
      if (
        now - last.t < DOUBLE_TAP_MS &&
        Math.hypot(event.clientX - last.x, event.clientY - last.y) < 30
      ) {
        lastTapRef.current = { t: 0, x: 0, y: 0 };
        fit();
        return;
      }
      lastTapRef.current = { t: now, x: event.clientX, y: event.clientY };
    }
    if (selected) closeDetail();
  };

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
      <div
        // CSS2DRenderer stamps its labels with a distance-based z-index in the
        // thousands. Without its own stacking context the whole label layer
        // paints over the detail panel / sheet (z-30), as text on top of text.
        className="relative isolate flex-1"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("nav, button, a, input")) return;
          userMovedRef.current = true;
          hintDoneRef.current = true;
          setHintOn(false);
          dragStartRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const start = dragStartRef.current;
          if (!start || isDesktop) return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
            if (barTimerRef.current !== null) window.clearTimeout(barTimerRef.current);
            barTimerRef.current = null;
            setBarHidden(true);
          }
        }}
        onPointerUp={() => {
          dragStartRef.current = null;
          barTimerRef.current = window.setTimeout(() => setBarHidden(false), 900);
        }}
        onPointerCancel={() => {
          dragStartRef.current = null;
          setBarHidden(false);
        }}
      >
        <PortraitBackdrop portraits={portraits} index={backdropIndex} />
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
          // Read once at creation. At a pixel ratio of 2 MSAA buys little and
          // costs a lot of fill-rate on phone GPUs.
          rendererConfig={{
            antialias:
              typeof window === "undefined" ||
              (window.innerWidth >= 800 && !window.matchMedia("(pointer: coarse)").matches),
            powerPreference: "high-performance",
          }}
          // transparent clear colour: the stage div paints the theme colour and
          // the portrait backdrop sits between it and the canvas
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
          nodeVal={(node) => node.val ?? 2}
          nodeThreeObject={makeNodeThreeObject}
          nodeLabel={() => ""}
          linkColor={(link) => {
            if (!focus) return inkAlpha(theme.ink, lite ? 0.22 : 0.2);
            return primaryLinks?.has(linkKey(link))
              ? inkAlpha(theme.ink, 0.7)
              : inkAlpha(theme.ink, 0.12);
          }}
          linkWidth={(link) => {
            if (!focus) return lite ? 0.25 : 0.3;
            // stronger links read thicker: weight 1 is a hairline, 6+ is bold
            return primaryLinks?.has(linkKey(link))
              ? 0.5 + 0.12 * Math.min(link.weight ?? 1, 6)
              : 0.15;
          }}
          // The "flux" from the dictionary graph: bright dots streaming
          // along the selected node's primary edges only. Count 0 hides the
          // particle layer per link; the accessor re-runs on every render,
          // which is what lets selection changes propagate.
          linkDirectionalParticles={(link) =>
            !reduceMotion && !lite && focus && primaryLinks?.has(linkKey(link)) ? 3 : 0
          }
          // Curls: every link bows out with a stable per-link twist, so the
          // edge mesh reads as tangled ringlets instead of straight wires.
          // Phones skip the curls: each curved edge is its own tube mesh (30
          // segments), and with ~1200 edges that is the main GPU/CPU cost.
          // Straight edges with a coarse cross-section are far cheaper.
          linkResolution={lite ? 3 : 6}
          linkCurvature={(link) => (lite ? 0 : 0.45 + 0.5 * hash01(linkKey(link)))}
          linkCurveRotation={(link) => Math.PI * 2 * hash01(linkKey(link) + "r")}
          linkDirectionalParticleWidth={3}
          linkDirectionalParticleSpeed={0.004}
          linkDirectionalParticleColor={() => theme.ink}
          linkOpacity={0.9}
          linkVisibility={(link) => {
            // Selected: only that node's own edges are drawn at all. Hidden
            // links cost nothing, unlike merely transparent ones.
            if (
              focus &&
              endpointId(link.source) !== focus.self &&
              endpointId(link.target) !== focus.self
            ) {
              return false;
            }
            if (!ghostSongs) return true;
            const hidden = (end: unknown) => {
              const id = endpointId(end);
              return groupById.get(id) === "song" && !highlightedIds.has(id);
            };
            return !hidden(link.source) && !hidden(link.target);
          }}
          onEngineTick={() => {
            const n = ++tickCountRef.current;
            if (n <= WARM_TICKS && n % 8 === 0) setWarmTicks(n);
          }}
          onEngineStop={() => {
            layoutDoneRef.current = true;
          }}
          onNodeClick={(node) => focusNode(node as GraphNode)}
          // Clicking empty space is the gesture for "deselect" — the only
          // two ways the current selection changes are a click on another
          // note and a click on empty canvas (hover never touches it).
          onBackgroundClick={handleBackgroundClick}
          onNodeHover={(node) => setHovered(node as GraphNode | null)}
        />

        {/* top-left: one entry point for search + filters (also bound to "/") */}
        {isDesktop && (
        <div className="absolute left-6 top-6 z-10">
          <DrawablyButton
            key={controlsOpen ? "open" : "closed"}
            onClick={() => {
              setControlsOpen((open) => !open);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
            aria-label="Cerca e filtra"
            aria-expanded={controlsOpen}
            title="Cerca e filtra ( / )"
            variant={controlsOpen ? "solid" : "outline"}
            width={1.6}
            className="atlas-ink-btn h-12 px-4 text-sm tracking-wide"
          >
            ⌕ Cerca e filtra
          </DrawablyButton>
        </div>
        )}

        {/* top-right: the "i" — why this project exists, and who to thank */}
        <AboutPanel themeBg={theme.bg} play={play} portraits={portraits} />

        {/* Drawably's `.drawably-host` rule sets position:relative on the
            component's own root at the same specificity as Tailwind's
            `absolute` utility — whichever stylesheet loads second wins the
            tie, which in practice was drawably, silently dropping the card
            back into normal flow (and off the bottom of the viewport). An
            outer wrapper carries the positioning instead. */}
        {(controlsOpen || searchFocused) && (
          <div
            className={`absolute z-20 ${
              isDesktop ? "left-6 top-20 w-80" : "left-3 right-3 top-16"
            }`}
            // the sketched card has no fill of its own: without this the map
            // shows through the list
            style={{ background: theme.bg, borderRadius: "0.9rem" }}
          >
          <DrawablyCard
            paper={theme.bg}
            className="atlas-reveal atlas-controls p-5 font-mono text-xs"
            style={{
              "--i": 0,
              boxShadow: "0 16px 50px -20px rgba(0, 0, 0, 0.35)",
              animationDelay: "0ms",
            } as React.CSSProperties}
          >
            <DrawablyInput
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && results[0]) focusNode(results[0]);
              }}
              placeholder="cerca nell'atlante  /"
              aria-label="Cerca nel catalogo"
              width={1.6}
              className="block w-full"
            />

            {listing ? (
              // Results replace the filters while searching — stacking them
              // (as a floating dropdown) hid the chips under the list.
              <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--atlas-hair)" }}>
                {results.length === 0 ? (
                  <p className="py-2 opacity-70">
                    Nessun risultato per «{query.trim()}». Prova con un titolo o un tema.
                  </p>
                ) : (
                  <ul
                    className={`atlas-results overflow-y-auto ${
                      isDesktop ? "max-h-64" : "max-h-[calc(100dvh-21rem)]"
                    }`}
                    role="list"
                  >
                    {results.map((node) => (
                      <li key={node.id}>
                        <button
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => focusNode(node)}
                          className={`atlas-result flex w-full items-center gap-2.5 px-1 text-left ${
                            isDesktop ? "py-2" : "min-h-11 py-2.5 text-[0.82rem]"
                          }`}
                        >
                          <GroupGlyph group={node.group} />
                          <span className="min-w-0 flex-1 truncate">{node.label}</span>
                          {node.group === "song" && node.album && (
                            <span className="max-w-[40%] shrink-0 truncate opacity-50">
                              {node.album}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <>
                <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--atlas-hair)" }}>
                  <p className="mb-3 text-[0.7rem] font-bold opacity-70">Mostra</p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_GROUPS.map((group) => {
                      const enabled = layerOn(group);
                      return (
                        <DrawablyButton
                          key={`${group}-${enabled}`}
                          onClick={() => toggleLayer(group)}
                          aria-pressed={enabled}
                          variant={enabled ? "solid" : "outline"}
                          // Wear the category's node color: the index must make
                          // it obvious which dots on the canvas a click will
                          // show/hide. Inline custom props from drawably's
                          // applyTheme beat the container's ink vars.
                          stroke={GROUP_COLOR[group]}
                          fill={GROUP_COLOR[group]}
                          width={1.4}
                          className={
                            enabled
                              ? "px-3 py-1.5 text-[0.72rem] font-medium tracking-wide"
                              : "px-3 py-1.5 text-[0.72rem] font-medium tracking-wide opacity-45"
                          }
                        >
                          {GROUP_LABEL[group]} · {stats[group] ?? 0}
                        </DrawablyButton>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--atlas-hair)" }}>
                  <p className="mb-3 text-[0.7rem] font-bold opacity-70">Legami</p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_KINDS.map((kind) => {
                      const enabled = visibleKinds.has(kind);
                      return (
                        <DrawablyButton
                          key={`${kind}-${enabled}`}
                          onClick={() => toggleKind(kind)}
                          aria-pressed={enabled}
                          variant={enabled ? "solid" : "outline"}
                          tone={enabled ? undefined : "neutral"}
                          width={1.4}
                          className="px-3 py-1.5 text-[0.72rem] font-medium tracking-wide"
                        >
                          {KIND_LABEL[kind]} · {kindStats[kind]}
                        </DrawablyButton>
                      );
                    })}
                  </div>
                </div>

                {lite && (
                  <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--atlas-hair)" }}>
                    <p className="mb-3 text-[0.7rem] font-bold opacity-70">Vista</p>
                    <div className="flex flex-wrap gap-2">
                      <DrawablyButton
                        key={`color-${colorMode}`}
                        onClick={toggleColorMode}
                        aria-pressed={colorMode === "group"}
                        variant={colorMode === "group" ? "solid" : "outline"}
                        width={1.4}
                        className="atlas-ink-btn px-3 py-1.5 text-[0.72rem] font-medium tracking-wide"
                      >
                        {colorMode === "group" ? "colori" : "grigio"}
                      </DrawablyButton>
                      <DrawablyButton
                        key={`sound-${muted}`}
                        onClick={() => setMuted((value) => !value)}
                        aria-pressed={!muted}
                        variant={muted ? "outline" : "solid"}
                        width={1.4}
                        className="atlas-ink-btn px-3 py-1.5 text-[0.72rem] font-medium tracking-wide"
                      >
                        {muted ? "suono off" : "suono on"}
                      </DrawablyButton>
                    </div>
                  </div>
                )}
              </>
            )}

            <div
              className="mt-5 flex items-center justify-between gap-3 border-t pt-4"
              style={{ borderColor: "var(--atlas-hair)" }}
            >
              <span className="opacity-70">
                {visibleData.nodes.length} / {data.nodes.length} nodi
              </span>
              <span className="flex gap-4">
                <button
                  onClick={() => {
                    setBrowse((value) => !value);
                    setQuery("");
                  }}
                  aria-pressed={browse}
                  className="underline underline-offset-2 hover:opacity-70"
                >
                  {browse ? "filtri" : "elenco"}
                </button>
                <button onClick={fit} className="underline underline-offset-2 hover:opacity-70">
                  inquadra tutto
                </button>
              </span>
            </div>
          </DrawablyCard>
          </div>
        )}

        {/* hover pill */}
        {hovered && !selected && (
          <div className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2">
            <DrawablyBadge
              key={hovered.id}
              className="atlas-reveal atlas-hover-pill px-4 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.16em]"
              style={{
                "--i": 0,
                background: theme.bg,
                animationDelay: "0ms",
              } as React.CSSProperties}
            >
              {hovered.label}
              {hovered.group === "song" && hovered.album ? ` — ${hovered.album}` : ""}
            </DrawablyBadge>
          </div>
        )}

        {/* brand block — hidden on phones, where the bottom edge is spoken for */}
        {isDesktop && (
        <div className="pointer-events-none absolute bottom-7 left-7 z-10">
          <p className="atlas-pen text-2xl tracking-[-0.02em]">THE CAPA ATLAS</p>
          <p className="mt-1 max-w-[17rem] text-xs leading-snug opacity-70">
            Trascina per ruotare, scorri per zoomare. Clicca un nodo per aprirlo,
            Esc per tornare.
          </p>
        </div>
        )}

        {/* phone: say the scene can be dragged, once, then get out of the way */}
        {lite && (
          <div className="atlas-hint" data-on={hintOn && !selected} aria-hidden="true">
            <svg width="64" height="22" viewBox="0 0 64 22" fill="none" className="atlas-hint-arrows">
              <path
                d="M6 11C20 7 44 15 58 11M6 11l8-6M6 11l8 6M58 11l-8-6M58 11l-8 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="atlas-pen text-xl leading-none">Trascina per esplorare</p>
            <p className="text-xs opacity-65">pizzica per zoomare, tocca un nodo per aprirlo</p>
          </div>
        )}

        {/* legend: always on, doubles as the quick category filter */}
        {(isDesktop || !controlsOpen) && (
        <ul
          className={`absolute z-10 flex ${
            isDesktop
              ? "bottom-32 left-7 flex-col gap-y-0.5"
              : `left-3 right-3 flex-wrap gap-x-4 gap-y-0.5 transition-[bottom] duration-300 ${
                  barHidden ? "bottom-3" : "bottom-[4.5rem]"
                }`
          }`}
          aria-label="Categorie"
        >
          {ALL_GROUPS.map((group) => {
            const enabled = layerOn(group);
            return (
              <li key={group}>
                <button
                  onClick={() => toggleLayer(group)}
                  aria-pressed={enabled}
                  title={enabled ? `Nascondi: ${GROUP_LABEL[group]}` : `Mostra: ${GROUP_LABEL[group]}`}
                  className="atlas-legend-item flex items-center gap-2 py-1 text-xs"
                  style={{ opacity: enabled ? 1 : 0.4 }}
                >
                  <GroupGlyph
                    group={group}
                    size={12}
                    color={colorMode === "group" && !selected ? GROUP_COLOR[group] : theme.node}
                  />
                  <span>{GROUP_LABEL[group]}</span>
                </button>
              </li>
            );
          })}
        </ul>
        )}

        {/* planet gizmo — a nod to the album "Orbit". The satellite tracks
            the camera azimuth on its ring; click swings to the plan view. */}
        {isDesktop && !selected && (
          <button
            onClick={snapTopView}
            aria-label="Vista dall'alto"
            title="Vista dall'alto"
            className="atlas-gizmo absolute bottom-7 right-7 z-10"
          >
            <span className="atlas-gizmo-orbit" />
            <span className="atlas-gizmo-planet" />
            <span className="atlas-gizmo-north" />
            <span ref={gizmoDotRef} className="atlas-gizmo-satellite" />
            <span className="atlas-gizmo-heading">
              plan · <span ref={gizmoHeadingRef}>000°</span>
            </span>
          </button>
        )}

        {/* bottom-center controls (phones get the tab bar below instead) */}
        {isDesktop && (
        <div className="absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 gap-2.5">
          <DrawablyButton
            key={colorMode}
            onClick={toggleColorMode}
            aria-pressed={colorMode === "group"}
            title={
              colorMode === "group"
                ? "Colori per categoria attivi: clicca per il grigio"
                : "Grigio: clicca per colorare per categoria"
            }
            variant={colorMode === "group" ? "solid" : "outline"}
            width={1.4}
            className="atlas-ink-btn h-10 text-xs tracking-wide"
          >
            {colorMode === "group" ? "colori" : "grigio"}
          </DrawablyButton>
          <DrawablyButton
            key={muted ? "muted" : "sound"}
            onClick={() => setMuted((value) => !value)}
            aria-pressed={!muted}
            title={muted ? "Attiva i suoni" : "Disattiva i suoni"}
            variant={muted ? "outline" : "solid"}
            width={1.4}
            className="atlas-ink-btn h-10 text-xs tracking-wide"
          >
            {muted ? "suono off" : "suono on"}
          </DrawablyButton>
          <DrawablyButton
            onClick={fit}
            title="Torna alla vista d'insieme"
            width={1.6}
            className="atlas-ink-btn h-10 text-xs tracking-wide"
          >
            ⟲ inquadra
          </DrawablyButton>
        </div>
        )}

        {/* phone: with the sheet closed the selection stays on the map. This
            chip names it, reopens the sheet, or clears the selection. */}
        {!isDesktop && selected && !sheetOpen && (
          <div
            className="absolute left-1/2 top-4 z-20 flex max-w-[calc(100%-6rem)] -translate-x-1/2 items-center gap-2"
            style={{ background: "transparent" }}
          >
            <DrawablyButton
              onClick={() => {
                play(sound.select);
                setSheetOpen(true);
              }}
              width={1.4}
              className="atlas-ink-btn h-10 min-w-0 px-4 text-sm"
              aria-label={`Apri il dettaglio di ${selected.label}`}
            >
              <span className="block max-w-[11rem] truncate">{selected.label}</span>
            </DrawablyButton>
            <DrawablyButton
              onClick={closeDetail}
              width={1.4}
              className="atlas-ink-btn h-10 w-10 flex-none p-0"
              aria-label="Deseleziona"
            >
              <span className="atlas-close-mark" />
            </DrawablyButton>
          </div>
        )}

        {/* phone tab bar: map · list · search. The sheet has its own pager. */}
        {!isDesktop && !sheetOpen && (
          <nav
            aria-label="Navigazione"
            className="absolute inset-x-0 bottom-0 z-10 flex border-t transition-transform duration-300"
            style={{
              transform: barHidden ? "translateY(100%)" : undefined,
              borderColor: "var(--atlas-hair)",
              background: theme.bg,
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {(
              [
                ["map", "Mappa"],
                ["list", "Elenco"],
                ["search", "Cerca"],
              ] as const
            ).map(([tab, label]) => {
              const active = (controlsOpen ? (browse ? "list" : "search") : "map") === tab;
              return (
                <button
                  key={tab}
                  data-on={active}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    play(sound.select);
                    setQuery("");
                    if (tab === "map") {
                      if (!controlsOpen) fit();
                      setControlsOpen(false);
                      setBrowse(false);
                    } else {
                      setControlsOpen(true);
                      setBrowse(tab === "list");
                      if (tab === "search") window.setTimeout(() => searchRef.current?.focus(), 0);
                    }
                  }}
                  className="atlas-tab flex-1 py-4 text-sm"
                >
                  {label}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {panelNode && (
        <NodeDetail
          node={panelNode}
          neighbors={panelNodeNeighbors}
          open={isDesktop ? selected !== null : sheetOpen}
          onClose={isDesktop ? closeDetail : closeSheet}
          onNavigate={handleNavigate}
          portraits={portraits}
          portraitIndex={backdropIndex}
        />
      )}

      <IntroOverlay
        portrait={portraits[0]}
        progress={introProgress}
        ready={sceneReady}
        onReveal={() => {
          revealedRef.current = true;
        }}
      />
    </div>
  );
}
