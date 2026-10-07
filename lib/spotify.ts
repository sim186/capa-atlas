import type { GraphNode } from "@/lib/graph";

const ARTIST = "Caparezza";

/**
 * Return a Spotify search URL for releases in the atlas.
 *
 * The dataset does not store Spotify IDs, so this deliberately opens a
 * narrowed artist + title search instead of pretending it is a canonical
 * track/album URI. The result is still useful for every song and real album
 * in the drawer, without an API token or stale IDs in the graph data.
 */
export function spotifySearchUrl(node: GraphNode): string | undefined {
  if (node.group !== "song" && node.group !== "album") return undefined;
  if (node.id === "album:Singoli / altro") return undefined;

  return `https://open.spotify.com/search/${encodeURIComponent(`${ARTIST} ${node.label}`)}`;
}
