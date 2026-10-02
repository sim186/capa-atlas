import {
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import type { Group } from "@/lib/graph";

/**
 * Node silhouettes as raw RGBA textures, rasterised here instead of drawn on a
 * 2D canvas. A canvas can fail to exist at all (getContext() returns null when
 * a mobile browser has run out of canvas memory, which a few reloads of a WebGL
 * page can do), and the atlas used to render nothing, and show every label at
 * once, when that happened. Pure arithmetic can't fail.
 *
 * Shapes mirror GROUP_SHAPE in lib/graph.ts (100×100 box): a solid fill plus a
 * half-transparent outline ring on the same silhouette scaled up 1.12×.
 */

type Pt = [number, number];

const POLYGONS: Partial<Record<Group, Pt[]>> = {
  album: [[50, 6], [94, 50], [50, 94], [6, 50]],
  figure: [[50, 10], [93, 86], [7, 86]],
  concept: [[17, 17], [83, 17], [83, 83], [17, 83]],
};
const CIRCLE = { cx: 50, cy: 50, r: 36 };

const SIZE = 128;
const RING_SCALE = 1.12;
const RING_HALF_WIDTH = 1.2; // half of the 2.4 stroke, in shape units
const RING_ALPHA = 0.5;
const SAMPLES = 2; // SAMPLES² sub-pixels per texel, for smooth edges

function segmentDistance(p: Pt, a: Pt, b: Pt) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby))
  );
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

function insidePolygon(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** [signed distance to the silhouette edge (negative inside), inside?] */
function edge(group: Group, p: Pt): [number, boolean] {
  const poly = POLYGONS[group];
  if (!poly) {
    const d = Math.hypot(p[0] - CIRCLE.cx, p[1] - CIRCLE.cy) - CIRCLE.r;
    return [Math.abs(d), d <= 0];
  }
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    min = Math.min(min, segmentDistance(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return [min, insidePolygon(p, poly)];
}

export function makeShapeTexture(group: Group): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const step = 100 / SIZE;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let alpha = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const p: Pt = [
            (x + (sx + 0.5) / SAMPLES) * step,
            (y + (sy + 0.5) / SAMPLES) * step,
          ];
          if (edge(group, p)[1]) {
            alpha += 1;
            continue;
          }
          // the ring lives on the silhouette scaled about the centre
          const q: Pt = [50 + (p[0] - 50) / RING_SCALE, 50 + (p[1] - 50) / RING_SCALE];
          const [distance] = edge(group, q);
          if (distance <= RING_HALF_WIDTH) alpha += RING_ALPHA;
        }
      }
      const i = ((SIZE - 1 - y) * SIZE + x) * 4; // texture rows run bottom-up
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round((alpha / (SAMPLES * SAMPLES)) * 255);
    }
  }
  const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
