// ── Types ─────────────────────────────────────────────────────────────────────

/** Result from player A's perspective: 1 = win, 0 = loss, 0.5 = draw. */
export type Result = 0 | 0.5 | 1;

export interface RatingDelta {
  newRatingA: number;
  newRatingB: number;
  deltaA: number; // signed change for A (deltaB = -deltaA for zero-sum Elo)
}

// ── Core formula ──────────────────────────────────────────────────────────────

/**
 * Expected score for player A given ratings rA and rB.
 * Standard Elo formula: E(A) = 1 / (1 + 10^((rB - rA) / 400))
 */
export function expectedScore(rA: number, rB: number): number {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

/**
 * Compute updated ratings after one game.
 *
 * @param rA      Current rating of player A
 * @param rB      Current rating of player B
 * @param resultA Actual score for A: 1 = win, 0.5 = draw, 0 = loss
 * @param k       K-factor (default 32). Higher = faster adjustment.
 */
export function eloUpdate(
  rA: number,
  rB: number,
  resultA: Result,
  k = 32
): RatingDelta {
  const eA = expectedScore(rA, rB);
  const eB = 1 - eA; // expectedScore(rB, rA)
  const resultB = (1 - resultA) as Result;

  let deltaA = k * (resultA - eA);
  // Ensure every win awards at least 5 Elo
  if (resultA === 1) deltaA = Math.max(deltaA, 5);
  else if (resultA === 0) deltaA = Math.min(deltaA, -5);
  const deltaB = -deltaA;

  return {
    newRatingA: rA + deltaA,
    newRatingB: rB + deltaB,
    deltaA,
  };
}
