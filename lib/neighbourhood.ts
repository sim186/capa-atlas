import { LENS_GROUP_ORDER, type GraphNode, type Group } from "@/lib/graph";

// Who a node is linked to, and in what order. The lens on the map, the
// drawer's "Collegato a" and the node pages all read it from here, so the
// three never disagree.

export interface Neighbourhood {
  /**
   * Every node linked to `id`, strongest link first: summed link weight,
   * then node size, then label. An album's own tracks lead, in disc order.
   * Empty for an unknown id.
   */
  members(id: string): GraphNode[];
  /** Whether any link joins `a` and `b`, either way round. */
  linked(a: string, b: string): boolean;
}

// force-graph swaps a link's endpoints for the node objects in place
const endpointId = (endpoint: unknown) =>
  typeof endpoint === "object" && endpoint !== null ? String((endpoint as { id?: unknown }).id) : String(endpoint);

export function neighbourhood(
  graph: { nodes: readonly GraphNode[]; links: readonly { source: unknown; target: unknown; weight?: number }[] }
): Neighbourhood {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const strength = new Map<string, Map<string, number>>();
  const add = (from: string, to: string, weight: number) => {
    let bucket = strength.get(from);
    if (!bucket) strength.set(from, (bucket = new Map()));
    bucket.set(to, (bucket.get(to) ?? 0) + weight);
  };
  for (const link of graph.links) {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    if (source === target || !byId.has(source) || !byId.has(target)) continue;
    add(source, target, link.weight ?? 1);
    add(target, source, link.weight ?? 1);
  }

  const ranked = new Map<string, GraphNode[]>();
  const members = (id: string) => {
    const cached = ranked.get(id);
    if (cached) return cached;
    const weights = strength.get(id) ?? new Map<string, number>();
    const trackIndex = new Map(
      (byId.get(id)?.tracks ?? []).flatMap((track) => (track.id ? [track.id] : [])).map((trackId, i) => [trackId, i])
    );
    const rank = (nodeId: string) => trackIndex.get(nodeId) ?? Infinity;
    const list = [...weights.keys()]
      .map((other) => byId.get(other)!)
      .sort(
        (a, b) =>
          (rank(a.id) === rank(b.id) ? 0 : rank(a.id) < rank(b.id) ? -1 : 1) ||
          weights.get(b.id)! - weights.get(a.id)! ||
          (b.val ?? 1) - (a.val ?? 1) ||
          a.label.localeCompare(b.label)
      );
    ranked.set(id, list);
    return list;
  };

  return {
    members,
    linked: (a, b) => strength.get(a)?.has(b) ?? false,
  };
}

/** Members split into the lens's blocks (album, figure, concept, song), each keeping its order. */
export function inBlocks(nodes: readonly GraphNode[]): { group: Group; nodes: GraphNode[] }[] {
  return LENS_GROUP_ORDER.map((group) => ({ group, nodes: nodes.filter((node) => node.group === group) })).filter(
    (block) => block.nodes.length > 0
  );
}
