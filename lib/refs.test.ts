import { describe, expect, it } from "vitest";
import type { GraphNode, Quote } from "@/lib/graph";
import { neighbourhood } from "@/lib/neighbourhood";
import { isRefNode, refFromQuotes, refGraph, type RefEntry } from "@/lib/refs";

const finardi: RefEntry = {
  id: "ref:eugenio-finardi",
  name: "Eugenio Finardi",
  type: "person",
  songs: [
    ["song:a", 2],
    ["song:b", 1],
  ],
};
const song = (id: string): GraphNode => ({ id, label: id, group: "song" });

describe("refGraph", () => {
  it("raises a ref as a figure linked to the songs citing it", () => {
    const { node, links } = refGraph(finardi, "it");
    expect(node).toMatchObject({ id: "ref:eugenio-finardi", group: "figure", refType: "person" });
    expect(isRefNode(node)).toBe(true);
    const members = neighbourhood({ nodes: [song("song:a"), song("song:b"), node], links }).members(node.id);
    expect(members.map((each) => each.id)).toEqual(["song:a", "song:b"]);
  });

  it("takes en.wiki's name on the English atlas, the corpus's otherwise", () => {
    const tweety: RefEntry = { id: "ref:titti", name: "Titti", type: "character", en: "Tweety", songs: [] };
    expect(refGraph(tweety, "en").node.label).toBe("Tweety");
    expect(refGraph(tweety, "it").node.label).toBe("Titti");
    expect(refGraph(finardi, "en").node.label).toBe("Eugenio Finardi");
  });
});

describe("refFromQuotes", () => {
  it("finds the ref's lead among a song's quotes", () => {
    const quotes: Quote[] = [
      { fragment: "x", annotation: "y" },
      { fragment: "Giocare a Tomb Raider insieme a Finardi", annotation: "…", refs: [
        { id: "ref:tomb-raider", name: "Tomb Raider", type: "work" },
        { id: "ref:eugenio-finardi", name: "Eugenio Finardi", type: "person", bio: "Cantautore." },
      ] },
    ];
    expect(refFromQuotes(quotes, "ref:eugenio-finardi")?.bio).toBe("Cantautore.");
    expect(refFromQuotes(quotes, "ref:nobody")).toBeNull();
  });
});
