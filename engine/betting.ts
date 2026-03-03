import type { GameState, Action } from "./types";

export function currentBet(state: GameState): number {
  return Math.max(state.players[0].betThisStreet, state.players[1].betThisStreet);
}

export function amountToCall(state: GameState, idx: 0 | 1): number {
  return currentBet(state) - state.players[idx].betThisStreet;
}

// Round is complete when:
//   • a player folded, OR
//   • both players are "done" AND bets are equalized (or both all-in)
//
// A player counts as "done" if they have voluntarily acted OR are all-in
// (an all-in player cannot take further action regardless of hasActed).
export function isRoundComplete(state: GameState): boolean {
  const [p0, p1] = state.players;
  if (p0.folded || p1.folded) return true;
  const p0done = p0.hasActed || p0.isAllIn;
  const p1done = p1.hasActed || p1.isAllIn;
  if (!p0done || !p1done) return false;
  return p0.betThisStreet === p1.betThisStreet || (p0.isAllIn && p1.isAllIn);
}

export function assertLegalAction(state: GameState, action: Action): void {
  if (state.isHandOver) throw new Error("Hand is already over");

  const actorIdx = state.activePlayerIndex;
  const actor = state.players[actorIdx];

  if (actor.id !== action.playerId) {
    throw new Error(`It is ${actor.id}'s turn, not ${action.playerId}'s`);
  }

  const toCall = amountToCall(state, actorIdx);

  switch (action.type) {
    case "fold":
    case "all_in":
      break; // always legal when it's your turn

    case "check":
      if (toCall > 0)
        throw new Error(`Cannot check: ${toCall} to call`);
      break;

    case "call":
      if (toCall === 0)
        throw new Error("Nothing to call: use check");
      break;

    case "raise_to": {
      if (action.amount === undefined)
        throw new Error("raise_to requires an amount");
      const bet = currentBet(state);
      const maxAllowed = actor.betThisStreet + actor.stack;
      if (action.amount <= bet)
        throw new Error(`raise_to ${action.amount} must exceed current bet ${bet}`);
      if (action.amount > maxAllowed)
        throw new Error(`raise_to ${action.amount} exceeds stack+committed ${maxAllowed}`);
      break;
    }

    default:
      throw new Error(`Unknown action type: ${(action as Action).type}`);
  }
}
