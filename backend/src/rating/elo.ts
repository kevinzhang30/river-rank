const K = 32;

export interface EloResult {
  newA:   number;
  newB:   number;
  deltaA: number;
  deltaB: number;
}

/**
 * Compute new Elo ratings after a game.
 * @param rA      Current rating of player A
 * @param rB      Current rating of player B
 * @param resultA 1 = A wins, 0 = A loses, 0.5 = draw
 * @param k       K-factor (default 32)
 */
export function eloUpdate(rA: number, rB: number, resultA: number, k = K): EloResult {
  const expected = 1 / (1 + Math.pow(10, (rB - rA) / 400));
  let deltaA   = Math.round(k * (resultA - expected));
  // Ensure every win awards at least 5 Elo
  if (resultA === 1) deltaA = Math.max(deltaA, 5);
  else if (resultA === 0) deltaA = Math.min(deltaA, -5);
  const deltaB   = -deltaA;
  return { newA: rA + deltaA, newB: rB + deltaB, deltaA, deltaB };
}
