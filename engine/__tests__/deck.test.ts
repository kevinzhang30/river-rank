import { describe, it, expect } from "vitest";
import { newDeck, shuffle } from "../deck";
import type { Card } from "../types";

describe("newDeck", () => {
  it("returns exactly 52 cards", () => {
    expect(newDeck()).toHaveLength(52);
  });

  it("contains no duplicates", () => {
    const deck = newDeck();
    expect(new Set(deck).size).toBe(52);
  });

  it("contains all four suits for every rank", () => {
    const deck = newDeck();
    const suits = ["s", "h", "d", "c"];
    const ranks = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
    for (const rank of ranks) {
      for (const suit of suits) {
        expect(deck).toContain(`${rank}${suit}` as Card);
      }
    }
  });
});

describe("shuffle", () => {
  it("returns exactly 52 cards", () => {
    expect(shuffle(newDeck(), 42)).toHaveLength(52);
  });

  it("contains no duplicates", () => {
    const shuffled = shuffle(newDeck(), 42);
    expect(new Set(shuffled).size).toBe(52);
  });

  it("is deterministic — same seed yields same order", () => {
    const a = shuffle(newDeck(), 1234);
    const b = shuffle(newDeck(), 1234);
    expect(a).toEqual(b);
  });

  it("different seeds yield different orders", () => {
    const a = shuffle(newDeck(), 1);
    const b = shuffle(newDeck(), 2);
    expect(a).not.toEqual(b);
  });

  it("does not mutate the original deck", () => {
    const original = newDeck();
    const snapshot = [...original];
    shuffle(original, 99);
    expect(original).toEqual(snapshot);
  });

  it("actually reorders the deck (not a no-op)", () => {
    const original = newDeck();
    const shuffled = shuffle(original, 7);
    expect(shuffled).not.toEqual(original);
  });
});
