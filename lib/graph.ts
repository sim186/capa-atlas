export type Group = "album" | "song" | "keyword" | "figure" | "concept";

export interface GraphNode {
  id: string;
  label: string;
  group: Group;
  val?: number;
  // assigned by the force simulation in the browser
  x?: number;
  y?: number;
  z?: number;
  // song
  album?: string;
  release?: string;
  url?: string;
  art?: string;
  // keyword
  fragment?: string;
  annotation?: string;
  song?: string;
  tools?: Record<string, unknown>;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: "on" | "contains" | "refers";
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export const GROUP_LABEL: Record<Group, string> = {
  album: "Album",
  song: "Canzone",
  keyword: "Keyword (citazione annotata)",
  figure: "Figura / alter-ego",
  concept: "Tema",
};

// A restrained paper-atlas palette: high contrast enough to navigate, but
// quiet enough that the structure—not a rainbow of nodes—remains primary.
export const GROUP_COLOR: Record<Group, string> = {
  album: "#6b3fd1",
  song: "#005dcc",
  keyword: "#e02776",
  figure: "#cf302d",
  concept: "#168b57",
};

export const LINK_COLOR: Record<GraphLink["kind"], string> = {
  on: "rgba(107,63,209,0.24)",
  contains: "rgba(224,39,118,0.18)",
  refers: "rgba(22,139,87,0.25)",
};