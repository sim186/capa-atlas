export type Group = "album" | "song" | "keyword" | "figure" | "concept";

export interface GraphNode {
  id: string;
  label: string;
  group: Group;
  val?: number;
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

export const GROUP_COLOR: Record<Group, string> = {
  album: "#8b8b9e",
  song: "#3b82f6",
  keyword: "#f59e0b",
  figure: "#ef4444",
  concept: "#10b981",
};

export const LINK_COLOR: Record<GraphLink["kind"], string> = {
  on: "rgba(139,139,158,0.35)",
  contains: "rgba(245,158,11,0.30)",
  refers: "rgba(16,185,129,0.40)",
};