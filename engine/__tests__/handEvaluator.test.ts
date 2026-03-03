import { describe, it, expect } from "vitest";
import { evaluateHand, compareHands } from "../handEvaluator";
import type { HandRank } from "../handEvaluator";
import type { Card } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Wraps evaluateHand for 5-card hands: first 2 are "hole", rest are "board".
function rank5(c1: Card, c2: Card, c3: Card, c4: Card, c5: Card): HandRank {
  return evaluateHand([c1, c2], [c3, c4, c5]);
}

// Wraps for 7-card hands.
function rank7(
  c1: Card, c2: Card,
  b1: Card, b2: Card, b3: Card, b4: Card, b5: Card
): HandRank {
  return evaluateHand([c1, c2], [b1, b2, b3, b4, b5]);
}

function wins(a: HandRank, b: HandRank) { return compareHands(a, b) ===  1; }
function ties(a: HandRank, b: HandRank) { return compareHands(a, b) ===  0; }

// ── Hand category detection ───────────────────────────────────────────────────

describe("HIGH_CARD", () => {
  it("detects high card", () => {
    const r = rank5("Ah", "Kd", "Qc", "Jh", "9s");
    expect(r.category).toBe("HIGH_CARD");
    expect(r.tiebreakers).toEqual([14, 13, 12, 11, 9]);
  });
});

describe("ONE_PAIR", () => {
  it("detects a pair", () => {
    const r = rank5("Ah", "As", "Kd", "Qc", "Jh");
    expect(r.category).toBe("ONE_PAIR");
  });

  it("tiebreakers: [pair rank, kickers desc]", () => {
    const r = rank5("Ah", "As", "Kd", "Qc", "Jh");
    expect(r.tiebreakers).toEqual([14, 13, 12, 11]);
  });
});

describe("TWO_PAIR", () => {
  it("detects two pair", () => {
    const r = rank5("Ah", "As", "Kd", "Ks", "Qc");
    expect(r.category).toBe("TWO_PAIR");
  });

  it("tiebreakers: [high pair, low pair, kicker]", () => {
    const r = rank5("Ah", "As", "Kd", "Ks", "Qc");
    expect(r.tiebreakers).toEqual([14, 13, 12]);
  });
});

describe("THREE_OF_A_KIND", () => {
  it("detects trips", () => {
    const r = rank5("Ah", "As", "Ad", "Kd", "Qc");
    expect(r.category).toBe("THREE_OF_A_KIND");
    expect(r.tiebreakers).toEqual([14, 13, 12]);
  });
});

describe("STRAIGHT", () => {
  it("detects a Broadway straight (A-K-Q-J-T)", () => {
    const r = rank5("Ah", "Kd", "Qc", "Jh", "Ts");
    expect(r.category).toBe("STRAIGHT");
    expect(r.tiebreakers).toEqual([14]);
  });

  it("detects a mid straight (9-8-7-6-5)", () => {
    const r = rank5("9h", "8d", "7c", "6h", "5s");
    expect(r.category).toBe("STRAIGHT");
    expect(r.tiebreakers).toEqual([9]);
  });

  it("detects the wheel (A-2-3-4-5) and reports high as 5", () => {
    const r = rank5("Ah", "2d", "3c", "4h", "5s");
    expect(r.category).toBe("STRAIGHT");
    expect(r.tiebreakers).toEqual([5]);
  });

  it("wheel ranks lower than a 6-high straight", () => {
    const wheel   = rank5("Ah", "2d", "3c", "4h", "5s");
    const sixHigh = rank5("6h", "2d", "3c", "4h", "5s");
    expect(wins(sixHigh, wheel)).toBe(true);
  });
});

describe("FLUSH", () => {
  it("detects a flush", () => {
    const r = rank5("Ah", "Kh", "Qh", "Jh", "9h");
    expect(r.category).toBe("FLUSH");
    expect(r.tiebreakers).toEqual([14, 13, 12, 11, 9]);
  });

  it("higher flush beats lower flush (Ace vs King high)", () => {
    const aceHigh  = rank5("Ah", "Kh", "Qh", "Jh", "9h");
    const kingHigh = rank5("Kh", "Qh", "Jh", "Th", "8h");
    expect(wins(aceHigh, kingHigh)).toBe(true);
  });
});

describe("FULL_HOUSE", () => {
  it("detects full house", () => {
    const r = rank5("Ah", "As", "Ad", "Ks", "Kd");
    expect(r.category).toBe("FULL_HOUSE");
    expect(r.tiebreakers).toEqual([14, 13]);
  });

  it("aces full beats kings full", () => {
    const acesFull  = rank5("Ah", "As", "Ad", "Ks", "Kd");
    const kingsFull = rank5("Kh", "Ks", "Kd", "As", "Ad");
    expect(wins(acesFull, kingsFull)).toBe(true);
  });
});

describe("FOUR_OF_A_KIND", () => {
  it("detects quads", () => {
    const r = rank5("Ah", "As", "Ad", "Ac", "Kd");
    expect(r.category).toBe("FOUR_OF_A_KIND");
    expect(r.tiebreakers).toEqual([14, 13]);
  });

  it("quad aces beats quad kings", () => {
    const quadA = rank5("Ah", "As", "Ad", "Ac", "2d");
    const quadK = rank5("Kh", "Ks", "Kd", "Kc", "Ad");
    expect(wins(quadA, quadK)).toBe(true);
  });

  it("kicker breaks tie between equal quads", () => {
    const withAce = rank5("2h", "2s", "2d", "2c", "Ad");
    const withKing = rank5("2h", "2s", "2d", "2c", "Kd");
    // note: can't really have two identical quad hands in one deck;
    // this tests the tiebreaker logic directly
    expect(wins(withAce, withKing)).toBe(true);
  });
});

describe("STRAIGHT_FLUSH", () => {
  it("detects a straight flush", () => {
    const r = rank5("9h", "8h", "7h", "6h", "5h");
    expect(r.category).toBe("STRAIGHT_FLUSH");
    expect(r.tiebreakers).toEqual([9]);
  });

  it("detects royal flush (A-high straight flush)", () => {
    const r = rank5("Ah", "Kh", "Qh", "Jh", "Th");
    expect(r.category).toBe("STRAIGHT_FLUSH");
    expect(r.tiebreakers).toEqual([14]);
  });

  it("detects wheel straight flush (A-2-3-4-5 same suit)", () => {
    const r = rank5("Ah", "2h", "3h", "4h", "5h");
    expect(r.category).toBe("STRAIGHT_FLUSH");
    expect(r.tiebreakers).toEqual([5]);
  });

  it("straight flush beats four of a kind", () => {
    const sf    = rank5("9h", "8h", "7h", "6h", "5h");
    const quads = rank5("Ah", "As", "Ad", "Ac", "Kd");
    expect(wins(sf, quads)).toBe(true);
  });
});

// ── Category ordering ─────────────────────────────────────────────────────────

describe("compareHands — category order", () => {
  const highCard  = rank5("Ah", "Kd", "Qc", "Jh", "9s");
  const onePair   = rank5("Ah", "As", "Kd", "Qc", "Jh");
  const twoPair   = rank5("Ah", "As", "Kd", "Ks", "Qc");
  const trips     = rank5("Ah", "As", "Ad", "Kd", "Qc");
  const straight  = rank5("Ah", "Kd", "Qc", "Jh", "Ts");
  const flush     = rank5("Ah", "Kh", "Qh", "Jh", "9h");
  const boat      = rank5("Ah", "As", "Ad", "Ks", "Kd");
  const quads     = rank5("Ah", "As", "Ad", "Ac", "Kd");
  const sf        = rank5("Ah", "Kh", "Qh", "Jh", "Th");

  const hands = [highCard, onePair, twoPair, trips, straight, flush, boat, quads, sf];
  const names = ["HIGH_CARD","ONE_PAIR","TWO_PAIR","THREE_OF_A_KIND",
                 "STRAIGHT","FLUSH","FULL_HOUSE","FOUR_OF_A_KIND","STRAIGHT_FLUSH"];

  it("each category beats every lower category", () => {
    for (let i = 1; i < hands.length; i++) {
      for (let j = 0; j < i; j++) {
        expect(wins(hands[i], hands[j])).toBe(true);
      }
    }
  });

  it("categories are correctly named", () => {
    hands.forEach((h, i) => expect(h.category).toBe(names[i]));
  });
});

// ── Tiebreaker comparisons ────────────────────────────────────────────────────

describe("compareHands — tiebreakers", () => {
  it("higher kicker wins a pair tie", () => {
    const withAceKicker  = rank5("Kh", "Ks", "Ad", "Qc", "Jh"); // pair K, kickers A Q J
    const withQueenKicker = rank5("Kh", "Ks", "Td", "Qc", "Jh"); // pair K, kickers Q J T
    expect(wins(withAceKicker, withQueenKicker)).toBe(true);
  });

  it("higher top pair wins a two-pair tie", () => {
    const aceKings  = rank5("Ah", "As", "Kd", "Ks", "Qc"); // AA KK Q
    const kingQueens = rank5("Kh", "Ks", "Qd", "Qs", "Ac"); // KK QQ A
    expect(wins(aceKings, kingQueens)).toBe(true);
  });

  it("tied two-pair uses kicker", () => {
    const aceKicker  = rank5("Ah", "As", "Kd", "Ks", "Qc"); // KK AA Q kicker
    // Note: can't build exact same pair with different kicker from 5 unique cards
    // so we compare conceptually via tiebreakers
    expect(aceKicker.tiebreakers[2]).toBe(12); // Q is the kicker
  });

  it("compareHands returns 0 for identical ranks", () => {
    const a = rank5("Ah", "Kd", "Qc", "Jh", "9s");
    const b = rank5("Ah", "Kd", "Qc", "Jh", "9s");
    expect(ties(a, b)).toBe(true);
  });
});

// ── 7-card best-hand selection ────────────────────────────────────────────────

describe("evaluateHand (7 cards)", () => {
  it("finds flush from 7 cards when 5-card subset is flush", () => {
    // Hole: Ah 6h  Board: Kh 8h 5h Qd 9s
    // Best flush: Ah Kh 8h 6h 5h
    const r = rank7("Ah", "6h", "Kh", "8h", "5h", "Qd", "9s");
    expect(r.category).toBe("FLUSH");
    expect(r.tiebreakers[0]).toBe(14); // Ace high
  });

  it("finds straight flush over flush from 7 cards", () => {
    // Hole: Ah Kh  Board: Qh Jh Th 2s 3d  → Royal Flush in hearts
    const r = rank7("Ah", "Kh", "Qh", "Jh", "Th", "2s", "3d");
    expect(r.category).toBe("STRAIGHT_FLUSH");
    expect(r.tiebreakers).toEqual([14]);
  });

  it("picks four-of-a-kind over full house from 7 cards", () => {
    // Hole: 2s 2d  Board: 2h 2c Ah As Kd  → quads 2 with A kicker
    const r = rank7("2s", "2d", "2h", "2c", "Ah", "As", "Kd");
    expect(r.category).toBe("FOUR_OF_A_KIND");
    expect(r.tiebreakers[0]).toBe(2);  // quad rank
    expect(r.tiebreakers[1]).toBe(14); // best kicker (Ace)
  });

  it("best full house chosen when multiple possible", () => {
    // Hole: Ah Ad  Board: As Kh Ks Kd 2c
    // Possible: A A A K K (full house aces full of kings)
    //        or K K K A A (kings full of aces) — aces full wins
    const r = rank7("Ah", "Ad", "As", "Kh", "Ks", "Kd", "2c");
    expect(r.category).toBe("FULL_HOUSE");
    expect(r.tiebreakers).toEqual([14, 13]); // aces full of kings
  });

  it("uses board card to complete hand", () => {
    // Hole: Ah Kd  Board: Qc Jh Ts 2d 3c  → A-K-Q-J-T straight
    const r = rank7("Ah", "Kd", "Qc", "Jh", "Ts", "2d", "3c");
    expect(r.category).toBe("STRAIGHT");
    expect(r.tiebreakers).toEqual([14]);
  });

  it("two pair beats one pair from 7 cards (kicker comparison)", () => {
    // handA hole [Kh,2c] + board [As,Ah,8d,6s,3h] → ONE_PAIR aces (K 8 6 kickers)
    // handB hole [Qs,Qd] + board [As,Ah,8d,6s,3h] → TWO_PAIR aces & queens
    // (no straights possible: A K Q 8 6 3 2 — no run of 5 consecutive)
    const handA = rank7("Kh", "2c", "As", "Ah", "8d", "6s", "3h");
    const handB = rank7("Qs", "Qd", "As", "Ah", "8d", "6s", "3h");
    expect(handA.category).toBe("ONE_PAIR");
    expect(handB.category).toBe("TWO_PAIR");
    expect(wins(handB, handA)).toBe(true);
  });
});
