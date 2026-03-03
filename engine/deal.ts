import type { GameState } from "./types";
import { newDeck, shuffle } from "./deck";

// Deals 2 hole cards to each player (SB first, then BB).
// Returns a new GameState; input is not mutated.
export function dealHoleCards(state: GameState, seed: number): GameState {
  const deck = shuffle(newDeck(), seed);
  const [sb1, sb2, bb1, bb2, ...remaining] = deck;

  return {
    ...state,
    deck: remaining,
    players: [
      { ...state.players[0], holeCards: [sb1, sb2] },
      { ...state.players[1], holeCards: [bb1, bb2] },
    ],
  };
}
