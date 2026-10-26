import { BASE_PATH } from "@/lib/basePath";
import type { GraphLink, GraphNode, Quote, QuoteRef, RefType } from "@/lib/graph";
import type { Locale } from "@/lib/i18n";

// The named references (people, works, places…) quotes allude to. There are
// ~2300 of them, too many to be graph nodes: public/refs.json indexes them,
// and the atlas raises one onto the map only while it is open, as a node
// linked to the songs citing it. The index holds names and songs; the lead
// and Wikipedia link travel with the quotes and are read from there.

/** One entry of public/refs.json. `songs`: [song node id, quotes citing it], strongest first. */
export interface RefEntry {
  id: string;
  name: string;
  type: RefType;
  /** en.wiki's name for it, when the page exists there. */
  en?: string;
  /** The figure node it is (same Wikipedia page): opened instead of a twin. */
  node?: string;
  songs: [string, number][];
}

let index: Promise<RefEntry[]> | null = null;

/** The refs index, fetched once. Empty if it can't be had. */
export function loadRefs(): Promise<RefEntry[]> {
  index ??= fetch(`${BASE_PATH}/refs.json`)
    .then((res) => (res.ok ? (res.json() as Promise<RefEntry[]>) : []))
    .catch(() => {
      index = null;
      return [];
    });
  return index;
}

export const isRefNode = (node: { id: string }) => node.id.startsWith("ref:");

export const refName = (entry: RefEntry, locale: Locale) =>
  (locale === "en" && entry.en) || entry.name;

/**
 * A ref as a map node and its links to the songs citing it. It wears the
 * figure group, the atlas's "who is cited" category; `refType` says what
 * it really is.
 */
export function refGraph(entry: RefEntry, locale: Locale): { node: GraphNode; links: GraphLink[] } {
  return {
    node: { id: entry.id, label: refName(entry, locale), group: "figure", refType: entry.type, val: 1 },
    links: entry.songs.map(([song, weight]) => ({ source: entry.id, target: song, kind: "refers", weight })),
  };
}

/** The ref's lead and link, as the quotes of the song it's taken from carry them. */
export function refFromQuotes(quotes: readonly Quote[], id: string): QuoteRef | null {
  for (const quote of quotes) {
    const ref = quote.refs?.find((each) => each.id === id);
    if (ref) return ref;
  }
  return null;
}
