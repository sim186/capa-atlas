import { describe, expect, it } from "vitest";
import type { GraphLink, GraphNode } from "@/lib/graph";
import { inBlocks, neighbourhood } from "@/lib/neighbourhood";

const node = (id: string, group: GraphNode["group"], extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  label: id,
  group,
  ...extra,
});
const link = (source: string, target: string, weight?: number, kind: GraphLink["kind"] = "refers"): GraphLink => ({
  source,
  target,
  kind,
  weight,
});
const ids = (nodes: readonly GraphNode[]) => nodes.map((each) => each.id);

describe("neighbourhood", () => {
  it("ranks members by link weight, then node size, then label", () => {
    const graph = {
      nodes: [
        node("hub", "concept"),
        node("light", "song"),
        node("heavy", "song"),
        node("big", "figure", { val: 9 }),
        node("b", "figure"),
        node("a", "figure"),
      ],
      links: [
        link("hub", "light", 1),
        link("heavy", "hub", 5),
        link("hub", "b", 2),
        link("hub", "a", 2),
        link("big", "hub", 2),
      ],
    };
    expect(ids(neighbourhood(graph).members("hub"))).toEqual(["heavy", "big", "a", "b", "light"]);
  });

  it("puts an album's own tracks first, in disc order", () => {
    const graph = {
      nodes: [
        node("album", "album", { tracks: [{ label: "Two" }, { label: "Three", id: "t3" }, { label: "One", id: "t1" }] }),
        node("t1", "song"),
        node("t3", "song"),
        node("theme", "concept"),
      ],
      links: [link("t1", "album", 1, "on"), link("t3", "album", 1, "on"), link("album", "theme", 40, "album_refers")],
    };
    expect(ids(neighbourhood(graph).members("album"))).toEqual(["t3", "t1", "theme"]);
  });

  it("adds up several links between the same pair", () => {
    const graph = {
      nodes: [node("x", "concept"), node("p", "figure"), node("q", "figure")],
      links: [link("x", "p", 3), link("p", "x", 3, "co_occurs"), link("x", "q", 5)],
    };
    expect(ids(neighbourhood(graph).members("x"))).toEqual(["p", "q"]);
  });

  it("ignores self links and links to unknown nodes", () => {
    const graph = {
      nodes: [node("x", "concept"), node("y", "concept")],
      links: [link("x", "x", 9), link("x", "ghost", 9), link("x", "y")],
    };
    const links = neighbourhood(graph);
    expect(ids(links.members("x"))).toEqual(["y"]);
    expect(links.members("nobody")).toEqual([]);
  });

  it("reads links whose endpoints force-graph has swapped for node objects", () => {
    const x = node("x", "concept");
    const y = node("y", "figure");
    const links = neighbourhood({ nodes: [x, y], links: [{ source: x, target: y, weight: 2 }] });
    expect(ids(links.members("y"))).toEqual(["x"]);
  });

  it("knows whether two nodes are linked, either way round", () => {
    const links = neighbourhood({
      nodes: [node("x", "concept"), node("y", "figure"), node("z", "figure")],
      links: [link("x", "y")],
    });
    expect(links.linked("x", "y")).toBe(true);
    expect(links.linked("y", "x")).toBe(true);
    expect(links.linked("x", "z")).toBe(false);
  });
});

describe("inBlocks", () => {
  it("groups members as album, figure, concept, song, keeping their order", () => {
    const members = [node("s1", "song"), node("c1", "concept"), node("a1", "album"), node("c2", "concept")];
    expect(inBlocks(members).map((block) => [block.group, ids(block.nodes)])).toEqual([
      ["album", ["a1"]],
      ["concept", ["c1", "c2"]],
      ["song", ["s1"]],
    ]);
  });
});
