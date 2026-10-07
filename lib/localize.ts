import type { GraphData, GraphNode } from "@/lib/graph";
import type { Locale } from "@/lib/i18n";

const SINGLES = "Singoli / altro";
const SINGLES_EN = "Singles / other";

/**
 * The graph as one atlas shows it. Italian is what graphData.json holds; for
 * English each node's `en` fields replace the Italian ones, and whatever
 * Italian text is left (no English Wikipedia page) is listed in `italian` so
 * the drawer can tag it. The `en` field never reaches the browser.
 */
export function localizeGraph(data: GraphData, locale: Locale): GraphData {
  const nodes = data.nodes.map((source) => {
    const { en, ...node }: GraphNode = source;
    if (locale === "it") return node;
    const localized: GraphNode = { ...node, ...en };
    if (localized.album === SINGLES) localized.album = SINGLES_EN;
    const italian: GraphNode["italian"] = [];
    if (node.description && !en?.description && node.group !== "concept" && node.group !== "figure") {
      italian.push("description");
    }
    if (node.about?.length && !en?.about) italian.push("about");
    if (node.bio && !en?.bio) italian.push("bio");
    if (italian.length) localized.italian = italian;
    return localized;
  });
  return { ...data, nodes };
}
