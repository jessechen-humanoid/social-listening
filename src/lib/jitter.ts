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

// Spec "Gaussian jitter on data points": σ = 0.3, matching the legacy
// Python renderer (np.random.normal(0, 0.3), no per-axis cap) — the value
// that turns integer-score columns into the familiar cloud.
export const JITTER_SIGMA = 0.3;

export function applyJitter(
  x: number,
  y: number,
  rowIndex: number
): { jx: number; jy: number } {
  const rng = mulberry32(rowIndex * 73856093 + 19349663);

  const dx = gaussianRandom(rng) * JITTER_SIGMA;
  const dy = gaussianRandom(rng) * JITTER_SIGMA;

  // No per-axis cap (Python parity: natural Gaussian tails shape the cloud),
  // but never paint outside the score domain.
  return {
    jx: Math.max(0, Math.min(10, x + dx)),
    jy: Math.max(0, Math.min(10, y + dy)),
  };
}
