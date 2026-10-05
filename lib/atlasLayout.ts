import type { GraphData, GraphNode } from "./graph";

// The overview layout: a disc on the turntable (the x-z plane), read like a
// clock of the career from the start-up camera above it. Studio albums sit on a ring in release order (from 7 o'clock,
// clockwise, to 5 o'clock; the gap at the bottom is where the timeline
// starts and ends). Themes and figures sit on two inner rings, each at the
// angle of the albums whose songs cite them, spread apart so no two names
// share a spot. Songs fan out just outside their album; the one-song
// releases (singles, features) form a halo outside the ring at their year.
//
// Radii are world units. Every target is fixed, so start-up framing can be
// computed from LAYOUT_EXTENT before the simulation has run.

export const R_FIGURE = 125;
export const R_THEME = 225;
const THEME_STAGGER = 34; // every other theme steps out, so neighbouring names don't collide
export const R_ALBUM = 355;
const R_SONG = 400; // songs fan between the album ring and the halo
const SONG_ROWS = 3;
const SONG_ROW = 22;
const R_SINGLE = 490;
const SINGLE_STAGGER = 30;
const DEPTH = 28; // y jitter, so the disc still has some depth when tilted

/** Furthest any target sits from the centre. */
export const LAYOUT_EXTENT = R_SINGLE + SINGLE_STAGGER + 10;
/** Furthest theme or figure: what a phone frames at start-up. */
export const CORE_EXTENT = R_THEME + THEME_STAGGER + 10;

// An album with this many songs is a studio album and gets a slot on the ring.
const STUDIO_MIN_SONGS = 10;
// Clock angles (radians, 0 = 12 o'clock, clockwise) of the first and last album.
const ARC_START = (210 / 180) * Math.PI;
const ARC_SPAN = (300 / 180) * Math.PI;

export interface LayoutPoint {
  x: number;
  y: number;
  z: number;
}

function hash01(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function yearOf(release: string | undefined) {
  const match = release?.match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function point(angle: number, radius: number, id: string): LayoutPoint {
  return {
    x: radius * Math.sin(angle),
    y: (hash01(id + "y") - 0.5) * 2 * DEPTH,
    // 12 o'clock is away from the start-up camera (which looks along -z)
    z: -radius * Math.cos(angle),
  };
}

const TAU = Math.PI * 2;
const wrap = (angle: number) => ((angle % TAU) + TAU) % TAU;

/**
 * Spread angles around the circle so neighbours are at least `gap` apart,
 * moving each as little as possible from where it wants to be.
 */
function spreadOnCircle(wanted: Map<string, number>, gap: number) {
  // Sorted once, then relaxed as a ring of unwrapped angles: the last item's
  // neighbour is the first one, a full turn on. Wrapping only at the end
  // keeps a pair that crosses 0 from reading as a full turn apart.
  const items = [...wanted]
    .map(([id, angle]) => ({ id, angle: wrap(angle) }))
    .sort((a, b) => a.angle - b.angle || a.id.localeCompare(b.id));
  const n = items.length;
  if (n > 1) {
    for (let pass = 0; pass < 500; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const a = items[i];
        const b = items[(i + 1) % n];
        const diff = b.angle + (i === n - 1 ? TAU : 0) - a.angle;
        if (diff >= gap) continue;
        const push = (gap - diff) / 2 + 1e-4;
        a.angle -= push;
        b.angle += push;
        moved = true;
      }
      if (!moved) break;
    }
  }
  return new Map(items.map((item) => [item.id, wrap(item.angle)]));
}

/** Where each node of the atlas settles. Nodes without a target are left to the simulation. */
function songsByAlbumOf(data: GraphData) {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const songsByAlbum = new Map<string, GraphNode[]>();
  for (const link of data.links) {
    if (link.kind !== "on") continue;
    const song = byId.get(String(link.source));
    const album = String(link.target);
    if (!song || !byId.has(album)) continue;
    let songs = songsByAlbum.get(album);
    if (!songs) songsByAlbum.set(album, (songs = []));
    songs.push(song);
  }
  return songsByAlbum;
}

/** Each album's year: the earliest release year among its songs. */
export function albumYears(
  data: GraphData,
  songsByAlbum = songsByAlbumOf(data)
): Map<string, number> {
  const years = new Map<string, number>();
  for (const album of data.nodes) {
    if (album.group !== "album") continue;
    const found = (songsByAlbum.get(album.id) ?? [])
      .map((song) => yearOf(song.release))
      .filter((year): year is number => year !== null);
    if (found.length) years.set(album.id, Math.min(...found));
  }
  return years;
}

/** Albums with a slot on the clock's ring (see STUDIO_MIN_SONGS). */
export function studioAlbumIds(data: GraphData): Set<string> {
  const ids = new Set<string>();
  for (const [album, songs] of songsByAlbumOf(data)) {
    if (songs.length >= STUDIO_MIN_SONGS) ids.add(album);
  }
  return ids;
}

export function atlasLayout(data: GraphData): Map<string, LayoutPoint> {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const songsByAlbum = new Map<string, GraphNode[]>();
  const albumOfSong = new Map<string, string>();
  for (const link of data.links) {
    if (link.kind !== "on") continue;
    const song = byId.get(String(link.source));
    const album = String(link.target);
    if (!song || !byId.has(album)) continue;
    albumOfSong.set(song.id, album);
    let songs = songsByAlbum.get(album);
    if (!songs) songsByAlbum.set(album, (songs = []));
    songs.push(song);
  }

  const albums = data.nodes.filter((node) => node.group === "album");
  const yearOfAlbum = albumYears(data, songsByAlbum);
  const chronological = (a: GraphNode, b: GraphNode) =>
    (yearOfAlbum.get(a.id) ?? 9999) - (yearOfAlbum.get(b.id) ?? 9999) ||
    a.label.localeCompare(b.label);

  // Studio albums: evenly spaced in release order, so their names never
  // crowd each other however the years fall.
  const studio = albums
    .filter((album) => (songsByAlbum.get(album.id)?.length ?? 0) >= STUDIO_MIN_SONGS)
    .sort(chronological);
  const slot = studio.length > 1 ? ARC_SPAN / (studio.length - 1) : 0;
  const angleOf = new Map<string, number>();
  studio.forEach((album, index) => angleOf.set(album.id, ARC_START + index * slot));

  // Any other release: placed by year between the studio albums around it.
  const studioYears = studio.map((album) => yearOfAlbum.get(album.id) ?? 0);
  const angleForYear = (year: number) => {
    if (!studio.length) return ARC_START;
    if (year <= studioYears[0]) return ARC_START - slot * 0.4;
    for (let i = 0; i < studio.length - 1; i++) {
      const [from, to] = [studioYears[i], studioYears[i + 1]];
      if (year >= from && year < to) {
        return ARC_START + (i + (year - from + 0.5) / Math.max(1, to - from)) * slot;
      }
    }
    return ARC_START + ARC_SPAN + slot * 0.4;
  };
  const singles = albums.filter((album) => !angleOf.has(album.id)).sort(chronological);
  const wantedSingles = new Map<string, number>();
  for (const album of singles) {
    const year = yearOfAlbum.get(album.id);
    wantedSingles.set(album.id, year === undefined ? ARC_START - slot : angleForYear(year));
  }
  // the halo is crowded in busy years (seven releases in 2012): spread it
  for (const [id, angle] of spreadOnCircle(wantedSingles, (TAU / Math.max(1, singles.length)) * 0.75)) {
    angleOf.set(id, angle);
  }

  const targets = new Map<string, LayoutPoint>();
  studio.forEach((album) => targets.set(album.id, point(angleOf.get(album.id)!, R_ALBUM, album.id)));
  singles.forEach((album, index) =>
    targets.set(
      album.id,
      point(angleOf.get(album.id)!, R_SINGLE + (index % 2) * SINGLE_STAGGER, album.id)
    )
  );

  // Songs: a small fan just outside their album.
  for (const [albumId, songs] of songsByAlbum) {
    const angle = angleOf.get(albumId);
    if (angle === undefined) continue;
    const studioAlbum = studio.some((album) => album.id === albumId);
    const width = studioAlbum ? slot * 0.8 : slot * 0.25;
    const sorted = [...songs].sort((a, b) => a.label.localeCompare(b.label));
    sorted.forEach((song, index) => {
      const t = sorted.length > 1 ? index / (sorted.length - 1) - 0.5 : 0;
      const radius = studioAlbum
        ? R_SONG + (index % SONG_ROWS) * SONG_ROW
        : R_SINGLE + SINGLE_STAGGER + 40;
      targets.set(song.id, point(angle + t * width, radius, song.id));
    });
  }

  // Themes and figures: the circular mean of the albums their songs come
  // from (weighted by how often they're cited), then spread so they don't stack.
  const pull = new Map<string, { x: number; y: number }>();
  const addPull = (id: string, albumId: string | undefined, weight: number) => {
    const angle = albumId === undefined ? undefined : angleOf.get(albumId);
    if (angle === undefined) return;
    const sum = pull.get(id) ?? { x: 0, y: 0 };
    sum.x += Math.sin(angle) * weight;
    sum.y += Math.cos(angle) * weight;
    pull.set(id, sum);
  };
  for (const link of data.links) {
    if (link.kind !== "refers") continue;
    addPull(String(link.target), albumOfSong.get(String(link.source)), link.weight ?? 1);
  }
  for (const group of ["concept", "figure"] as const) {
    const members = data.nodes.filter((node) => node.group === group);
    const wanted = new Map<string, number>();
    for (const node of members) {
      const sum = pull.get(node.id);
      wanted.set(
        node.id,
        sum && Math.hypot(sum.x, sum.y) > 1e-6
          ? Math.atan2(sum.x, sum.y)
          : hash01(node.id) * TAU
      );
    }
    const spread = spreadOnCircle(wanted, (TAU / Math.max(1, members.length)) * 0.9);
    [...spread]
      .sort((a, b) => a[1] - b[1])
      .forEach(([id, angle], index) => {
        const radius = group === "figure" ? R_FIGURE : R_THEME + (index % 2) * THEME_STAGGER;
        targets.set(id, point(angle, radius, id));
      });
  }
  return targets;
}
