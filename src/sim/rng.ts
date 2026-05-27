// Seeded RNG so headless runs are bit-for-bit reproducible across browser and node.
// mulberry32 — fast, small, good enough for sim variance.

export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  return function rng(): number {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
