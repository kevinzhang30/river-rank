import type { GameState, GameConfig, Action, PlayerState } from "./types";
import { startHand } from "./handStart";
import { applyAction } from "./applyAction";
import { evaluateShowdown } from "./showdown";

// ── Internal helpers ──────────────────────────────────────────────────────────

function makeFreshPlayer(
  id: string,
  position: PlayerState["position"],
  stack: number
): PlayerState {
  return {
    id, position, stack,
    holeCards: null, betThisStreet: 0,
    hasActed: false, folded: false, isAllIn: false,
  };
}

function awardFoldPot(s: GameState): GameState {
  const idx = s.players[0].id === s.winnerId ? 0 : 1;
  const updated: [PlayerState, PlayerState] =
    idx === 0
      ? [{ ...s.players[0], stack: s.players[0].stack + s.pot }, s.players[1]]
      : [s.players[0], { ...s.players[1], stack: s.players[1].stack + s.pot }];
  return { ...s, players: updated };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create the initial game and start hand 1.
 * playerIds[0] will be SB for hand 1.
 */
export function createGame(
  config: GameConfig,
  playerIds: [string, string],
  seed: number
): GameState {
  const bootstrap: GameState = {
    config,
    street: "preflop",
    pot: 0, board: [], deck: [],
    players: [
      makeFreshPlayer(playerIds[0], "SB", config.startingStack),
      makeFreshPlayer(playerIds[1], "BB", config.startingStack),
    ],
    activePlayerIndex: 0,
    handNumber: 0,
    isHandOver: false,
    winnerId: null,
  };
  return startHand(bootstrap, config, seed);
}

/**
 * Apply a player action with two automatic side-effects:
 *   1. When the result is street="showdown", evaluates the showdown immediately.
 *   2. When the result is a fold win, adds the pot to the winner's stack
 *      (applyAction intentionally leaves stacks untouched on folds so the pot
 *      can be read separately, but nextHand needs correct stacks to carry over).
 */
export function act(state: GameState, action: Action): GameState {
  let s = applyAction(state, action);

  // Auto-evaluate showdown
  if (s.street === "showdown" && !s.isHandOver) {
    s = evaluateShowdown(s);
  }

  // Award pot to fold winner (showdown already awards it via evaluateShowdown)
  if (s.isHandOver && s.winnerId !== null && s.street !== "showdown") {
    s = awardFoldPot(s);
  }

  return s;
}

/**
 * Begin the next hand. Carries stacks, swaps positions, posts blinds, deals.
 * Throws if the current hand is not yet over.
 */
export function nextHand(state: GameState, seed: number): GameState {
  if (!state.isHandOver) {
    throw new Error("Cannot start next hand: current hand is not over");
  }
  return startHand(state, state.config, seed);
}

/**
 * True when one player's stack has hit 0 (they've been eliminated).
 * Only meaningful once the current hand is over.
 */
export function isMatchOver(state: GameState): boolean {
  return state.isHandOver && state.players.some(p => p.stack === 0);
}

/**
 * Returns the id of the surviving player, or null if the match is not over.
 */
export function matchWinner(state: GameState): string | null {
  if (!isMatchOver(state)) return null;
  return state.players.find(p => p.stack > 0)?.id ?? null;
}
