import type { GameState } from "./types";
import { evaluateHand, compareHands } from "./handEvaluator";

// Evaluates the showdown, awards the pot, and marks the hand as over.
// Preconditions: state.street === "showdown", board has 5 cards, both players
// have hole cards.
export function evaluateShowdown(state: GameState): GameState {
  if (state.street !== "showdown") {
    throw new Error(`evaluateShowdown requires street="showdown", got "${state.street}"`);
  }

  const [p0, p1] = state.players;

  if (!p0.holeCards || !p1.holeCards) {
    throw new Error("Both players must have hole cards at showdown");
  }
  if (state.board.length !== 5) {
    throw new Error(`Board must have 5 cards at showdown, got ${state.board.length}`);
  }

  const rank0 = evaluateHand(p0.holeCards, state.board);
  const rank1 = evaluateHand(p1.holeCards, state.board);
  const cmp   = compareHands(rank0, rank1);

  if (cmp > 0) {
    // p0 (SB) wins
    return {
      ...state,
      isHandOver: true,
      winnerId: p0.id,
      players: [{ ...p0, stack: p0.stack + state.pot }, p1],
    };
  }

  if (cmp < 0) {
    // p1 (BB) wins
    return {
      ...state,
      isHandOver: true,
      winnerId: p1.id,
      players: [p0, { ...p1, stack: p1.stack + state.pot }],
    };
  }

  // Exact tie — split pot. Odd chip goes to SB (index 0) by convention.
  const half      = Math.floor(state.pot / 2);
  const remainder = state.pot % 2;
  return {
    ...state,
    isHandOver: true,
    winnerId: null, // null signals a split
    players: [
      { ...p0, stack: p0.stack + half + remainder },
      { ...p1, stack: p1.stack + half },
    ],
  };
}
