import type { InternalGameState, LegalActions } from "./types";

// ── Error type ────────────────────────────────────────────────────────────────

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

// ── Legal action query ────────────────────────────────────────────────────────

/**
 * Returns which actions are available for playerId right now.
 * All booleans are false when it is not playerId's turn.
 */
export function getLegalActions(state: InternalGameState, playerId: string): LegalActions {
  if (state.street === "SHOWDOWN" || state.toActId !== playerId) {
    return { canFold: false, canCheck: false, canCall: false };
  }

  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.folded) {
    return { canFold: false, canCheck: false, canCall: false };
  }

  const facingBet  = state.currentBet > player.betThisStreet;
  const toCall     = Math.min(state.currentBet - player.betThisStreet, player.stack);
  const callAmount = toCall; // already capped at stack (handles all-in call)

  // Min raise-to:
  //   • No bet yet this street → minRaiseTo = bigBlind
  //   • Facing a bet/raise     → minRaiseTo = currentBet + (currentBet - previousBet)
  const minRaiseBy  = state.currentBet === 0
    ? state.bigBlind
    : state.currentBet - state.previousBet;
  const minRaiseTo  = state.currentBet + minRaiseBy;

  // Max raise-to = player's full stack committed (all-in)
  const maxRaiseTo  = player.stack + player.betThisStreet;

  // Raise is possible if the player can put more in than the current bet
  const canRaise    = player.stack > 0 && maxRaiseTo > state.currentBet;

  return {
    canFold:    true,
    canCheck:   !facingBet,
    canCall:    facingBet,
    callAmount: facingBet ? callAmount : undefined,
    // Clamp minRaiseTo down to maxRaiseTo so a short-stack all-in is always valid
    minRaiseTo: canRaise ? Math.min(minRaiseTo, maxRaiseTo) : undefined,
    maxRaiseTo: canRaise ? maxRaiseTo : undefined,
  };
}

// ── Action validation ─────────────────────────────────────────────────────────

/**
 * Throws ActionError if the action is illegal. Does not mutate state.
 */
export function validateAction(
  state:    InternalGameState,
  playerId: string,
  action:   string,
  amount?:  number,
): void {
  if (state.street === "SHOWDOWN") {
    throw new ActionError("Hand is at showdown — no actions allowed");
  }
  if (state.toActId !== playerId) {
    throw new ActionError("Not your turn");
  }

  const legal = getLegalActions(state, playerId);

  // canFold doubles as "is it your turn at all"
  if (!legal.canFold) {
    throw new ActionError("Not your turn");
  }

  switch (action) {
    case "FOLD":
      break;

    case "CHECK":
      if (!legal.canCheck)
        throw new ActionError(`Cannot check — ${legal.callAmount} to call`);
      break;

    case "CALL":
      if (!legal.canCall)
        throw new ActionError("Nothing to call — use check");
      break;

    case "RAISE_TO":
      if (amount === undefined)
        throw new ActionError("RAISE_TO requires an amount");
      if (legal.minRaiseTo === undefined || legal.maxRaiseTo === undefined)
        throw new ActionError("Raise not available");
      if (amount < legal.minRaiseTo)
        throw new ActionError(`Raise to ${amount} is below minimum ${legal.minRaiseTo}`);
      if (amount > legal.maxRaiseTo)
        throw new ActionError(`Raise to ${amount} exceeds maximum ${legal.maxRaiseTo} (all-in)`);
      break;

    case "ALL_IN": {
      const player = state.players.find((p) => p.id === playerId)!;
      if (player.stack === 0)
        throw new ActionError("Already all-in");
      break;
    }

    default:
      throw new ActionError(`Unknown action: ${action}`);
  }
}
