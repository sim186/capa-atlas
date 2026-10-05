"use client";

import dynamic from "next/dynamic";
import type { ForceGraphMethods } from "react-force-graph-3d";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataTexture,
  Group as ThreeGroup,
  type PerspectiveCamera,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import {
  GraphData,
  GraphLink,
  GraphNode,
  Group,
  GROUP_COLOR,
  GROUP_LABEL,
  Portrait,
} from "@/lib/graph";
import GroupGlyph from "@/components/GroupGlyph";
import {
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
import { makeDiscTexture, makeShapeTexture } from "@/lib/shapeTextures";
import AboutPanel from "@/components/AboutPanel";
import { albumYears, atlasLayout, studioAlbumIds, CORE_EXTENT, LAYOUT_EXTENT } from "@/lib/atlasLayout";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
});

const ALL_GROUPS: Group[] = ["album", "song", "figure", "concept"];

// Link-kind visibility. The opening graph uses only aggregate relationships;
// the build script prunes weak theme co-occurrences before they reach it.
type LinkKind = GraphLink["kind"];
const ALL_KINDS: LinkKind[] = ["on", "refers", "album_refers", "co_occurs"];
const KIND_LABEL: Record<LinkKind, string> = {
  on: "album",
  refers: "citazioni",
  album_refers: "album ↔ temi",
  co_occurs: "tematiche",
};
// The overview is the editorial layer: albums, themes and figures connect
// directly. Song-level evidence is opt-in because 254 songs and their 1,171
// edges turn the opening view into a dense ball.
const DEFAULT_KINDS: LinkKind[] = ["album_refers", "co_occurs"];

/** #rrggbb + alpha → rgba() string, for ink-colored edge highlighting. */
function inkAlpha(hex: string, alpha: number) {
  const n = hex.replace("#", "");
  return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(
    n.slice(2, 4),
    16
  )}, ${parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}
const DEFAULT_VISIBLE: Group[] = ["album", "figure", "concept"];
// Labels are layered by camera distance. The sparse overview can name albums,
// themes and figures; songs only surface when the visitor enables that layer,
// and only the nearest few on screen get a name.
const LABEL_MAX_DISTANCE: Record<Group, number> = {
  concept: 1000,
  figure: 1000,
  album: 1000, // singles and features; studio albums are always named
  song: 330,
};
// Ambient labels compete in this order: studio albums name the clock first,
// then the inner rings, then the halo of other releases, then songs.
const LABEL_TIER: Record<Group, number> = { album: 2, figure: 1, concept: 1, song: 3 };
// Ambient labels sit beside their dot, pointing away from the disc's
// centre: this gap (px) from the dot, and half a label's height.
const LABEL_GAP = 8;
const LABEL_HALF_HEIGHT = 6;
// A blocked ambient label tries once more this much further out (px).
const LABEL_STEP_OUT = 16;
// Ambient labels fade in and out over this long (ms) rather than popping.
const LABEL_FADE_MS = 160;
// A label already on screen keeps its place against a tighter margin than
// a newcomer needs, so the orbit doesn't make names flicker.
const LABEL_PAD = 10;
const LABEL_PAD_KEEP = 3;
// Keyboard navigation: pan step, zoom factor and the camera distance band.
const KEY_ZOOM_STEP = 0.78;
const MAX_CAMERA_DISTANCE = 1800;
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

type Vec3 = { x: number; y: number; z: number };

// A node displaced from its layout position by the selection lens. `home` is
// where the force layout put it; the spring moves `offset` toward `target`.
type LensMotion = {
  node: GraphNode;
  home: Vec3;
  offset: Vec3;
  velocity: Vec3;
  target: Vec3;
};

const LENS_SPRING = 42;
const LENS_DAMPING = 17;
// Selection lens: the selected node's neighbours leave the tangle and line up
// on two arcs either side of it, like a pair of brackets facing the camera,
// with their names pointing outward. Each arc reads top to bottom as a list,
// one category after another. Units are world units (about 2px each at the
// lens viewing distance).
const LENS_SIDE_SLOTS = 16; // per arc
const LENS_ROW = 13; // vertical spacing between members on an arc
const LENS_HALF_HEIGHT = 100;
const LENS_HALF_WIDTH = 72;
const LENS_MAX_MEMBERS = LENS_SIDE_SLOTS * 2;
const LENS_DOT = 11;
// Hover is a pointer, not a preview: no sound until the cursor rests a moment,
// so sweeping across the cluster is silent. Idle orbit resumes a while after
// the mouse leaves the map.
const HOVER_SOUND_DWELL_MS = 140;
// Screen px around the cursor within which the nearest node is picked.
const PICK_RADIUS = 18;
const IDLE_ORBIT_RESUME_MS = 4000;
const LENS_GROUP_ORDER: Group[] = ["album", "figure", "concept", "song"];

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

/** Lens slot order: one sector per category, the weightiest first in each. */
function lensOrder(nodes: readonly GraphNode[]) {
  return [...nodes].sort(
    (a, b) =>
      LENS_GROUP_ORDER.indexOf(a.group) - LENS_GROUP_ORDER.indexOf(b.group) ||
      (b.val ?? 1) - (a.val ?? 1) ||
      a.label.localeCompare(b.label)
  );
}

/**
 * Slot of the index-th of `count` lens members, in lens axes (x right, y up).
 * The right arc fills top to bottom, then the left arc bottom to top, so the
 * category order runs clockwise. Arcs bulge outward at the middle.
 */
function lensSlot(index: number, count: number) {
  const right = Math.ceil(count / 2);
  const side = index < right ? 1 : -1;
  const k = side === 1 ? right : count - right;
  const j = side === 1 ? index : count - 1 - index;
  const halfHeight = Math.min(LENS_HALF_HEIGHT, ((k - 1) * LENS_ROW) / 2);
  const u = k === 1 ? 0 : 1 - (2 * j) / (k - 1);
  const y = u * halfHeight;
  const bow = Math.sqrt(Math.max(0, 1 - (y / LENS_HALF_HEIGHT) ** 2));
  const x = side * LENS_HALF_WIDTH * (0.45 + 0.55 * bow);
  return { x, y, side };
}

/** Outer half-width of the lens, for framing the camera. */
function lensExtent(count: number) {
  return count === 0 ? 0 : LENS_HALF_WIDTH;
}

/** Where the force layout put a node, ignoring any lens displacement. */
function homeOf(motions: Map<string, LensMotion>, node: GraphNode): Vec3 | null {
  const motion = motions.get(node.id);
  if (motion) return motion.home;
  if (node.x === undefined || node.y === undefined || node.z === undefined) return null;
  return { x: node.x, y: node.y, z: node.z };
}

/** Place a node and pin it there for the force simulation. */
function pinAt(node: GraphNode, at: Vec3) {
  node.x = node.fx = at.x;
  node.y = node.fy = at.y;
  node.z = node.fz = at.z;
}

/**
 * Store a label's half width for the ambient collision check (see
 * measuredHalfWidthOf in the render loop). Shown for one layout read,
 * invisibly, since a hidden label has no width.
 */
function measureLabel(div: HTMLDivElement) {
  const { display, visibility } = div.style;
  div.style.visibility = "hidden";
  div.style.display = "block";
  if (div.offsetWidth) div.dataset.halfWidth = String(div.offsetWidth / 2);
  div.style.display = display;
  div.style.visibility = visibility;
}

/** Let go of every pin, so the layout can settle again. */
function releasePins(nodes: readonly GraphNode[]) {
  for (const node of nodes) {
    delete node.fx;
    delete node.fy;
    delete node.fz;
  }
}

const CAMERA_FOV = 50; // three.js PerspectiveCamera default, used by 3d-force-graph

// zoomToFit padding (px). Start-up framing, the settle fit and "inquadra" all
// use it, so none of them jumps the others. None: the disc's diameter fits
// the screen height, and the tilt foreshortens it to about 65%, which keeps
// the near rim (magnified by perspective) clear of the toolbar as it orbits.
const FIT_PADDING = 0;
// Start-up camera tilt (polar angle, 0 = straight down): high enough to read
// the career clock almost as a plan, low enough to keep the depth.
const START_POLAR = Math.PI * 0.16;

/**
 * The camera distance zoomToFit would pick for a cloud reaching `extent` from
 * the origin on its widest axis (three-render-objects' fitToBbox formula).
 * Framing with the same formula means the fit after the layout settles is a
 * nudge, not a jump.
 */
function fitDistance(extent: number, padding: number, width: number, height: number) {
  const paddedFov = (1 - (padding * 2) / height) * CAMERA_FOV;
  const fitHeight = (extent * 2) / Math.atan((paddedFov * Math.PI) / 180);
  return Math.max(fitHeight, fitHeight / (width / Math.max(1, height)));
}

const SHAPES_KEY = "atlas-distinct-shapes";

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
  // Picked by the render loop (see "Pointer picking"); the state copy drives
  // the tooltip text, the hover sound and the idle orbit.
  const hoveredIdRef = useRef<string | null>(null);
  const hoveredNodeRef = useRef<GraphNode | null>(null);
  const setHoveredRef = useRef(setHovered);
  const pointerRef = useRef({ x: 0, y: 0, inside: false, dragging: false });
  const hoverTipRef = useRef<HTMLDivElement>(null);
  // Breadcrumb of the selections walked through the lens (Atlante › A › B).
  const [trail, setTrail] = useState<GraphNode[]>([]);
  // The pointer moving over the map stops the idle orbit: nothing should
  // slide away from a cursor that is aiming at it.
  const [pointerBusy, setPointerBusy] = useState(false);
  const pointerTimerRef = useRef<number | null>(null);
  const [visibleGroups, setVisibleGroups] = useState<Set<Group>>(
    () => new Set(DEFAULT_VISIBLE)
  );
  const [controlsOpen, setControlsOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  // rgb is the default: notes carry their category color from the first
  // frame, no selection required.
  const [colorMode, setColorMode] = useState<ColorMode>("group");
  // Accessibility: distinct node silhouettes, so colour isn't the only cue.
  // Remembered across visits.
  const [distinctShapes, setDistinctShapes] = useState(false);
  useEffect(() => {
    // read after mount (not in the initial state) so server and client markup match
    const timer = window.setTimeout(() => {
      try {
        if (localStorage.getItem(SHAPES_KEY) === "1") setDistinctShapes(true);
      } catch {
        // storage blocked: the option just doesn't persist
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const toggleShapes = () => {
    setDistinctShapes((value) => {
      try {
        localStorage.setItem(SHAPES_KEY, value ? "0" : "1");
      } catch {
        // see above
      }
      return !value;
    });
  };
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
  const revealAtRef = useRef(0);
  const [revealed, setRevealed] = useState(false);
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
  const labelLayerRef = useRef<HTMLDivElement>(null);
  // Ambient label fade state (0–1 by node id), the ids shown last frame, and
  // that frame's time.
  const labelFadeRef = useRef(new Map<string, number>());
  const labelShownRef = useRef(new Set<string>());
  const labelFrameRef = useRef(0);
  const labelDivsRef = useRef(
    new Map<string, { div: HTMLDivElement; group: Group; node: GraphNode }>()
  );
  // Live-updated flat discs. One shared canvas texture; three shared
  // materials (idle / hover / highlighted) swapped per node in the tick
  // loop, so no per-node materials or texture rebuilds.
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

  // Every node's links, strongest first, across all layers and link kinds.
  const linkStrength = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    const add = (from: string, to: string, weight: number) => {
      let bucket = map.get(from);
      if (!bucket) map.set(from, (bucket = new Map()));
      bucket.set(to, (bucket.get(to) ?? 0) + weight);
    };
    for (const link of data.links) {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (source === target) continue;
      add(source, target, link.weight ?? 1);
      add(target, source, link.weight ?? 1);
    }
    return map;
  }, [data.links]);
  const nodeById = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node])),
    [data.nodes]
  );
  // The lens shows a node's direct links whatever the layer toggles say: an
  // album whose only links are songs must not open onto an empty ring. Big
  // hubs keep their strongest LENS_MAX_MEMBERS; the panel lists the rest.
  const lensMembersOf = useCallback(
    (id: string) =>
      [...(linkStrength.get(id) ?? new Map<string, number>())]
        .map(([other, weight]) => ({ node: nodeById.get(other), weight }))
        .filter((entry): entry is { node: GraphNode; weight: number } => !!entry.node)
        .sort(
          (a, b) =>
            b.weight - a.weight ||
            (b.node.val ?? 1) - (a.node.val ?? 1) ||
            a.node.label.localeCompare(b.node.label)
        )
        .slice(0, LENS_MAX_MEMBERS)
        .map((entry) => entry.node),
    [linkStrength, nodeById]
  );
  const selectedNeighbors = useMemo(
    () => (selected ? lensMembersOf(selected.id) : []),
    [lensMembersOf, selected]
  );

  const visibleData = useMemo(() => {
    const nodes = data.nodes.filter(
      (node) => visibleGroups.has(node.group) || node.id === forcedId
    );
    const ids = new Set(nodes.map((node) => node.id));
    const links = data.links.filter(
      (link) =>
        // Phone default hides the songs, which are the only hubs for `on` and
        // `refers`: album-to-theme and theme-to-theme edges keep the map connected.
        (visibleKinds.has(link.kind) ||
          (ghostSongs &&
            (link.kind === "album_refers" ||
              (link.kind === "co_occurs" && (link.weight ?? 0) >= PHONE_MIN_CO_WEIGHT)))) &&
        ids.has(String(link.source)) &&
        ids.has(String(link.target))
    );
    // Lens guests: the selection's members from hidden layers join the map
    // for as long as the lens is open, with the links that tie them to it.
    // The layout is pinned while they're here (see focusNode), so their
    // arrival doesn't stir the rest of the atlas.
    if (selected) {
      const members = new Set(selectedNeighbors.map((node) => node.id));
      for (const node of selectedNeighbors) {
        if (ids.has(node.id)) continue;
        nodes.push(node);
        ids.add(node.id);
      }
      const present = new Set(links);
      for (const link of data.links) {
        if (present.has(link)) continue;
        const source = String(link.source);
        const target = String(link.target);
        if (
          (source === selected.id && members.has(target)) ||
          (target === selected.id && members.has(source))
        ) {
          links.push(link);
        }
      }
    }
    return {
      nodes,
      // force-graph resolves endpoints to objects in place. Its working links
      // must not mutate the source dataset or subsequent filtering loses links.
      links: links.map((link) => ({ ...link })),
    };
  }, [data, forcedId, visibleGroups, visibleKinds, ghostSongs, selected, selectedNeighbors]);

  // Labels are a projected HTML overlay rather than children of the Three
  // scene. Clean entries only when their data node is truly filtered out.
  useEffect(() => {
    const ids = new Set(visibleData.nodes.map((node) => node.id));
    for (const [id, label] of labelDivsRef.current) {
      if (ids.has(id)) continue;
      label.div.remove();
      labelDivsRef.current.delete(id);
    }
  }, [visibleData.nodes]);

  // The detail drawer is a list, not a drawing: it uses every link, so hiding
  // a group or a link kind doesn't empty its "Collegato a". (The map's lens is
  // capped; see lensMembersOf.)
  const buildNeighbors = useCallback(
    (links: readonly { source: unknown; target: unknown }[]) => {
      const byId = new Map(data.nodes.map((node) => [node.id, node]));
      const map = new Map<string, Map<string, GraphNode>>();
      const add = (from: GraphNode, to: GraphNode) => {
        let bucket = map.get(from.id);
        if (!bucket) map.set(from.id, (bucket = new Map()));
        bucket.set(to.id, to);
      };
      for (const link of links) {
        const source = byId.get(endpointId(link.source));
        const target = byId.get(endpointId(link.target));
        if (!source || !target || source.id === target.id) continue;
        add(source, target);
        add(target, source);
      }
      const sorted = new Map<string, GraphNode[]>();
      for (const [id, bucket] of map) {
        sorted.set(
          id,
          [...bucket.values()].sort((a, b) => (b.val ?? 1) - (a.val ?? 1))
        );
      }
      return sorted;
    },
    [data.nodes]
  );
  const allNeighbors = useMemo(
    () => buildNeighbors(data.links),
    [buildNeighbors, data.links]
  );

  const panelNodeNeighbors = useMemo(
    () => (panelNode ? allNeighbors.get(panelNode.id) ?? [] : []),
    [allNeighbors, panelNode]
  );
  const highlightedIds = useMemo(() => {
    const set = new Set<string>();
    if (selected) {
      set.add(selected.id);
      for (const node of selectedNeighbors) set.add(node.id);
    }
    return set;
  }, [selected, selectedNeighbors]);
  // Hover only points: it enlarges the node under the cursor and names it.
  // The neighbourhood (dimming, edges, the lens) belongs to a click, so
  // sweeping the cursor across the cluster no longer flashes the whole map.
  const anchor = selected;
  const anchorIds = highlightedIds;

  // A hub like "Consumismo" has ~100 edges; lighting them all is a hairball
  // (and ~400 flowing particles). Rank the active node's edges by weight and
  // let only the strongest few be "primary": bright, thick and animated.
  const primaryLinks = useMemo(() => {
    if (!anchor) return null;
    const touching = visibleData.links.filter(
      (link) =>
        endpointId(link.source) === anchor.id || endpointId(link.target) === anchor.id
    );
    touching.sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
    return new Set(touching.slice(0, lite ? PRIMARY_LINKS_PHONE : PRIMARY_LINKS_DESKTOP).map(linkKey));
  }, [anchor, visibleData.links, lite]);

  useEffect(() => {
    songLabelsRef.current = !lite || highlightedIds.size <= PHONE_MAX_SONG_LABELS;
  }, [lite, highlightedIds]);
  const focus = useMemo(
    () => (anchor ? { self: anchor.id, ids: anchorIds } : null),
    [anchor, anchorIds]
  );
  // Render state and lens motion stay in refs so the per-frame loop does not
  // rebuild the Three scene while the pointer travels across nodes.
  const focusRef = useRef<{ self: string; ids: Set<string> } | null>(null);
  const selectedRef = useRef(selected);
  const lensMotionRef = useRef(new Map<string, LensMotion>());
  const lensMotionAtRef = useRef(0);
  // Screen-aligned axes of the lens, fixed when the selection is made from
  // the direction the camera will look at the node from.
  const lensBasisRef = useRef<{ right: Vector3; up: Vector3 } | null>(null);
  // Which arc each lens member sits on (1 right, -1 left): its label points
  // away from the selection, toward that side.
  const lensSideRef = useRef(new Map<string, number>());
  useEffect(() => {
    focusRef.current = focus;
    selectedRef.current = selected;
  }, [focus, selected]);
  // OrbitControls instance, kept for the planet gizmo (azimuth readout +
  // top-down snap). Populated by the tilt-clamp effect once the graph mounts.
  const controlsRef = useRef<{
    target: { x: number; y: number; z: number };
    minDistance: number;
    minPolarAngle: number;
    maxPolarAngle: number;
    autoRotate?: boolean;
    autoRotateSpeed?: number;
  } | null>(null);
  // Keyboard cursor: the node the arrow keys are currently "on". The tick loop
  // names and enlarges it; the state copy feeds the screen-reader announcement.
  const kbdIdRef = useRef<string | null>(null);
  const [kbdNode, setKbdNode] = useState<GraphNode | null>(null);
  const gizmoDotRef = useRef<HTMLDivElement | null>(null);
  const gizmoHeadingRef = useRef<HTMLSpanElement | null>(null);

  const fit = useCallback(() => {
    fgRef.current?.zoomToFit(flightMs(650), liteRef.current ? 60 : FIT_PADDING);
  }, []);

  // Atlas layout (lib/atlasLayout.ts): every node has a fixed home on the
  // career clock (albums by year, themes and figures near the albums that
  // cite them). The force below springs each node to its home. Link and
  // charge forces are off: a studio album has dozens of links, and even a
  // faint pull per link added up to dragging it halfway into the centre.
  // So is centring: the clock's centre of mass isn't its centre (the gap at
  // the bottom), and forceCenter slid the whole disc off its targets.
  const layoutTargets = useMemo(() => atlasLayout(data), [data]);
  const layoutTargetsRef = useRef(layoutTargets);
  // Album labels lead with their year, so the clock reads as a timeline.
  const yearOfAlbum = useMemo(() => albumYears(data), [data]);
  const studioAlbums = useMemo(() => studioAlbumIds(data), [data]);
  useEffect(() => {
    layoutTargetsRef.current = layoutTargets;
  }, [layoutTargets]);
  useEffect(() => {
    // Each tick closes this share of the gap to home. The velocity is set,
    // not accumulated, so nodes glide in without overshooting: an
    // accumulated spring was still swinging when the engine cooled, and
    // froze the layout off its targets.
    const RATE = 0.12;
    const UNFURL_MS = 2600;
    let tries = 0;
    const timer = window.setInterval(() => {
      const fg = fgRef.current;
      if (!fg && ++tries < 50) return;
      window.clearInterval(timer);
      if (!fg) return;
      let nodes: GraphNode[] = [];
      let t0 = 0;
      const home = () => {
        // one-off entrance: the disc starts tight and springs open. It holds
        // tight until the intro curtain lifts, so the visitor sees it happen.
        if (revealedRef.current && t0 === 0) t0 = performance.now();
        const u = reduceMotionRef.current
          ? 1
          : t0 === 0
            ? 0
            : Math.min(1, (performance.now() - t0) / UNFURL_MS);
        const unfurl = 0.15 + 0.85 * (1 - (1 - u) ** 3);
        const targets = layoutTargetsRef.current;
        for (const n of nodes) {
          const target = targets.get(n.id);
          if (!target) continue;
          const node = n as GraphNode & { vx?: number; vy?: number; vz?: number };
          node.vx = (target.x * unfurl - (n.x ?? 0)) * RATE;
          node.vy = (target.y * unfurl - (n.y ?? 0)) * RATE;
          node.vz = (target.z * unfurl - (n.z ?? 0)) * RATE;
        }
      };
      home.initialize = (ns: GraphNode[]) => {
        nodes = ns;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const forces = fg as any;
      forces.d3Force("importance", home);
      forces.d3Force("link")?.strength(0);
      forces.d3Force("charge")?.strength(0);
      forces.d3Force("center", null);
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
  // (or a cold dev server) it mounts well after this effect: poll until the
  // graph exists, then frame it once.
  //
  // The frame comes from the layout's own geometry, not from measuring the
  // nodes: while the cloud unfurls its bounding box changes every frame, and
  // re-fitting to it (as this used to, every 800ms) sent the camera back and
  // forth for half a minute. The camera now holds still and the cloud opens
  // inside the frame; once the layout has settled, one slow fit corrects any
  // difference (see onEngineStop), unless the visitor has taken over.
  //
  // Phones don't open on the whole cloud: framing it means fitting the far
  // rim nodes, so ~200 nodes end up as specks in 390px. They frame the core
  // (themes and figures) and the visitor drags out to the rest.
  const userMovedRef = useRef(false);
  const layoutDoneRef = useRef(false);
  const refitOnEngineStopRef = useRef(false);
  const settleFitDoneRef = useRef(false);
  useEffect(() => {
    const phone = liteRef.current;
    const ready = window.setInterval(() => {
      const fg = fgRef.current;
      if (!fg) return;
      window.clearInterval(ready);
      setSceneMounted(true);
      const dom = fg.renderer().domElement;
      // the outermost layout ring (the core rings on a phone)
      const extent = phone ? CORE_EXTENT : LAYOUT_EXTENT;
      const padding = phone ? 90 : FIT_PADDING;
      const distance = fitDistance(extent, padding, dom.clientWidth, dom.clientHeight);
      fg.cameraPosition(
        { x: 0, y: distance * Math.cos(START_POLAR), z: distance * Math.sin(START_POLAR) },
        { x: 0, y: 0, z: 0 },
        0
      );
    }, 100);
    return () => window.clearInterval(ready);
  }, []);

  // The selection lens. The layout itself never changes (no reheat): the
  // selected node's neighbours get a spring offset that carries them out of
  // the tangle onto an ellipse around it, facing the camera. The offsets are
  // stored apart from the layout, so deselecting returns every node to
  // exactly where it was.
  useEffect(() => {
    const motions = lensMotionRef.current;
    const visibleIds = new Set(visibleData.nodes.map((node) => node.id));
    for (const [id, motion] of motions) {
      if (!visibleIds.has(id)) motions.delete(id);
      else motion.target = { x: 0, y: 0, z: 0 };
    }
    const basis = lensBasisRef.current;
    if (!selected || !basis) return;
    const anchorHome = homeOf(motions, selected);
    if (!anchorHome) return;

    const ring = lensOrder(selectedNeighbors);
    const sides = lensSideRef.current;
    sides.clear();
    ring.forEach((node, index) => {
      const home = homeOf(motions, node);
      if (!home) return;
      let motion = motions.get(node.id);
      if (!motion) {
        motion = {
          node,
          home,
          offset: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          target: { x: 0, y: 0, z: 0 },
        };
        motions.set(node.id, motion);
      }
      motion.node = node;
      const slot = lensSlot(index, ring.length);
      sides.set(node.id, slot.side);
      motion.target = {
        x: anchorHome.x + basis.right.x * slot.x + basis.up.x * slot.y - home.x,
        y: anchorHome.y + basis.right.y * slot.x + basis.up.y * slot.y - home.y,
        z: anchorHome.z + basis.right.z * slot.x + basis.up.z * slot.y - home.z,
      };
    });
  }, [selected, selectedNeighbors, visibleData.nodes]);

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

  // A quiet idle orbit keeps the atlas dimensional while nobody is using it.
  // A mouse over the map stops it, so a node never drifts out from under a
  // cursor aiming at it (or resting on it while the visitor reads). It
  // resumes a while after the pointer leaves.
  const pointerEnter = useCallback(() => {
    if (pointerTimerRef.current !== null) window.clearTimeout(pointerTimerRef.current);
    pointerTimerRef.current = null;
    setPointerBusy(true);
  }, []);
  const pointerLeave = useCallback(() => {
    if (pointerTimerRef.current !== null) window.clearTimeout(pointerTimerRef.current);
    pointerTimerRef.current = window.setTimeout(() => {
      pointerTimerRef.current = null;
      setPointerBusy(false);
    }, IDLE_ORBIT_RESUME_MS);
  }, []);
  useEffect(
    () => () => {
      if (pointerTimerRef.current !== null) window.clearTimeout(pointerTimerRef.current);
    },
    []
  );
  useEffect(() => {
    let retry: number | undefined;
    let start: number | undefined;
    const idle =
      revealed &&
      isDesktop &&
      !reduceMotion &&
      !selected &&
      !hovered &&
      !pointerBusy &&
      !controlsOpen &&
      !searchFocused;
    const apply = () => {
      const controls = controlsRef.current;
      if (!controls) {
        retry = window.setTimeout(apply, 100);
        return;
      }
      controls.autoRotateSpeed = 0.45;
      controls.autoRotate = idle;
    };
    if (idle) {
      const openingDoneAt = revealAtRef.current + 3200;
      start = window.setTimeout(apply, Math.max(700, openingDoneAt - performance.now()));
    } else {
      apply();
    }
    return () => {
      if (retry !== undefined) window.clearTimeout(retry);
      if (start !== undefined) window.clearTimeout(start);
      if (controlsRef.current) controlsRef.current.autoRotate = false;
    };
  }, [controlsOpen, hovered, isDesktop, pointerBusy, reduceMotion, revealed, searchFocused, selected]);

  // ---- shared flat-shape textures + state materials -------------------
  // White textures; colour comes from the material, so a texture is never
  // rebuilt on theme change. `disc` is the default (colour tells categories
  // apart), `distinct` the accessibility silhouettes; the materials swap
  // between them in place (see the effect below).
  const shapeTextures = useMemo(() => {
    if (typeof window === "undefined") return null;
    const disc = makeDiscTexture();
    const discs = {} as Record<Group, DataTexture>;
    const distinct = {} as Record<Group, DataTexture>;
    for (const group of ALL_GROUPS) {
      discs[group] = disc;
      distinct[group] = group === "song" ? disc : makeShapeTexture(group);
    }
    return { discs, distinct };
  }, []);

  const materials = useMemo(() => {
    if (!shapeTextures) return null;
    const make = (opacity: number) => {
      const byGroup = {} as Record<Group, SpriteMaterial>;
      for (const group of ALL_GROUPS) {
        byGroup[group] = new SpriteMaterial({
          map: shapeTextures.discs[group],
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

  useEffect(() => {
    if (!materials || !shapeTextures) return;
    const set = distinctShapes ? shapeTextures.distinct : shapeTextures.discs;
    for (const state of [materials.idle, materials.hover, materials.hi, materials.dim]) {
      for (const group of ALL_GROUPS) {
        state[group].map = set[group];
        state[group].needsUpdate = true;
      }
    }
  }, [materials, shapeTextures, distinctShapes]);

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
      // hovering keeps the node's own colour, only stronger
      materials.hover[group].color.set(
        categoryIdle ? GROUP_COLOR[group] : theme.node
      );
    }
    for (const group of ALL_GROUPS) {
      materials.hi[group].color.set(theme.node);
      materials.dim[group].color.set(theme.node);
    }
  }, [materials, theme.node, colorMode, selected]);

  useEffect(() => {
    let raf = 0;
    const tmp = new Vector3();
    const ndc = new Vector3();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const camera = fgRef.current?.camera();
      if (!camera) return;
      const mats = materials;
      if (!mats) return;
      const focus = focusRef.current;
      const now = performance.now();
      const dt = Math.min(0.05, lensMotionAtRef.current ? (now - lensMotionAtRef.current) / 1000 : 0.016);
      lensMotionAtRef.current = now;
      let motionChanged = false;
      for (const [id, motion] of lensMotionRef.current) {
        for (const axis of ["x", "y", "z"] as const) {
          if (reduceMotionRef.current) {
            motion.offset[axis] = motion.target[axis];
            motion.velocity[axis] = 0;
          } else {
            const acceleration =
              (motion.target[axis] - motion.offset[axis]) * LENS_SPRING -
              motion.velocity[axis] * LENS_DAMPING;
            motion.velocity[axis] += acceleration * dt;
            motion.offset[axis] += motion.velocity[axis] * dt;
          }
        }
        const x = motion.home.x + motion.offset.x;
        const y = motion.home.y + motion.offset.y;
        const z = motion.home.z + motion.offset.z;
        if (
          Math.abs((motion.node.x ?? x) - x) > 0.001 ||
          Math.abs((motion.node.y ?? y) - y) > 0.001 ||
          Math.abs((motion.node.z ?? z) - z) > 0.001 ||
          Math.abs(motion.velocity.x) > 0.01 ||
          Math.abs(motion.velocity.y) > 0.01 ||
          Math.abs(motion.velocity.z) > 0.01
        ) {
          motionChanged = true;
        }
        // the pin moves with it, so a running simulation agrees
        motion.node.x = motion.node.fx = x;
        motion.node.y = motion.node.fy = y;
        motion.node.z = motion.node.fz = z;
        const returning =
          motion.target.x === 0 && motion.target.y === 0 && motion.target.z === 0;
        const settled =
          Math.abs(motion.offset.x) < 0.01 &&
          Math.abs(motion.offset.y) < 0.01 &&
          Math.abs(motion.offset.z) < 0.01 &&
          Math.abs(motion.velocity.x) < 0.01 &&
          Math.abs(motion.velocity.y) < 0.01 &&
          Math.abs(motion.velocity.z) < 0.01;
        if (returning && settled) lensMotionRef.current.delete(id);
      }
      if (motionChanged) fgRef.current?.refresh();

      const entranceFor = (id: string) => {
        if (reduceMotionRef.current) return 1;
        if (!revealAtRef.current) return 0.01;
        const delay = hash01(`${id}:entrance`) * 700;
        const progress = Math.min(1, Math.max(0.01, (now - revealAtRef.current - delay) / 1200));
        return 1 - (1 - progress) ** 3;
      };

      // The desktop detail panel covers the right third of the screen. A
      // projection view-offset slides the whole scene left by half the panel
      // width, so the selected node sits in the middle of what is still
      // visible. Unlike moving the camera, it can't fight the orbit controls'
      // polar clamp, and projected labels + raycasting follow it. (Phones show
      // the detail as a full page, so they need no offset.)
      const wanted = selectedRef.current ? desktopPanelWidth() / 2 : 0;
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
      const hoveredId = hoveredIdRef.current;
      for (const [id, { sprite, base, group, hit }] of spriteRefs.current.entries()) {
        // Ghost songs are neither drawn nor hit-testable.
        const ghost =
          group === "song" && ghostSongsRef.current && !(focus && focus.ids.has(id));
        if (sprite.visible === ghost) {
          sprite.visible = !ghost;
          sprite.raycast = ghost ? () => {} : hit;
        }
        const pointed = id === hoveredId || id === kbdIdRef.current;
        const state = !focus
          ? pointed
            ? "hover"
            : "idle"
          : id === focus.self
            ? "hover"
            : focus.ids.has(id)
              ? "hi"
              : pointed
                ? "hover"
                : "dim";
        const material = mats[state][group];
        if (sprite.material !== material) sprite.material = material;
        // Outside the lens the rest of the atlas shrinks to faint specks: it
        // stays as context, but the ring is the only subject.
        const factor =
          pointed || (focus && id === focus.self)
            ? 1.4
            : state === "hi"
              ? 1.2
              : state === "dim"
                ? 0.55
                : 1;
        // lens members share a fixed, smaller dot so the arcs don't overlap
        const size =
          state === "hi" ? Math.min(base * factor, LENS_DOT * (pointed ? 1.4 : 1)) : base * factor;
        const scale = size * entranceFor(id);
        if (Math.abs(sprite.scale.x - scale) > 0.01) {
          sprite.scale.set(scale, scale, 1);
        }
      }
      // Project labels into a stable HTML layer. This keeps text crisp and,
      // unlike CSS2D scene children, survives graph-data updates when the song
      // layer or a relationship layer is toggled.
      type Candidate = {
        div: HTMLDivElement;
        distance: number;
        screenX: number;
        screenY: number;
        halfWidth: number;
        rank: number;
        node: GraphNode;
        // vertical centre of the label box (labels sit above their dot,
        // lens labels beside it)
        boxY: number;
        // ambient only: the dot, the outward direction and the alignment
        radial?: { x: number; y: number; ux: number; uy: number; ax: number; ay: number };
      };
      const candidates: Candidate[] = [];
      // Lens labels compete for room too (heaviest first), so a big ring
      // shows the names that fit and the rest appear under the cursor.
      const lensCandidates: Candidate[] = [];
      const placed: Candidate[] = [];
      const fits = (candidate: Candidate, pad = LABEL_PAD) =>
        !placed.some(
          (other) =>
            Math.abs(candidate.screenY - other.screenY) < 13 &&
            Math.abs(candidate.screenX - other.screenX) <
              candidate.halfWidth + other.halfWidth + pad
        );
      // Put an ambient label `gap` px out from its dot (see the candidate
      // below) and update its collision box to match.
      const placeRadial = (candidate: Candidate, gap: number) => {
        const r = candidate.radial;
        if (!r) return;
        const anchorX = r.x + r.ux * gap;
        const anchorY = r.y + r.uy * gap;
        candidate.div.style.transform = `translate3d(${anchorX}px, ${anchorY}px, 0) translate(${(r.ax - 1) * 50}%, ${(r.ay - 1) * 50}%)`;
        candidate.screenX = anchorX + r.ax * candidate.halfWidth;
        candidate.screenY = candidate.boxY = anchorY + r.ay * LABEL_HALF_HEIGHT;
      };
      // The disc's centre on screen: ambient labels point away from it, so
      // the album ring is named from outside and the inner rings stay clear.
      let centreX = 0;
      let centreY = 0;
      if (dom) {
        ndc.set(0, 0, 0).project(camera);
        centreX = ((ndc.x + 1) / 2) * dom.clientWidth;
        centreY = ((1 - ndc.y) / 2) * dom.clientHeight;
      }
      const halfWidthOf = (div: HTMLDivElement) =>
        Math.min(110, Math.max(18, (div.textContent?.length ?? 0) * 3.2));
      // Ambient labels collide on their real width (measureLabel): the
      // estimate above runs short for long theme names, which then
      // overlapped their neighbours once the overview was close enough to
      // name them.
      const measuredHalfWidthOf = (div: HTMLDivElement) =>
        Number(div.dataset.halfWidth) || halfWidthOf(div);
      const tip = hoverTipRef.current;
      let tipShown = false;
      // Pointer picking, in screen space: the node nearest the cursor within
      // PICK_RADIUS wins, rather than whichever disc a ray meets first. In the
      // dense core that is the node you are pointing at, and a tiny far-off
      // disc doesn't demand pixel precision. Done every frame, so it stays
      // right while the camera flies or the lens springs open.
      const pointer = pointerRef.current;
      const picking = pointer.inside && !pointer.dragging;
      let pick: GraphNode | null = null;
      let pickDistance = PICK_RADIUS;
      const labelLayer = labelLayerRef.current;
      for (const [id, { div, group, node }] of labelDivsRef.current.entries()) {
        if (labelLayer && !div.isConnected) labelLayer.appendChild(div);
        if (
          !dom ||
          node.x === undefined ||
          node.y === undefined ||
          node.z === undefined
        ) {
          div.style.display = "none";
          continue;
        }
        tmp.set(node.x, node.y, node.z);
        const distance = camera.position.distanceTo(tmp);
        ndc.copy(tmp).project(camera);
        const onScreen = Math.abs(ndc.x) < 1.05 && Math.abs(ndc.y) < 1.05 && ndc.z < 1;
        if (!onScreen) {
          div.style.display = "none";
          continue;
        }
        const screenX = ((ndc.x + 1) / 2) * dom.clientWidth;
        const screenY = ((1 - ndc.y) / 2) * dom.clientHeight;
        if (picking && spriteRefs.current.get(id)?.sprite.visible) {
          const away = Math.hypot(screenX - pointer.x, screenY - pointer.y);
          if (away < pickDistance) {
            pickDistance = away;
            pick = node;
          }
        }
        div.style.transform = `translate3d(${screenX}px, ${screenY - 8}px, 0) translate(-50%, -100%)`;
        div.style.zIndex = String(Math.max(0, Math.round(100000 - distance * 100)));

        const cursor = id === kbdIdRef.current;
        const self = focus !== null && id === focus.self;
        const inLens = focus !== null && !self && focus.ids.has(id);
        const canShowLit = group !== "song" || songLabelsRef.current;
        const baseOpacity = Number(div.dataset.baseOpacity ?? "0.5");
        const entrance = entranceFor(id);
        const halfWidth = halfWidthOf(div);
        const ambientHalfWidth = measuredHalfWidthOf(div);
        const lit = cursor || self || inLens;
        div.style.color = lit ? "var(--atlas-label-hi)" : "var(--atlas-label)";
        div.style.opacity = String((lit ? 1 : baseOpacity) * entrance);
        div.style.display = "none";

        // The node under the cursor is named by the tooltip, which also says
        // what kind of node it is; its own label steps aside (the tooltip
        // covers the same spot, so pointing at the name keeps the pick). A
        // lens member keeps its name in its column, underlined instead.
        const pointed = id === hoveredId;
        div.classList.toggle("is-pointed", pointed && inLens);
        if (pointed && !inLens) {
          if (tip) {
            tip.style.transform = `translate3d(${screenX}px, ${screenY - 12}px, 0) translate(-50%, -100%)`;
            tipShown = true;
          }
          placed.push({ div, distance, screenX, screenY, halfWidth, rank: Infinity, node, boxY: screenY - 14 });
          continue;
        }
        if (self || cursor) {
          div.style.display = "block";
          placed.push({ div, distance, screenX, screenY, halfWidth, rank: Infinity, node, boxY: screenY - 14 });
          continue;
        }
        if (inLens) {
          // Lens names point away from the selection, beside their dot, so
          // each arc reads as a list and no name sits on a spoke.
          const side = lensSideRef.current.get(id) ?? 1;
          div.style.transform =
            side === 1
              ? `translate3d(${screenX + 10}px, ${screenY}px, 0) translate(0, -50%)`
              : `translate3d(${screenX - 10}px, ${screenY}px, 0) translate(-100%, -50%)`;
          if (canShowLit) {
            lensCandidates.push({
              div,
              distance,
              screenX: screenX + side * (halfWidth + 10),
              screenY,
              halfWidth,
              rank: pointed ? Infinity : Number(div.dataset.rank ?? "0"),
              node,
              boxY: screenY,
            });
          }
          continue;
        }
        // With a lens open the rest of the atlas is unnamed context.
        if (focus) continue;

        const ghostSong = group === "song" && ghostSongsRef.current;
        if (!ghostSong && distance < Number(div.dataset.maxDistance)) {
          // Outward from the centre: a name on the right of the disc starts
          // at its dot, one on the left ends there, one at the top or bottom
          // sits above or below it. The alignment blends between these, so a
          // label glides round its dot as the clock turns instead of jumping.
          const dx = screenX - centreX;
          const dy = screenY - centreY;
          const len = Math.hypot(dx, dy) || 1;
          const ax = Math.max(-1, Math.min(1, (dx / len) * 3));
          const ay = Math.max(-1, Math.min(1, (dy / len) * 3));
          const candidate: Candidate = {
            div,
            distance,
            screenX,
            screenY,
            halfWidth: ambientHalfWidth,
            rank: Number(div.dataset.tier),
            node,
            boxY: screenY,
            radial: { x: screenX, y: screenY, ux: dx / len, uy: dy / len, ax, ay },
          };
          placeRadial(candidate, LABEL_GAP);
          candidates.push(candidate);
        }
      }
      if (tip) tip.style.opacity = tipShown ? "1" : "0";
      lensCandidates.sort((a, b) => b.rank - a.rank);
      for (const candidate of lensCandidates) {
        if (!fits(candidate)) continue;
        placed.push(candidate);
        candidate.div.style.display = "block";
      }
      // However close the camera is, only the nearest non-overlapping ambient
      // labels show. The selection, its lens and the cursor bypass this budget.
      // Albums before the inner rings; within a tier, names already on
      // screen keep their place, then the nearest win.
      const wasShown = labelShownRef.current;
      candidates.sort(
        (a, b) =>
          a.rank - b.rank ||
          Number(wasShown.has(b.node.id)) - Number(wasShown.has(a.node.id)) ||
          a.distance - b.distance
      );
      const budget = liteRef.current ? PHONE_MAX_AMBIENT_LABELS : MAX_AMBIENT_LABELS;
      const shown = new Set<string>();
      const ambientOpacity = new Map<string, number>();
      for (const candidate of candidates) {
        if (shown.size >= budget) break;
        const pad = wasShown.has(candidate.node.id) ? LABEL_PAD_KEEP : LABEL_PAD;
        if (!fits(candidate, pad)) {
          placeRadial(candidate, LABEL_GAP + LABEL_STEP_OUT);
          if (!fits(candidate, pad)) {
            placeRadial(candidate, LABEL_GAP);
            continue;
          }
        }
        placed.push(candidate);
        shown.add(candidate.node.id);
        const depthOpacity = 1 - 0.45 * ((shown.size - 1) / budget);
        ambientOpacity.set(candidate.node.id, depthOpacity);
      }
      // Fade: a newly placed name eases in, a displaced one eases out where
      // it stood. Lit labels (selection, lens, cursor) never fade.
      const frameMs = Math.min(100, now - (labelFrameRef.current || now));
      labelFrameRef.current = now;
      const step = reduceMotionRef.current ? 1 : frameMs / LABEL_FADE_MS;
      const fades = new Map<string, number>();
      for (const candidate of candidates) {
        const id = candidate.node.id;
        const target = shown.has(id) ? 1 : 0;
        const was = labelFadeRef.current.get(id) ?? 0;
        const fade = target > was ? Math.min(1, was + step) : Math.max(0, was - step);
        if (fade <= 0) continue;
        fades.set(id, fade);
        const baseOpacity = Number(candidate.div.dataset.baseOpacity ?? "0.5");
        candidate.div.style.display = "block";
        candidate.div.style.opacity = String(
          baseOpacity * (ambientOpacity.get(id) ?? 0.55) * fade * entranceFor(id)
        );
      }
      labelFadeRef.current = fades;
      labelShownRef.current = shown;
      // A name on screen is as good as its dot: pointing at a visible label
      // picks its node.
      if (picking) {
        for (const label of placed) {
          const shown =
            label.div.style.display === "block" || label.node.id === hoveredIdRef.current;
          if (!shown) continue;
          if (
            Math.abs(pointer.x - label.screenX) <= label.halfWidth + 4 &&
            Math.abs(pointer.y - label.boxY) <= 9
          ) {
            pick = label.node;
            break;
          }
        }
      }
      const pickId = pick?.id ?? null;
      if (pickId !== hoveredIdRef.current) {
        hoveredIdRef.current = pickId;
        hoveredNodeRef.current = pick;
        setHoveredRef.current(pick);
      }
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
    setTrail([]);
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
    const counts: Record<LinkKind, number> = { on: 0, refers: 0, album_refers: 0, co_occurs: 0 };
    for (const link of data.links) counts[link.kind] += 1;
    return counts;
  }, [data]);

  const toggleKind = useCallback(
    (kind: LinkKind) => {
      releasePins(data.nodes);
      refitOnEngineStopRef.current = true;
      window.setTimeout(() => {
        if (refitOnEngineStopRef.current) fit();
      }, 900);
      setVisibleKinds((previous) => {
        const next = new Set(previous);
        const willShow = !next.has(kind);
        if (willShow) next.add(kind);
        else next.delete(kind);
        play(() => sound.toggle(willShow));
        return next;
      });
    },
    [data.nodes, fit, play]
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

  // Songs are evidence, not overview structure. They start hidden on every
  // device and become a regular graph layer only when the visitor asks for
  // them. Search can still surface one song without enabling all 254.
  const layerOn = (group: Group) =>
    group === "song" && lite ? songMode === "all" : visibleGroups.has(group);

  const toggleGroup = useCallback(
    (group: Group) => {
      releasePins(data.nodes);
      refitOnEngineStopRef.current = true;
      window.setTimeout(() => {
        if (refitOnEngineStopRef.current) fit();
      }, 900);
      setVisibleGroups((previous) => {
        const next = new Set(previous);
        const willShow = !next.has(group);
        if (willShow) next.add(group);
        else next.delete(group);
        play(() => sound.toggle(willShow));
        return next;
      });
    },
    [data.nodes, fit, play]
  );

  const toggleLayer = (group: Group) => {
    if (group !== "song") {
      toggleGroup(group);
      return;
    }
    releasePins(data.nodes);
    refitOnEngineStopRef.current = true;
    const willShow = lite ? songMode === "focus" : !visibleGroups.has("song");
    if (willShow) {
      setVisibleKinds((previous) => new Set([...previous, "on", "refers"]));
    }
    if (lite) {
      play(() => sound.toggle(willShow));
      setSongMode(willShow ? "all" : "focus");
      setVisibleGroups((previous) => {
        const next = new Set(previous);
        if (willShow) next.add("song");
        else next.delete("song");
        return next;
      });
    } else {
      toggleGroup("song");
    }
  };

  const toggleColorMode = () => {
    setColorMode((mode) => {
      const next = mode === "mono" ? "group" : "mono";
      play(() => sound.toggle(next === "group"));
      return next;
    });
  };

  const focusNode = useCallback(
    (node: GraphNode) => {
      // Pin the layout where it stands. Opening a lens adds its guests to the
      // graph, which wakes the simulation; pinned, nothing else moves. (Layer
      // toggles release the pins and let the atlas re-settle.) Displaced lens
      // members are pinned where they are; the render loop moves their pins
      // as they spring to their next place.
      const motions = lensMotionRef.current;
      const shown = new Set(visibleData.nodes.map((each) => each.id));
      const laidOut = (each: GraphNode) => visibleGroups.has(each.group);
      for (const each of visibleData.nodes) {
        if (each.x === undefined || each.y === undefined || each.z === undefined) continue;
        pinAt(each, { x: each.x, y: each.y, z: each.z });
      }
      if (!laidOut(node)) {
        // Not part of the layout: a guest of the current lens re-centres where
        // it stands; one reached by search lands among its linked nodes.
        let at: Vec3 = { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 };
        if (!shown.has(node.id) || node.x === undefined) {
          const around = (allNeighbors.get(node.id) ?? []).filter(
            (other) => laidOut(other) && other.x !== undefined
          );
          at = { x: 0, y: 0, z: 0 };
          for (const other of around) {
            at.x += (other.x ?? 0) / around.length;
            at.y += (other.y ?? 0) / around.length;
            at.z += (other.z ?? 0) / around.length;
          }
        }
        pinAt(node, at);
        motions.delete(node.id);
      }
      // New guests (members from hidden layers) bloom out of the selection.
      const anchorAt = homeOf(motions, node);
      if (anchorAt) {
        for (const member of lensMembersOf(node.id)) {
          if (laidOut(member) || shown.has(member.id)) continue;
          pinAt(member, anchorAt);
          motions.delete(member.id);
        }
      }

      // The lens faces the camera from where it is now: the flight below keeps
      // that viewing direction, so the ring is seen straight on.
      const camera = fgRef.current?.camera();
      const home = homeOf(motions, node);
      if (camera && home) {
        const toCamera = new Vector3(
          camera.position.x - home.x,
          camera.position.y - home.y,
          camera.position.z - home.z
        ).normalize();
        const right = new Vector3().crossVectors(camera.up, toCamera).normalize();
        const up = new Vector3().crossVectors(toCamera, right).normalize();
        lensBasisRef.current = { right, up };
      }
      // Stepping to a neighbour extends the breadcrumb; going back to a crumb
      // trims it; anything else (search, a far node) starts a new walk.
      setTrail((previous) => {
        const at = previous.findIndex((crumb) => crumb.id === node.id);
        if (at >= 0) return previous.slice(0, at + 1);
        const last = previous[previous.length - 1];
        const linked = last && allNeighbors.get(last.id)?.some((n) => n.id === node.id);
        return linked ? [...previous, node] : [node];
      });
      // A selection is the visitor taking the camera: the start-up framing
      // that follows the unfurling layout must not pull it back out.
      userMovedRef.current = true;
      refitOnEngineStopRef.current = false;
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
        const target = homeOf(lensMotionRef.current, node);
        if (!target && attempts++ < 5) {
          window.setTimeout(moveToNode, 120);
          return;
        }
        // Aim at the node's place in the layout: if it was sitting on the
        // previous lens it is springing back there now.
        const { x, y, z } = target ?? { x: 0, y: 0, z: 0 };

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
        // A lens pushes the floor out so both arcs and their names fit.
        const ringCount = lensMembersOf(node.id).length;
        const standoff = Math.max(
          Math.min(Math.max(distance, FOCUS_MIN_DISTANCE), FOCUS_MAX_DISTANCE),
          lensExtent(ringCount) * 5.6
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
    [allNeighbors, lensMembersOf, play, visibleData.nodes, visibleGroups]
  );

  // Keyboard navigation on the map. Arrows hop to the nearest node in that
  // direction on screen, Enter opens it, +/- zoom, Esc lets go. Ignored while
  // typing or while a button/link has focus, so Tab and the panels keep working.
  useEffect(() => {
    const project = new Vector3();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (active && active !== document.body && !(active as HTMLElement).dataset.atlasStage) return;
      const fg = fgRef.current;
      const camera = fg?.camera() as PerspectiveCamera | undefined;
      const controls = controlsRef.current;
      if (!fg || !camera || !controls) return;

      const zoom = (factor: number) => {
        userMovedRef.current = true;
        const target = controls.target;
        const dx = camera.position.x - target.x;
        const dy = camera.position.y - target.y;
        const dz = camera.position.z - target.z;
        const distance = Math.hypot(dx, dy, dz);
        const next = Math.min(MAX_CAMERA_DISTANCE, Math.max(MIN_CAMERA_DISTANCE, distance * factor));
        const k = next / distance;
        fg.cameraPosition(
          { x: target.x + dx * k, y: target.y + dy * k, z: target.z + dz * k },
          { x: target.x, y: target.y, z: target.z },
          flightMs(260)
        );
      };

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoom(KEY_ZOOM_STEP);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoom(1 / KEY_ZOOM_STEP);
        return;
      }
      if (event.key === "Escape") {
        kbdIdRef.current = null;
        setKbdNode(null);
        return;
      }

      const byId = new Map(visibleData.nodes.map((node) => [String(node.id), node]));
      const current = kbdIdRef.current ? byId.get(kbdIdRef.current) : undefined;
      if (event.key === "Enter" || event.key === " ") {
        if (!current) return;
        event.preventDefault();
        focusNode(current);
        return;
      }
      const dir: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const u = dir[event.key];
      if (!u) return;
      event.preventDefault();

      const dom = fg.renderer().domElement;
      const toScreen = (node: GraphNode) => {
        project.set(node.x ?? 0, node.y ?? 0, node.z ?? 0).project(camera);
        return {
          x: ((project.x + 1) / 2) * dom.clientWidth,
          y: ((1 - project.y) / 2) * dom.clientHeight,
          behind: project.z > 1,
        };
      };
      const named = (node: GraphNode) =>
        node.x !== undefined &&
        !(
          node.group === "song" &&
          ghostSongs &&
          !highlightedIds.has(node.id)
        );
      const pool = visibleData.nodes.filter(named);

      let next: GraphNode | undefined;
      if (!current) {
        // first press: the node nearest the middle of the view
        let best = Infinity;
        const cx = dom.clientWidth / 2;
        const cy = dom.clientHeight / 2;
        for (const node of pool) {
          const p = toScreen(node);
          if (p.behind) continue;
          const d = Math.hypot(p.x - cx, p.y - cy);
          if (d < best) {
            best = d;
            next = node;
          }
        }
      } else {
        const origin = toScreen(current);
        let best = Infinity;
        for (const node of pool) {
          if (node.id === current.id) continue;
          const p = toScreen(node);
          if (p.behind) continue;
          const dx = p.x - origin.x;
          const dy = p.y - origin.y;
          const along = dx * u[0] + dy * u[1];
          const across = Math.abs(dx * u[1] - dy * u[0]);
          // inside a ~60° cone, penalising sideways drift
          if (along <= 1 || across > along * 1.7) continue;
          const score = along + across * 2;
          if (score < best) {
            best = score;
            next = node;
          }
        }
      }
      if (!next) return;

      kbdIdRef.current = next.id;
      setKbdNode(next);
      play(sound.hover);

      // Keep the cursor in view: pan only when it nears the frame edge.
      const p = toScreen(next);
      const margin = 0.18;
      const inside =
        p.x > dom.clientWidth * margin &&
        p.x < dom.clientWidth * (1 - margin) &&
        p.y > dom.clientHeight * margin &&
        p.y < dom.clientHeight * (1 - margin);
      if (!inside) {
        const t = controls.target;
        fg.cameraPosition(
          {
            x: (next.x ?? 0) + camera.position.x - t.x,
            y: (next.y ?? 0) + camera.position.y - t.y,
            z: (next.z ?? 0) + camera.position.z - t.z,
          },
          { x: next.x ?? 0, y: next.y ?? 0, z: next.z ?? 0 },
          flightMs(380)
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visibleData.nodes, ghostSongs, highlightedIds, focusNode, play]);

  // Sweeping across the cluster is silent: the tick plays only once the
  // cursor has settled on a node.
  useEffect(() => {
    const id = hovered?.id ?? null;
    if (!id || id === prevHoveredId.current) {
      prevHoveredId.current = id;
      return;
    }
    const timer = window.setTimeout(() => {
      prevHoveredId.current = id;
      play(sound.hover);
    }, HOVER_SOUND_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [hovered, play]);

  // Labels are always projected into a dedicated HTML overlay. A node without
  // a visible name is effectively unclickable inside a dense graph.
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

      // The same node can be rebuilt (a layer was toggled): replace its old
      // label instead of leaving duplicate DOM nodes behind.
      labelDivsRef.current.get(String(n.id))?.div.remove();
      const div = document.createElement("div");
      div.className = "atlas-label";
      const year = n.group === "album" ? yearOfAlbum.get(n.id) : undefined;
      if (year !== undefined) {
        const tag = document.createElement("span");
        tag.className = "atlas-label-year";
        tag.textContent = `${year} `;
        div.append(tag, n.label);
      } else {
        div.textContent = n.label;
      }
      div.dataset.nodeId = n.id;
      div.style.display = "none";
      div.style.position = "absolute";
      div.style.left = "0";
      div.style.top = "0";
      const importance = Math.min(1, Math.max(0, ((n.val ?? 2) - 2) / 7));
      // Albums are the clock's spine and carry the overview; themes and
      // figures are quieter inner rings, named once the camera comes close.
      const lead = studioAlbums.has(n.id);
      div.dataset.tier = String(lead ? 0 : LABEL_TIER[n.group]);
      div.dataset.maxDistance = String(lead ? Infinity : LABEL_MAX_DISTANCE[n.group]);
      div.dataset.baseOpacity = String(lead ? 0.6 + importance * 0.35 : 0.5 + importance * 0.2);
      div.dataset.rank = String(n.val ?? 2);
      div.style.setProperty(
        "--label-size",
        `${(lead ? 9 + importance * 3 : 9 + importance * 1).toFixed(1)}px`
      );
      labelLayerRef.current?.appendChild(div);
      measureLabel(div);
      labelDivsRef.current.set(String(n.id), { div, group: n.group, node: n });

      return group;
    },
    [materials, yearOfAlbum, studioAlbums]
  );

  useEffect(
    () => () => {
      for (const label of labelDivsRef.current.values()) label.div.remove();
      labelDivsRef.current.clear();
    },
    []
  );
  // Labels made before the web font arrived were measured in the fallback.
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => {
      if (!live) return;
      for (const label of labelDivsRef.current.values()) measureLabel(label.div);
    });
    return () => {
      live = false;
    };
  }, []);

  const groupById = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node.group])),
    [data.nodes]
  );

  // On touch the sprite hit-test alone is too fiddly: when a tap misses
  // every disc, pick the nearest visible node within a finger's reach.
  // Only a tap with nothing near it deselects (or, twice, re-frames all).
  const handleBackgroundClick = (event: MouseEvent) => {
    // A click near a node (or on its name) opens it: no pixel hunting.
    if (!lite && hoveredNodeRef.current) {
      focusNode(hoveredNodeRef.current);
      return;
    }
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
        "--atlas-label": `color-mix(in oklch, ${theme.ink} 78%, transparent)`,
        "--atlas-label-hi": theme.ink,
        // The pen strokes follow the theme ink/paper, so sketches recolour
        // together with the canvas when the rgb mode kicks in.
        "--drawably-stroke": theme.ink,
        "--drawably-fill": theme.ink,
        "--drawably-paper": theme.bg,
      } as React.CSSProperties}
    >
      <div
        // Keep graph labels below controls and detail panels.
        className="relative isolate flex-1"
        style={{ cursor: hovered ? "pointer" : undefined }}
        // Wheel / trackpad zoom is no pointerdown: without this the start-up
        // camera follow kept re-fitting and snapped the visitor back out.
        onWheel={() => {
          userMovedRef.current = true;
          refitOnEngineStopRef.current = false;
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") pointerEnter();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse") return;
          pointerRef.current.inside = false;
          pointerLeave();
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("nav, button, a, input")) return;
          userMovedRef.current = true;
          refitOnEngineStopRef.current = false;
          hintDoneRef.current = true;
          setHintOn(false);
          dragStartRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse") {
            // a mouse already inside at load never fires pointerenter
            if (!pointerBusy) pointerEnter();
            // Picking happens in the render loop; this only records where the
            // mouse is. Over the panels and buttons nothing is picked, and a
            // drag (rotating the map) picks nothing either.
            const rect = event.currentTarget.getBoundingClientRect();
            const pointer = pointerRef.current;
            pointer.x = event.clientX - rect.left;
            pointer.y = event.clientY - rect.top;
            pointer.inside = (event.target as HTMLElement).tagName === "CANVAS";
            pointer.dragging = event.buttons !== 0;
          }
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
          // ...and the lens draws straight spokes: curls around a ring of
          // neighbours read as noise, a spoke reads as "linked to this".
          linkCurvature={(link) =>
            lite || focus ? 0 : 0.45 + 0.5 * hash01(linkKey(link))
          }
          linkCurveRotation={(link) => Math.PI * 2 * hash01(linkKey(link) + "r")}
          linkDirectionalParticleWidth={3}
          linkDirectionalParticleSpeed={0.004}
          linkDirectionalParticleColor={() => theme.ink}
          linkOpacity={0.9}
          linkVisibility={(link) => {
            // Selected: only that node's own edges are drawn at all. Hidden
            // links cost nothing, unlike merely transparent ones.
            if (focus) {
              // only spokes from the selection to the members of its lens
              const source = endpointId(link.source);
              const target = endpointId(link.target);
              const other = source === focus.self ? target : target === focus.self ? source : null;
              return other !== null && focus.ids.has(other);
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
            if (refitOnEngineStopRef.current) {
              refitOnEngineStopRef.current = false;
              fit();
              return;
            }
            // The one start-up correction: the layout has settled after the
            // curtain lifted, and the visitor hasn't moved the camera yet.
            if (revealedRef.current && !settleFitDoneRef.current) {
              settleFitDoneRef.current = true;
              if (userMovedRef.current) return;
              if (liteRef.current) {
                fgRef.current?.zoomToFit(flightMs(1400), 90, (node) => {
                  const group = (node as GraphNode).group;
                  return group === "concept" || group === "figure";
                });
              } else {
                fgRef.current?.zoomToFit(flightMs(1400), FIT_PADDING);
              }
            }
          }}
          // The click opens what the render loop picked (nearest to the
          // cursor, or a pointed name), which may differ from the disc a ray
          // hit first.
          onNodeClick={(node) => focusNode(hoveredNodeRef.current ?? (node as GraphNode))}
          // Clicking empty space is the gesture for "deselect" — the only
          // two ways the current selection changes are a click on another
          // note and a click on empty canvas (hover never touches it).
          onBackgroundClick={handleBackgroundClick}
          // hover is picked by the render loop instead (see "Pointer picking")
          showPointerCursor={false}
        />
        <div
          ref={labelLayerRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[2] overflow-hidden"
        />
        {/* hover tooltip: name + kind of the node under the cursor, placed
            by the render loop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[3] overflow-hidden"
        >
          <div
            ref={hoverTipRef}
            className="atlas-tip"
            style={{ opacity: 0, background: theme.bg }}
          >
            {hovered && (
              <>
                <span className="atlas-tip-name">{hovered.label}</span>
                <span className="atlas-tip-kind">
                  {GROUP_LABEL[hovered.group]}
                  {selected && hovered.id !== selected.id ? " · clicca per aprire" : ""}
                </span>
              </>
            )}
          </div>
        </div>

        {/* breadcrumb of the walk through the lens */}
        {isDesktop && trail.length > 0 && selected && (
          <nav
            aria-label="Percorso"
            className="atlas-trail absolute left-[12.5rem] top-9 z-10 flex items-center gap-1.5 font-mono text-xs"
            style={{ maxWidth: `calc(100% - 12.5rem - ${desktopPanelWidth()}px - 2rem)` }}
          >
            <button
              onClick={() => {
                closeDetail();
                fit();
              }}
              className="atlas-trail-step"
              title="Torna alla vista d'insieme"
            >
              Atlante
            </button>
            {trail.map((crumb, index) => {
              const current = index === trail.length - 1;
              return (
                <span key={crumb.id} className="flex min-w-0 items-center gap-1.5">
                  <span aria-hidden="true" className="opacity-40">›</span>
                  <button
                    onClick={() => !current && focusNode(crumb)}
                    aria-current={current ? "location" : undefined}
                    className="atlas-trail-step truncate"
                    disabled={current}
                  >
                    {crumb.label}
                  </button>
                </span>
              );
            })}
          </nav>
        )}

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
                          <GroupGlyph group={node.group} distinct={distinctShapes} />
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

            <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--atlas-hair)" }}>
              <p className="mb-3 text-[0.7rem] font-bold opacity-70">Accessibilità</p>
              <DrawablyButton
                key={`shapes-${distinctShapes}`}
                onClick={toggleShapes}
                aria-pressed={distinctShapes}
                variant={distinctShapes ? "solid" : "outline"}
                width={1.4}
                className="atlas-ink-btn px-3 py-1.5 text-[0.72rem] font-medium tracking-wide"
                title="Un simbolo diverso per ogni categoria: rombo, cerchio, triangolo, quadrato"
              >
                {distinctShapes ? "forme diverse: on" : "forme diverse: off"}
              </DrawablyButton>
            </div>

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

        <p className="sr-only" aria-live="polite">
          {kbdNode
            ? `${kbdNode.label}, ${GROUP_LABEL[kbdNode.group]}. Invio per aprire.`
            : ""}
        </p>

        {/* brand block — hidden on phones, where the bottom edge is spoken for */}
        {isDesktop && (
        <div className="pointer-events-none absolute bottom-7 left-7 z-10">
          <p className="atlas-pen text-2xl tracking-[-0.02em]">THE CAPA ATLAS</p>
          <p className="mt-1 max-w-[17rem] text-xs leading-snug opacity-70">
            Trascina per ruotare, scorri per zoomare. Clicca un nodo per aprirlo,
            Esc per tornare. Da tastiera: frecce per spostarti, +/− per lo zoom,
            Invio per aprire.
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
                    distinct={distinctShapes}
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
          hiddenGroups={ALL_GROUPS.filter((group) => !visibleGroups.has(group))}
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
          revealAtRef.current = performance.now();
          setRevealed(true);
          // The simulation cooled while the curtain was up, and the unfurl is a
          // force that only acts on a running one: wake it so the entrance plays
          // now, and let the camera follow it again.
          layoutDoneRef.current = false;
          fgRef.current?.d3ReheatSimulation();
        }}
      />
    </div>
  );
}
