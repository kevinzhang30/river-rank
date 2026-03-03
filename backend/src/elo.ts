const K = 32;

export function computeEloDeltas(
  winnerElo: number,
  loserElo: number
): { winnerDelta: number; loserDelta: number } {
  const expected = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const delta = Math.round(K * (1 - expected));
  return { winnerDelta: delta, loserDelta: -delta };
}
