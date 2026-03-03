import type { Card, Rank, Suit } from "./types";

const RANKS: Rank[] = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
const SUITS: Suit[] = ["s","h","d","c"];

export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}` as Card);
    }
  }
  return deck;
}

// Mulberry32 — fast, high-quality 32-bit seeded PRNG
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

// Returns a new shuffled array; original is not mutated.
export function shuffle(deck: Card[], seed: number): Card[] {
  const result = [...deck];
  const rand = mulberry32(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
