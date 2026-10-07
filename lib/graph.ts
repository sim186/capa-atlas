export type Group = "album" | "song" | "figure" | "concept";

export interface Quote {
  fragment: string;
  annotation: string;
  url?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  group: Group;
  val?: number;
  // assigned by the force simulation in the browser
  x?: number;
  y?: number;
  z?: number;
  // pinned position (d3-force): set while a selection lens is open
  fx?: number;
  fy?: number;
  fz?: number;
  // song
  album?: string;
  release?: string;
  url?: string;
  art?: string;
  // album + song: short synopsis pulled from Wikipedia (data/wikipedia.json)
  description?: string;
  descriptionUrl?: string;
  // concept + figure: hand-written note (data/concepts.json `blurb`); figure:
  // short Wikipedia bio. `description` is the computed usage line.
  blurb?: string;
  bio?: string;
  bioUrl?: string;
  // the substance of the Wikipedia page: sections on concept/meaning/tracks
  about?: { heading: string; text: string }[];
  // album + songs on it: cover art URL (never stored locally, loaded from the
  // source) and where it came from, from data/covers.json
  cover?: string;
  coverSource?: string;
  coverSourceUrl?: string;
  // song: best upload on Caparezza's own YouTube channel, from
  // data/youtube.json — music video, lyric video, or official audio/art track
  youtube?: { id: string; kind: "video" | "lyric" | "audio" };
  // English text for the /en atlas (build_graph.py); removed by
  // lib/localize.ts before the graph reaches the browser
  en?: Partial<Pick<GraphNode, "label" | "description" | "descriptionUrl" | "about" | "bio" | "bioUrl">>;
  // English atlas only: fields still showing the Italian text, tagged "IT"
  italian?: ("description" | "about" | "bio")[];
  // annotated citations from the song, shown in the sidebar rather than as
  // their own graph nodes (there were 3600+ of them — mostly noise at the
  // graph level, but still worth surfacing once you're reading a song).
  // They are not in graphData.json (too heavy): `quotesFile` names the
  // per-song file in public/quotes/ that the detail panel fetches on demand.
  quoteCount?: number;
  quotesFile?: string;
  // album: track list in disc order (Wikipedia "Tracce", else the songs in
  // the graph); `id` is the song node when that track is in the atlas.
  tracks?: { label: string; id?: string }[];
}

/** A freely licensed photo of Caparezza from Wikimedia Commons (data/portraits.json). */
export interface Portrait {
  file: string;
  title: string;
  page: string;
  author: string;
  license: string;
  licenseUrl?: string | null;
  width: number;
  height: number;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: "on" | "refers" | "co_occurs" | "album_refers";
  // how many quotes support this link (refers) or how many songs a
  // concept/figure pair share (co_occurs). Absent for "on".
  weight?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// The lens around a selection and the drawer's "Collegato a" list the same
// members in the same blocks, in this order, each strongest link first.
export const LENS_GROUP_ORDER: Group[] = ["album", "figure", "concept", "song"];

// A restrained paper-atlas palette: high contrast enough to navigate, but
// quiet enough that the structure—not a rainbow of nodes—remains primary.
export const GROUP_COLOR: Record<Group, string> = {
  album: "#6b3fd1",
  song: "#005dcc",
  figure: "#cf302d",
  concept: "#168b57",
};

export const LINK_COLOR: Record<GraphLink["kind"], string> = {
  on: "rgba(107,63,209,0.24)",
  refers: "rgba(22,139,87,0.25)",
  co_occurs: "rgba(207,48,45,0.2)",
  album_refers: "rgba(107,63,209,0.2)",
};

// By default every node is a disc and colour carries the category (legend,
// search results and the page theme all use the same four colours). The
// "forme" accessibility option swaps in distinct silhouettes (100×100 viewBox)
// so colour is never the only cue: album = diamond, song = disc, figure =
// triangle, concept = square. Rasterised for WebGL in lib/shapeTextures.ts.
const DISC = "M50 14A36 36 0 1 1 49.99 14Z";
export const GROUP_SHAPE: Record<Group, string> = {
  album: DISC,
  song: DISC,
  figure: DISC,
  concept: DISC,
};
export const GROUP_SHAPE_DISTINCT: Record<Group, string> = {
  album: "M50 6L94 50L50 94L6 50Z",
  song: DISC,
  figure: "M50 10L93 86H7Z",
  concept: "M17 17H83V83H17Z",
};
