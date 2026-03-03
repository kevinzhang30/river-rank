import type { GameState, GameConfig, PlayerState } from "./types";
import { dealHoleCards } from "./deal";

function postBlind(
  player: PlayerState,
  amount: number
): { player: PlayerState; posted: number } {
  const posted = Math.min(amount, player.stack);
  return {
    player: {
      ...player,
      stack: player.stack - posted,
      betThisStreet: posted,
      isAllIn: player.stack === posted,
    },
    posted,
  };
}

// startHand transitions from the end of one hand (or bootstrap state) to the
// beginning of the next. handNumber 0 is the bootstrap; hand 1 is the first
// real hand.
//
// Heads-up position rule:
//   • Hand 1  (prevState.handNumber === 0): keep bootstrap player order [SB, BB].
//   • Hand N+1 (prevState.handNumber  > 0): swap positions so the former BB
//     becomes the new SB.
export function startHand(
  prevState: GameState,
  config: GameConfig,
  seed: number
): GameState {
  const newHandNumber = prevState.handNumber + 1;

  // Determine who is SB/BB this hand.
  const [p0, p1] = prevState.players;
  const [rawSB, rawBB] =
    prevState.handNumber === 0 ? [p0, p1] : [p1, p0];

  const freshSB: PlayerState = {
    ...rawSB,
    position: "SB",
    holeCards: null,
    betThisStreet: 0,
    hasActed: false,
    folded: false,
    isAllIn: false,
  };
  const freshBB: PlayerState = {
    ...rawBB,
    position: "BB",
    holeCards: null,
    betThisStreet: 0,
    hasActed: false,
    folded: false,
    isAllIn: false,
  };

  const { player: sbAfter, posted: sbPosted } = postBlind(freshSB, config.smallBlind);
  const { player: bbAfter, posted: bbPosted } = postBlind(freshBB, config.bigBlind);

  const afterBlinds: GameState = {
    config,
    street: "preflop",
    pot: sbPosted + bbPosted,
    board: [],
    deck: [],
    players: [sbAfter, bbAfter],
    // SB acts first preflop, unless they used their entire stack posting the
    // blind (all-in on blind) — in that case BB must act instead.
    activePlayerIndex: sbAfter.isAllIn ? 1 : 0,
    handNumber: newHandNumber,
    isHandOver: false,
    winnerId: null,
  };

  return dealHoleCards(afterBlinds, seed);
}
