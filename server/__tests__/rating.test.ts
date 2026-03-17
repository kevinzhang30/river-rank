import { describe, it, expect } from "vitest";
import { eloUpdate, expectedScore } from "../rating";

// ── expectedScore ─────────────────────────────────────────────────────────────

describe("expectedScore", () => {
  it("returns 0.5 for equal ratings", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 10);
  });

  it("higher-rated player has score > 0.5", () => {
    expect(expectedScore(1200, 1000)).toBeGreaterThan(0.5);
  });

  it("lower-rated player has score < 0.5", () => {
    expect(expectedScore(800, 1000)).toBeLessThan(0.5);
  });

  it("E(A) + E(B) = 1 for any ratings", () => {
    const eA = expectedScore(1150, 950);
    const eB = expectedScore(950, 1150);
    expect(eA + eB).toBeCloseTo(1, 10);
  });

  it("400-point gap gives ~0.909 expected score for favourite", () => {
    // Classic result: 400-point diff → E ≈ 10/11 ≈ 0.9091
    expect(expectedScore(1400, 1000)).toBeCloseTo(10 / 11, 4);
  });

  it("is strictly monotonic: bigger rating diff → higher expectation", () => {
    expect(expectedScore(1200, 1000)).toBeGreaterThan(expectedScore(1100, 1000));
  });
});

// ── eloUpdate — equal ratings ─────────────────────────────────────────────────

describe("eloUpdate — equal ratings (1000 vs 1000, k=32)", () => {
  const WIN  = eloUpdate(1000, 1000, 1);
  const LOSS = eloUpdate(1000, 1000, 0);
  const DRAW = eloUpdate(1000, 1000, 0.5);

  it("win: A gains +16, B loses -16", () => {
    expect(WIN.deltaA).toBeCloseTo(16, 5);
    expect(WIN.newRatingA).toBeCloseTo(1016, 5);
    expect(WIN.newRatingB).toBeCloseTo(984, 5);
  });

  it("loss: A loses -16, B gains +16", () => {
    expect(LOSS.deltaA).toBeCloseTo(-16, 5);
    expect(LOSS.newRatingA).toBeCloseTo(984, 5);
    expect(LOSS.newRatingB).toBeCloseTo(1016, 5);
  });

  it("draw: no rating change for either player", () => {
    expect(DRAW.deltaA).toBeCloseTo(0, 5);
    expect(DRAW.newRatingA).toBeCloseTo(1000, 5);
    expect(DRAW.newRatingB).toBeCloseTo(1000, 5);
  });
});

// ── eloUpdate — unequal ratings ───────────────────────────────────────────────

describe("eloUpdate — unequal ratings (1200 vs 1000, k=32)", () => {
  it("favourite win: small gain for A", () => {
    const { deltaA } = eloUpdate(1200, 1000, 1);
    expect(deltaA).toBeGreaterThan(0);
    expect(deltaA).toBeLessThan(16); // less than the equal-rating win gain
  });

  it("underdog win: large gain for B (loss for A)", () => {
    const { deltaA } = eloUpdate(1200, 1000, 0);
    expect(deltaA).toBeLessThan(-16); // A loses more than the equal-rating case
  });

  it("upset (underdog wins) produces bigger swing than expected result", () => {
    const upset    = eloUpdate(1200, 1000, 0);   // A loses (upset)
    const expected = eloUpdate(1200, 1000, 1);   // A wins (expected)
    expect(Math.abs(upset.deltaA)).toBeGreaterThan(Math.abs(expected.deltaA));
  });

  it("favourite win: gain < 16; favourite loss: loss > 16", () => {
    const win  = eloUpdate(1200, 1000, 1);
    const loss = eloUpdate(1200, 1000, 0);
    expect(win.deltaA).toBeLessThan(16);
    expect(loss.deltaA).toBeLessThan(-16);
  });
});

// ── eloUpdate — zero-sum property ────────────────────────────────────────────

describe("eloUpdate — zero-sum", () => {
  const cases: Array<[number, number, 0 | 0.5 | 1]> = [
    [1000, 1000, 1],
    [1000, 1000, 0],
    [1000, 1000, 0.5],
    [1200, 800,  1],
    [800,  1200, 0],
    [1500, 1500, 0.5],
    [2000, 500,  1],
  ];

  it.each(cases)(
    "rA=%i rB=%i result=%s: ratings sum is conserved",
    (rA, rB, result) => {
      const { newRatingA, newRatingB } = eloUpdate(rA, rB, result);
      expect(newRatingA + newRatingB).toBeCloseTo(rA + rB, 8);
    }
  );
});

// ── eloUpdate — K-factor ──────────────────────────────────────────────────────

describe("eloUpdate — K-factor", () => {
  it("larger K produces larger delta for the same result", () => {
    const k16 = eloUpdate(1000, 1000, 1, 16);
    const k32 = eloUpdate(1000, 1000, 1, 32);
    const k64 = eloUpdate(1000, 1000, 1, 64);
    expect(k32.deltaA).toBeGreaterThan(k16.deltaA);
    expect(k64.deltaA).toBeGreaterThan(k32.deltaA);
  });

  it("k=0 still awards minimum 5 for a win", () => {
    const { deltaA, newRatingA, newRatingB } = eloUpdate(1200, 800, 1, 0);
    expect(deltaA).toBe(5);
    expect(newRatingA).toBe(1205);
    expect(newRatingB).toBe(795);
  });

  it("delta scales linearly with K for draws (same expected score)", () => {
    const k16 = eloUpdate(1200, 1000, 0.5, 16);
    const k32 = eloUpdate(1200, 1000, 0.5, 32);
    expect(k32.deltaA).toBeCloseTo(k16.deltaA * 2, 8);
  });
});

// ── eloUpdate — minimum gain floor ───────────────────────────────────────────

describe("eloUpdate — minimum gain of 5", () => {
  it("extreme gap: favourite (2000 vs 500) still gains at least 5", () => {
    const { deltaA } = eloUpdate(2000, 500, 1);
    expect(deltaA).toBeGreaterThanOrEqual(5);
  });

  it("extreme gap: underdog loss still loses at least 5", () => {
    const { deltaA } = eloUpdate(500, 2000, 0);
    expect(deltaA).toBeLessThanOrEqual(-5);
  });

  it("normal win is unaffected by the floor", () => {
    const { deltaA } = eloUpdate(1000, 1000, 1);
    expect(deltaA).toBeCloseTo(16, 5);
  });

  it("draws are not affected by the floor", () => {
    const { deltaA } = eloUpdate(2000, 500, 0.5);
    // Draw delta for favourite should be negative, no floor applied
    expect(deltaA).toBeLessThan(0);
  });
});

// ── eloUpdate — convergence over many games ───────────────────────────────────

describe("eloUpdate — iterative convergence", () => {
  it("ratings converge toward true strength over many games", () => {
    // Start equal. Simulate 200 games where A always wins.
    // A's rating should far exceed B's.
    let rA = 1000, rB = 1000;
    for (let i = 0; i < 200; i++) {
      const { newRatingA, newRatingB } = eloUpdate(rA, rB, 1);
      rA = newRatingA;
      rB = newRatingB;
    }
    expect(rA).toBeGreaterThan(rB + 500);
  });

  it("ratings are symmetric: flipping players mirrors the outcome", () => {
    const ab = eloUpdate(1200, 1000, 1);
    const ba = eloUpdate(1000, 1200, 0); // same game, labels swapped
    // A in first call = rA=1200 wins → gains little
    // A in second call = rA=1000 loses → deltaA should equal -(ab.deltaA)
    expect(ba.deltaA).toBeCloseTo(-ab.deltaA, 8);
  });
});
