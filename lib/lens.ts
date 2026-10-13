import type { GraphNode, Group } from "@/lib/graph";
import { inBlocks } from "@/lib/neighbourhood";

// The selection lens: the selected node's neighbours leave the tangle and
// line up on two arcs either side of it, like a pair of brackets facing the
// camera, with their names pointing outward. Each arc reads top to bottom as
// a list, one category after another. Units are world units (about 2px each
// at the lens viewing distance).
//
// The force layout itself never changes while a lens is open: members get a
// spring offset from where the layout put them (their home), so letting go
// returns every node to exactly where it was. The lens owns the pins
// (fx/fy/fz) it writes on the graph's nodes; layer toggles release them all
// so the atlas can settle again (releasePins).

export type Vec3 = { x: number; y: number; z: number };

const LENS_SIDE_SLOTS = 16; // per arc
const LENS_ROW = 13; // vertical spacing between members on an arc
const LENS_HALF_HEIGHT = 100;
const LENS_HALF_WIDTH = 72;
const LENS_SPRING = 42;
const LENS_DAMPING = 17;
// Splitting a category across the two arcs costs this many rows of
// imbalance: a block stays whole unless keeping it so leaves one arc far
// longer than the other.
const LENS_SPLIT_COST = 4;

/** How many members fit on the two arcs; the drawer lists the same ones. */
export const LENS_MAX_MEMBERS = LENS_SIDE_SLOTS * 2;

/** Outer half-width of the lens, for framing the camera. */
export function lensExtent(count: number) {
  return count === 0 ? 0 : LENS_HALF_WIDTH;
}

/** A block caption on the lens: where it sits in the world, and on which arc. */
export type LensHead = { group: Group; count: number; more: boolean; at: Vec3; side: number };

type LensRow =
  | { kind: "head"; group: Group; count: number; more: boolean }
  | { kind: "node"; node: GraphNode }
  | { kind: "gap" };
type LensSlot = { x: number; y: number; side: number };

// A node displaced from its layout position by the lens. `home` is where the
// force layout put it; the spring moves `offset` toward `target`.
type LensMotion = {
  node: GraphNode;
  home: Vec3;
  offset: Vec3;
  velocity: Vec3;
  target: Vec3;
};

const AXES = ["x", "y", "z"] as const;
const ZERO = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const isZero = (v: Vec3, eps: number) => Math.abs(v.x) < eps && Math.abs(v.y) < eps && Math.abs(v.z) < eps;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const normalize = (v: Vec3): Vec3 => {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
};

/** Place a node and pin it there for the force simulation. */
function pinAt(node: GraphNode, at: Vec3) {
  node.x = node.fx = at.x;
  node.y = node.fy = at.y;
  node.z = node.fz = at.z;
}

/** Let go of every pin, so the layout can settle again. */
export function releasePins(nodes: readonly GraphNode[]) {
  for (const node of nodes) {
    delete node.fx;
    delete node.fy;
    delete node.fz;
  }
}

/**
 * Slot of the j-th of `rows` rows in one lens column, in lens axes (x right,
 * y up), top to bottom. Columns bulge outward at the middle.
 */
function lensSlot(j: number, rows: number, side: number): LensSlot {
  const halfHeight = Math.min(LENS_HALF_HEIGHT, ((rows - 1) * LENS_ROW) / 2);
  const u = rows === 1 ? 0 : 1 - (2 * j) / (rows - 1);
  const y = u * halfHeight;
  const bow = Math.sqrt(Math.max(0, 1 - (y / LENS_HALF_HEIGHT) ** 2));
  const x = side * LENS_HALF_WIDTH * (0.45 + 0.55 * bow);
  return { x, y, side };
}

/**
 * The lens as two columns, each read top to bottom like an index: one block
 * per category (a caption, then its members, weightiest first), with an
 * empty row between blocks. The right column takes the first blocks. The
 * split falls between blocks where that keeps the columns about even;
 * otherwise inside the block that straddles the middle, whose second part
 * gets a "segue" caption.
 */
function lensLayout(nodes: readonly GraphNode[]) {
  const rows: LensRow[] = [];
  // where each split may fall: the row index the left column starts from,
  // and whether the cut is inside a block (needs a continuation caption)
  const cuts: { at: number; inside: Group | null; count: number }[] = [];
  inBlocks(nodes).forEach(({ group, nodes: block }, b) => {
    if (b > 0) {
      cuts.push({ at: rows.length, inside: null, count: 0 });
      rows.push({ kind: "gap" });
    }
    rows.push({ kind: "head", group, count: block.length, more: false });
    block.forEach((node, i) => {
      if (i >= 1) cuts.push({ at: rows.length, inside: group, count: block.length });
      rows.push({ kind: "node", node });
    });
  });
  let best: { at: number; inside: Group | null; count: number } | null = null;
  let bestScore = Infinity;
  for (const cut of cuts) {
    const right = cut.at;
    // a block boundary drops its gap row; a cut inside adds a caption
    const left = cut.inside ? rows.length - cut.at + 1 : rows.length - cut.at - 1;
    const score = Math.abs(right - left) + (cut.inside ? LENS_SPLIT_COST : 0);
    if (score < bestScore) {
      bestScore = score;
      best = cut;
    }
  }
  let columns: LensRow[][];
  if (!best) columns = [rows, []];
  else if (best.inside) {
    columns = [
      rows.slice(0, best.at),
      [{ kind: "head", group: best.inside, count: best.count, more: true }, ...rows.slice(best.at)],
    ];
  } else columns = [rows.slice(0, best.at), rows.slice(best.at + 1)];

  const members = new Map<string, LensSlot>();
  const heads: { group: Group; count: number; more: boolean; slot: LensSlot }[] = [];
  columns.forEach((column, c) => {
    const side = c === 0 ? 1 : -1;
    column.forEach((row, j) => {
      const slot = lensSlot(j, column.length, side);
      if (row.kind === "node") members.set(row.node.id, slot);
      else if (row.kind === "head") heads.push({ group: row.group, count: row.count, more: row.more, slot });
    });
  });
  return { members, heads };
}

export class Lens {
  private motions = new Map<string, LensMotion>();
  private sides = new Map<string, number>();
  private basis: { right: Vec3; up: Vec3 } | null = null;
  private steppedAt = 0;

  /** Where the force layout put a node, ignoring any lens displacement. */
  home(node: GraphNode): Vec3 | null {
    const motion = this.motions.get(node.id);
    if (motion) return motion.home;
    if (node.x === undefined || node.y === undefined || node.z === undefined) return null;
    return { x: node.x, y: node.y, z: node.z };
  }

  /** Which arc a member sits on: 1 right of the selection, -1 left; undefined off the lens. */
  side(id: string): number | undefined {
    return this.sides.get(id);
  }

  /**
   * Get the graph ready for a lens on `anchor`, before its guests join it.
   * Pins every shown node where it stands, so their arrival doesn't stir the
   * atlas. An anchor outside the layout re-centres where it stands, or among
   * its linked nodes when it wasn't on the map. Members not yet on the map
   * bloom out of the anchor. The lens then faces the camera from where it is.
   */
  open(
    anchor: GraphNode,
    {
      shown,
      members,
      linked,
      laidOut,
      camera,
    }: {
      /** Nodes on the map now. */
      shown: readonly GraphNode[];
      /** The anchor's lens members. */
      members: readonly GraphNode[];
      /** Every node linked to the anchor. */
      linked: readonly GraphNode[];
      /** Whether a node is part of the force layout (its layer is on). */
      laidOut: (node: GraphNode) => boolean;
      camera?: { position: Vec3; up: Vec3 };
    }
  ) {
    const shownIds = new Set(shown.map((each) => each.id));
    for (const each of shown) {
      if (each.x === undefined || each.y === undefined || each.z === undefined) continue;
      pinAt(each, { x: each.x, y: each.y, z: each.z });
    }
    if (!laidOut(anchor)) {
      let at: Vec3 = { x: anchor.x ?? 0, y: anchor.y ?? 0, z: anchor.z ?? 0 };
      if (!shownIds.has(anchor.id) || anchor.x === undefined) {
        const around = linked.filter((other) => laidOut(other) && other.x !== undefined);
        at = ZERO();
        for (const other of around) {
          at.x += (other.x ?? 0) / around.length;
          at.y += (other.y ?? 0) / around.length;
          at.z += (other.z ?? 0) / around.length;
        }
      }
      pinAt(anchor, at);
      this.motions.delete(anchor.id);
    }
    const anchorAt = this.home(anchor);
    if (anchorAt) {
      for (const member of members) {
        if (laidOut(member) || shownIds.has(member.id)) continue;
        pinAt(member, anchorAt);
        this.motions.delete(member.id);
      }
    }
    if (camera && anchorAt) {
      const toCamera = normalize({
        x: camera.position.x - anchorAt.x,
        y: camera.position.y - anchorAt.y,
        z: camera.position.z - anchorAt.z,
      });
      const right = normalize(cross(camera.up, toCamera));
      this.basis = { right, up: normalize(cross(toCamera, right)) };
    }
  }

  /**
   * Send `members` onto the arcs around `anchor` (null closes the lens: every
   * displaced node heads home). Nodes no longer on the map are forgotten.
   * Returns the block captions to draw.
   */
  arrange(anchor: GraphNode | null, members: readonly GraphNode[], visibleIds: ReadonlySet<string>): LensHead[] {
    for (const [id, motion] of this.motions) {
      if (!visibleIds.has(id)) this.motions.delete(id);
      else motion.target = ZERO();
    }
    this.sides.clear();
    const basis = this.basis;
    const anchorHome = anchor && this.home(anchor);
    if (!anchorHome || !basis) return [];

    const layout = lensLayout(members);
    const toWorld = (slot: LensSlot): Vec3 => ({
      x: anchorHome.x + basis.right.x * slot.x + basis.up.x * slot.y,
      y: anchorHome.y + basis.right.y * slot.x + basis.up.y * slot.y,
      z: anchorHome.z + basis.right.z * slot.x + basis.up.z * slot.y,
    });
    for (const node of members) {
      const home = this.home(node);
      const slot = layout.members.get(node.id);
      if (!home || !slot) continue;
      let motion = this.motions.get(node.id);
      if (!motion) {
        motion = { node, home, offset: ZERO(), velocity: ZERO(), target: ZERO() };
        this.motions.set(node.id, motion);
      }
      motion.node = node;
      this.sides.set(node.id, slot.side);
      const at = toWorld(slot);
      motion.target = { x: at.x - home.x, y: at.y - home.y, z: at.z - home.z };
    }
    return layout.heads.map(({ group, count, more, slot }) => ({
      group,
      count,
      more,
      at: toWorld(slot),
      side: slot.side,
    }));
  }

  /**
   * Advance the springs to `now` (ms) and move each displaced node and its
   * pin. `instant` (reduced motion) jumps straight to the targets. Returns
   * whether anything moved, so the caller can wake the simulation.
   */
  step(now: number, instant = false): boolean {
    const dt = Math.min(0.05, this.steppedAt ? (now - this.steppedAt) / 1000 : 0.016);
    this.steppedAt = now;
    let moved = false;
    for (const [id, motion] of this.motions) {
      for (const axis of AXES) {
        if (instant) {
          motion.offset[axis] = motion.target[axis];
          motion.velocity[axis] = 0;
        } else {
          const acceleration =
            (motion.target[axis] - motion.offset[axis]) * LENS_SPRING - motion.velocity[axis] * LENS_DAMPING;
          motion.velocity[axis] += acceleration * dt;
          motion.offset[axis] += motion.velocity[axis] * dt;
        }
      }
      const at = {
        x: motion.home.x + motion.offset.x,
        y: motion.home.y + motion.offset.y,
        z: motion.home.z + motion.offset.z,
      };
      const { node } = motion;
      if (
        Math.abs((node.x ?? at.x) - at.x) > 0.001 ||
        Math.abs((node.y ?? at.y) - at.y) > 0.001 ||
        Math.abs((node.z ?? at.z) - at.z) > 0.001 ||
        !isZero(motion.velocity, 0.01)
      ) {
        moved = true;
      }
      // the pin moves with it, so a running simulation agrees
      pinAt(node, at);
      const returning = motion.target.x === 0 && motion.target.y === 0 && motion.target.z === 0;
      if (returning && isZero(motion.offset, 0.01) && isZero(motion.velocity, 0.01)) {
        this.motions.delete(id);
      }
    }
    return moved;
  }
}
