/**
 * Deterministic Gaussian jitter based on row index.
 * Uses Box-Muller transform with a seeded pseudo-random number generator.
 */

// Simple seeded PRNG (Mulberry32)
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform for Gaussian distribution
function gaussianRandom(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
}

const SIGMA = 0.12;
const CLAMP = 0.4;

export function applyJitter(
  x: number,
  y: number,
  rowIndex: number
): { jx: number; jy: number } {
  const rng = mulberry32(rowIndex * 73856093 + 19349663);

  let dx = gaussianRandom(rng) * SIGMA;
  let dy = gaussianRandom(rng) * SIGMA;

  // Hard clamp
  dx = Math.max(-CLAMP, Math.min(CLAMP, dx));
  dy = Math.max(-CLAMP, Math.min(CLAMP, dy));

  return {
    jx: x + dx,
    jy: y + dy,
  };
}
