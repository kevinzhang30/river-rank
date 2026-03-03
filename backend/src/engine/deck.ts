import type { Card } from "./types";

const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
const SUITS = ["s","h","d","c"];

/** Return a fresh, ordered 52-card deck. */
export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

/** Fisher-Yates shuffle. Returns a new array; does not mutate the input. */
export function shuffle(deck: Card[]): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Deal 2 cards off the top of the deck. Returns the hand + remaining deck. */
export function dealHoleCards(deck: Card[]): {
  hand:      [Card, Card];
  remaining: Card[];
} {
  if (deck.length < 2) throw new Error("Not enough cards in deck");
  return {
    hand:      [deck[0], deck[1]],
    remaining: deck.slice(2),
  };
}
