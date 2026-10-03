import {
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";

/**
 * The node disc as a raw RGBA texture, rasterised here instead of drawn on a
 * 2D canvas. A canvas can fail to exist at all (getContext() returns null when
 * a mobile browser has run out of canvas memory, which a few reloads of a WebGL
 * page can do), and the atlas used to render nothing, and show every label at
 * once, when that happened. Pure arithmetic can't fail.
 *
 * Mirrors GROUP_SHAPE in lib/graph.ts (100×100 box): a solid disc plus a
 * half-transparent outline ring on the same disc scaled up 1.12×.
 */

const R = 36;
const SIZE = 128;
const RING_SCALE = 1.12;
const RING_HALF_WIDTH = 1.2; // half of the 2.4 stroke, in shape units
const RING_ALPHA = 0.5;
const SAMPLES = 2; // SAMPLES² sub-pixels per texel, for smooth edges

export function makeDiscTexture(): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const step = 100 / SIZE;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let alpha = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = (x + (sx + 0.5) / SAMPLES) * step - 50;
          const py = (y + (sy + 0.5) / SAMPLES) * step - 50;
          const r = Math.hypot(px, py);
          if (r <= R) alpha += 1;
          // the ring lives on the disc scaled about the centre
          else if (Math.abs(r / RING_SCALE - R) <= RING_HALF_WIDTH) alpha += RING_ALPHA;
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
