import type { Card, Rank, Suit } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const RANK_VALUE: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4,  "5": 5,  "6": 6,  "7": 7,
  "8": 8, "9": 9, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

export type HandCategory =
  | "HIGH_CARD" | "ONE_PAIR" | "TWO_PAIR" | "THREE_OF_A_KIND"
  | "STRAIGHT"  | "FLUSH"   | "FULL_HOUSE"
  | "FOUR_OF_A_KIND" | "STRAIGHT_FLUSH";

const CATEGORY_RANK: Record<HandCategory, number> = {
  HIGH_CARD: 0, ONE_PAIR: 1, TWO_PAIR: 2, THREE_OF_A_KIND: 3,
  STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, FOUR_OF_A_KIND: 7, STRAIGHT_FLUSH: 8,
};

export interface HandRank {
  category: HandCategory;
  // Descending-importance values for tiebreaking within the same category.
  tiebreakers: number[];
}

// ── Card parsing ──────────────────────────────────────────────────────────────

function parseCard(card: Card): { rank: number; suit: Suit } {
  return { rank: RANK_VALUE[card[0] as Rank], suit: card[1] as Suit };
}

// ── Five-card evaluator ───────────────────────────────────────────────────────

function eval5(cards: Card[]): HandRank {
  const parsed = cards.map(parseCard);
  const ranks  = parsed.map(c => c.rank).sort((a, b) => b - a); // descending
  const suits  = parsed.map(c => c.suit);

  const isFlush    = suits.every(s => s === suits[0]);
  const isNormal   = ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5;
  const isWheel    = ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4
                                     && ranks[3] === 3  && ranks[4] === 2;
  const hasStraight   = isNormal || isWheel;
  const straightHigh  = isWheel ? 5 : ranks[0];

  // Frequency tables
  const freq = new Map<number, number>();
  for (const r of ranks) freq.set(r, (freq.get(r) ?? 0) + 1);

  const byFreq = new Map<number, number[]>();
  for (const [r, c] of freq) {
    if (!byFreq.has(c)) byFreq.set(c, []);
    byFreq.get(c)!.push(r);
  }

  const desc   = (a: number, b: number) => b - a;
  const fours  = (byFreq.get(4) ?? []).sort(desc);
  const threes = (byFreq.get(3) ?? []).sort(desc);
  const pairs  = (byFreq.get(2) ?? []).sort(desc);
  const singles = (byFreq.get(1) ?? []).sort(desc);

  if (isFlush && hasStraight) return { category: "STRAIGHT_FLUSH", tiebreakers: [straightHigh] };
  if (fours.length)            return { category: "FOUR_OF_A_KIND",  tiebreakers: [fours[0], singles[0]] };
  if (threes.length && pairs.length)
                               return { category: "FULL_HOUSE",      tiebreakers: [threes[0], pairs[0]] };
  if (isFlush)                 return { category: "FLUSH",           tiebreakers: ranks };
  if (hasStraight)             return { category: "STRAIGHT",        tiebreakers: [straightHigh] };
  if (threes.length)           return { category: "THREE_OF_A_KIND", tiebreakers: [threes[0], ...singles] };
  if (pairs.length === 2)      return { category: "TWO_PAIR",        tiebreakers: [pairs[0], pairs[1], singles[0]] };
  if (pairs.length === 1)      return { category: "ONE_PAIR",        tiebreakers: [pairs[0], ...singles] };
  return                              { category: "HIGH_CARD",        tiebreakers: ranks };
}

// ── Combination generator  C(n, k) ────────────────────────────────────────────

function combinations(n: number, k: number): number[][] {
  const result: number[][] = [];
  const combo: number[] = [];
  function go(start: number) {
    if (combo.length === k) { result.push([...combo]); return; }
    for (let i = start; i < n; i++) { combo.push(i); go(i + 1); combo.pop(); }
  }
  go(0);
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

// Compare two HandRanks: 1 if a wins, -1 if b wins, 0 if tied.
export function compareHands(a: HandRank, b: HandRank): 1 | -1 | 0 {
  const ca = CATEGORY_RANK[a.category];
  const cb = CATEGORY_RANK[b.category];
  if (ca !== cb) return ca > cb ? 1 : -1;

  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i++) {
    const ta = a.tiebreakers[i] ?? 0;
    const tb = b.tiebreakers[i] ?? 0;
    if (ta !== tb) return ta > tb ? 1 : -1;
  }
  return 0;
}

// Best 5-card hand from 2 hole cards + board (3–5 cards). Board must be ≥ 3.
export function evaluateHand(holeCards: [Card, Card], board: Card[]): HandRank {
  const all   = [...holeCards, ...board];
  const combos = combinations(all.length, 5);
  let best: HandRank | null = null;
  for (const indices of combos) {
    const five = indices.map(i => all[i]) as Card[];
    const rank = eval5(five);
    if (best === null || compareHands(rank, best) > 0) best = rank;
  }
  return best!;
}
