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

// Spec "Gaussian jitter on data points": σ = 0.12, hard clamp ±0.4.
export const JITTER_SIGMA = 0.12;
export const JITTER_CLAMP = 0.4;

export function applyJitter(
  x: number,
  y: number,
  rowIndex: number
): { jx: number; jy: number } {
  const rng = mulberry32(rowIndex * 73856093 + 19349663);

  let dx = gaussianRandom(rng) * JITTER_SIGMA;
  let dy = gaussianRandom(rng) * JITTER_SIGMA;

  // Hard clamp
  dx = Math.max(-JITTER_CLAMP, Math.min(JITTER_CLAMP, dx));
  dy = Math.max(-JITTER_CLAMP, Math.min(JITTER_CLAMP, dy));

  // Clamp back into the score domain (spec "Gaussian jitter on data points"):
  // a 10.0 score must not paint outside the chart at 10.4.
  return {
    jx: Math.max(0, Math.min(10, x + dx)),
    jy: Math.max(0, Math.min(10, y + dy)),
  };
}
