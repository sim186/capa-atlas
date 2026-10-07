import fs from "node:fs";
import path from "node:path";
import { LENS_GROUP_ORDER, type GraphData, type GraphNode, type Group, type Quote } from "@/lib/graph";
import type { Locale } from "@/lib/i18n";
import { localizeGraph } from "@/lib/localize";
import { SITE_COPY } from "@/lib/site";

// Build-time only (reads the filesystem): the atlas page, the per-node pages
// and the sitemap all come from here.

const readJson = <T,>(...parts: string[]): T | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), ...parts), "utf-8")) as T;
  } catch {
    return null;
  }
};

/** The graph in one language, or null before `npm run fetch` has produced it. */
export function loadGraph(locale: Locale): GraphData | null {
  const raw = readJson<GraphData>("public", "graphData.json");
  return raw && raw.nodes.length ? localizeGraph(raw, locale) : null;
}

/** A song's annotated quotes (public/quotes/<file>), empty when there are none. */
export function loadQuotes(node: GraphNode): Quote[] {
  return (node.quotesFile && readJson<Quote[]>("public", "quotes", node.quotesFile)) || [];
}

// ---------------------------------------------------------------------------
// Node URLs: /<group>/<slug> in Italian, /en/<group>/<slug> in English. The
// group segment is a word of the page's language; the slug is the same in
// both, taken from the Italian label so the two editions pair up.

export const GROUP_SEGMENT: Record<Locale, Record<Group, string>> = {
  it: { album: "album", song: "canzone", figure: "figura", concept: "tema" },
  en: { album: "album", song: "song", figure: "figure", concept: "theme" },
};

export const slugify = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

let slugCache: Map<string, string> | null = null;

/**
 * Node id → slug, unique within each group. On a clash (two songs called
 * "Vengo dalla luna") the later node in graphData.json gets its album added,
 * then a counter if that still clashes. Keyed on the Italian graph so both
 * languages share it.
 */
function slugs(): Map<string, string> {
  if (slugCache) return slugCache;
  const graph = loadGraph("it");
  const map = new Map<string, string>();
  const taken = new Set<string>();
  for (const node of graph?.nodes ?? []) {
    let slug = slugify(node.label) || slugify(node.id);
    if (taken.has(`${node.group}/${slug}`) && node.album) slug = `${slug}-${slugify(node.album)}`;
    for (let n = 2; taken.has(`${node.group}/${slug}`); n++) slug = `${slug.replace(/-\d+$/, "")}-${n}`;
    taken.add(`${node.group}/${slug}`);
    map.set(node.id, slug);
  }
  return (slugCache = map);
}

/** Site-relative path of a node page, e.g. "/canzone/vengo-dalla-luna" or "/en/song/vengo-dalla-luna". */
export function nodePath(node: Pick<GraphNode, "id" | "group">, locale: Locale): string {
  const prefix = locale === "it" ? "" : SITE_COPY[locale].path;
  return `${prefix}/${GROUP_SEGMENT[locale][node.group]}/${slugs().get(node.id)}`;
}

/** Every node page of one language, as route params. */
export function nodeParams(locale: Locale): { group: string; slug: string }[] {
  return (loadGraph(locale)?.nodes ?? []).map((node) => ({
    group: GROUP_SEGMENT[locale][node.group],
    slug: slugs().get(node.id)!,
  }));
}

export function findNode(locale: Locale, group: string, slug: string): { graph: GraphData; node: GraphNode } | null {
  const graph = loadGraph(locale);
  const node = graph?.nodes.find(
    (each) => GROUP_SEGMENT[locale][each.group] === group && slugs().get(each.id) === slug
  );
  return graph && node ? { graph, node } : null;
}

/** A node's neighbours in the drawer's blocks (album, figure, concept, song), strongest link first. */
export function neighbours(graph: GraphData, node: GraphNode): { group: Group; nodes: GraphNode[] }[] {
  const byId = new Map(graph.nodes.map((each) => [each.id, each]));
  const weight = new Map<string, number>();
  for (const link of graph.links) {
    const other = link.source === node.id ? link.target : link.target === node.id ? link.source : null;
    if (!other || !byId.has(other)) continue;
    weight.set(other, Math.max(weight.get(other) ?? 0, link.weight ?? 1));
  }
  return LENS_GROUP_ORDER.map((group) => ({
    group,
    nodes: [...weight.keys()]
      .map((id) => byId.get(id)!)
      .filter((each) => each.group === group)
      .sort((a, b) => weight.get(b.id)! - weight.get(a.id)! || a.label.localeCompare(b.label)),
  })).filter((block) => block.nodes.length > 0);
}
