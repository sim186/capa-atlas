import { describe, expect, it } from "vitest";
import type { GraphNode } from "@/lib/graph";
import { Lens, releasePins, type Vec3 } from "@/lib/lens";

const at = (id: string, group: GraphNode["group"], x: number, y = 0, z = 0): GraphNode => ({
  id,
  label: id,
  group,
  x,
  y,
  z,
});
const where = (node: GraphNode): Vec3 => ({ x: node.x!, y: node.y!, z: node.z! });
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
// camera straight down the z axis: the lens lies in the x/y plane
const camera = { position: { x: 0, y: 0, z: 500 }, up: { x: 0, y: 1, z: 0 } };

// the frame clock, in ms; it only runs forward, like performance.now()
let clock = 0;

/** Run the springs for `seconds` at 60 frames a second. */
function settle(lens: Lens, seconds = 3) {
  for (const end = clock + seconds * 1000; clock < end; ) lens.step((clock += 16));
}

function openLens() {
  const anchor = at("anchor", "concept", 0);
  const members = [at("f1", "figure", 40, 5), at("f2", "figure", -30, 8), at("s1", "song", 10, -20, 3)];
  const shown = [anchor, ...members];
  const lens = new Lens();
  lens.open(anchor, { shown, members, linked: members, laidOut: () => true, camera });
  const heads = lens.arrange(anchor, members, new Set(shown.map((each) => each.id)));
  return { lens, anchor, members, shown, heads };
}

describe("Lens", () => {
  it("springs members onto the two arcs, facing the camera", () => {
    const { lens, members } = openLens();
    settle(lens);
    for (const member of members) {
      expect(member.z).toBeCloseTo(0, 1);
      const side = lens.side(member.id);
      expect(side === 1 ? member.x! > 0 : member.x! < 0).toBe(true);
    }
  });

  it("moves each member's pin with it", () => {
    const { lens, members } = openLens();
    settle(lens);
    for (const member of members) {
      expect([member.fx, member.fy, member.fz]).toEqual([member.x, member.y, member.z]);
    }
  });

  it("captions each block where the block sits", () => {
    const { heads } = openLens();
    expect(heads.filter((head) => !head.more).map((head) => [head.group, head.count])).toEqual([
      ["figure", 2],
      ["song", 1],
    ]);
  });

  it("reports motion until the springs settle", () => {
    const { lens } = openLens();
    expect(lens.step((clock += 16))).toBe(true);
    settle(lens, 5);
    expect(lens.step((clock += 16))).toBe(false);
  });

  it("returns every member home when it closes", () => {
    const { lens, members, shown } = openLens();
    const homes = members.map(where);
    settle(lens);
    expect(distance(where(members[0]), homes[0])).toBeGreaterThan(1);
    lens.arrange(null, [], new Set(shown.map((each) => each.id)));
    settle(lens);
    members.forEach((member, i) => expect(distance(where(member), homes[i])).toBeLessThan(0.05));
    expect(lens.side(members[0].id)).toBeUndefined();
  });

  it("jumps straight to the arcs for reduced motion", () => {
    const { lens, members } = openLens();
    lens.step((clock += 16), true);
    const placed = members.map(where);
    settle(lens);
    members.forEach((member, i) => expect(distance(where(member), placed[i])).toBeLessThan(0.01));
  });

  it("keeps a member's layout home while it is displaced", () => {
    const { lens, members } = openLens();
    const home = where(members[0]);
    settle(lens);
    expect(lens.home(members[0])).toEqual(home);
  });

  it("pins the shown layout where it stands", () => {
    const { shown } = openLens();
    for (const each of shown) expect([each.fx, each.fy, each.fz]).toEqual([each.x, each.y, each.z]);
  });

  it("blooms members from hidden layers out of the anchor", () => {
    const anchor = at("anchor", "concept", 50, 10, 0);
    const guest: GraphNode = { id: "guest", label: "guest", group: "song" };
    const lens = new Lens();
    lens.open(anchor, {
      shown: [anchor],
      members: [guest],
      linked: [guest],
      laidOut: (each) => each.group !== "song",
      camera,
    });
    expect(where(guest)).toEqual({ x: 50, y: 10, z: 0 });
  });

  it("places an anchor that wasn't on the map among its linked nodes", () => {
    const anchor: GraphNode = { id: "song", label: "song", group: "song" };
    const linked = [at("a", "album", 100, 0, 0), at("b", "concept", 0, 40, 20)];
    const lens = new Lens();
    lens.open(anchor, { shown: linked, members: linked, linked, laidOut: (each) => each.group !== "song", camera });
    expect(where(anchor)).toEqual({ x: 50, y: 20, z: 10 });
  });

  it("forgets displaced nodes that left the map", () => {
    const { lens, members } = openLens();
    settle(lens);
    // a layer toggle takes them off the map and the selection goes
    lens.arrange(null, [], new Set(["anchor"]));
    const before = members.map(where);
    expect(lens.step((clock += 16))).toBe(false);
    members.forEach((member, i) => expect(where(member)).toEqual(before[i]));
  });
});

describe("releasePins", () => {
  it("lets every node move again", () => {
    const node = at("n", "album", 1, 2, 3);
    Object.assign(node, { fx: 1, fy: 2, fz: 3 });
    releasePins([node]);
    expect([node.fx, node.fy, node.fz]).toEqual([undefined, undefined, undefined]);
  });
});
