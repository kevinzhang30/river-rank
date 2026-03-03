import type { GameState, Action, PlayerState, Street } from "./types";
import { assertLegalAction, isRoundComplete } from "./betting";

// ── Immutable tuple helpers ────────────────────────────────────────────────────

function setPlayer(
  players: [PlayerState, PlayerState],
  idx: 0 | 1,
  p: PlayerState
): [PlayerState, PlayerState] {
  return idx === 0 ? [p, players[1]] : [players[0], p];
}

function setBothPlayers(
  p0: PlayerState,
  p1: PlayerState
): [PlayerState, PlayerState] {
  return [p0, p1];
}

function opp(idx: 0 | 1): 0 | 1 {
  return idx === 0 ? 1 : 0;
}

// ── Street helpers ─────────────────────────────────────────────────────────────

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown"];

function nextStreet(s: Street): Street {
  return STREET_ORDER[STREET_ORDER.indexOf(s) + 1] ?? "showdown";
}

// Cards still needed to complete the board for showdown.
function cardsNeededForShowdown(s: Street): number {
  return { preflop: 5, flop: 2, turn: 1, river: 0, showdown: 0 }[s];
}

function dealFromDeck(state: GameState, count: number): GameState {
  if (count === 0) return state;
  return {
    ...state,
    board: [...state.board, ...state.deck.slice(0, count)],
    deck: state.deck.slice(count),
  };
}

// ── Street / hand resolution ───────────────────────────────────────────────────

function resolveRound(state: GameState): GameState {
  const [p0, p1] = state.players;

  // Fold: award pot, hand over.
  if (p0.folded || p1.folded) {
    const winner = p0.folded ? p1 : p0;
    return { ...state, isHandOver: true, winnerId: winner.id };
  }

  // At least one player is all-in: skip straight to showdown.
  if (p0.isAllIn || p1.isAllIn) {
    const needed = cardsNeededForShowdown(state.street);
    return { ...dealFromDeck(state, needed), street: "showdown" };
  }

  // Normal street advance.
  const next = nextStreet(state.street);
  if (next === "showdown") {
    return { ...state, street: "showdown" };
  }

  const cardsToAdd = next === "flop" ? 3 : 1; // turn/river = 1
  const dealt = dealFromDeck(state, cardsToAdd);

  return {
    ...dealt,
    street: next,
    activePlayerIndex: 1, // BB acts first postflop in heads-up
    players: setBothPlayers(
      { ...dealt.players[0], betThisStreet: 0, hasActed: false },
      { ...dealt.players[1], betThisStreet: 0, hasActed: false }
    ),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function applyAction(state: GameState, action: Action): GameState {
  assertLegalAction(state, action); // throws on illegal

  const aIdx = state.activePlayerIndex;
  const oIdx = opp(aIdx);
  const actor = state.players[aIdx];

  let s: GameState;

  switch (action.type) {
    case "fold": {
      s = {
        ...state,
        players: setPlayer(state.players, aIdx, { ...actor, folded: true, hasActed: true }),
      };
      break;
    }

    case "check": {
      s = {
        ...state,
        players: setPlayer(state.players, aIdx, { ...actor, hasActed: true }),
        activePlayerIndex: oIdx,
      };
      break;
    }

    case "call": {
      const toCall = Math.min(
        state.players[oIdx].betThisStreet - actor.betThisStreet,
        actor.stack
      );
      const called: PlayerState = {
        ...actor,
        stack: actor.stack - toCall,
        betThisStreet: actor.betThisStreet + toCall,
        hasActed: true,
        isAllIn: actor.stack === toCall,
      };
      s = {
        ...state,
        pot: state.pot + toCall,
        players: setPlayer(state.players, aIdx, called),
        activePlayerIndex: oIdx,
      };
      break;
    }

    case "raise_to": {
      const total = action.amount!;
      const extra = total - actor.betThisStreet;
      const raised: PlayerState = {
        ...actor,
        stack: actor.stack - extra,
        betThisStreet: total,
        hasActed: true,
        isAllIn: actor.stack === extra,
      };
      // Opponent must re-act after a raise.
      const opponent = { ...state.players[oIdx], hasActed: false };
      s = {
        ...state,
        pot: state.pot + extra,
        players: setBothPlayers(
          aIdx === 0 ? raised : opponent,
          aIdx === 0 ? opponent : raised
        ),
        activePlayerIndex: oIdx,
      };
      break;
    }

    case "all_in": {
      const extra = actor.stack;
      const allInPlayer: PlayerState = {
        ...actor,
        betThisStreet: actor.betThisStreet + extra,
        stack: 0,
        hasActed: true,
        isAllIn: true,
      };
      // Re-open action if this all-in raises above the current opponent bet.
      const opponent = state.players[oIdx];
      const newOpp =
        allInPlayer.betThisStreet > opponent.betThisStreet
          ? { ...opponent, hasActed: false }
          : opponent;
      s = {
        ...state,
        pot: state.pot + extra,
        players: setBothPlayers(
          aIdx === 0 ? allInPlayer : newOpp,
          aIdx === 0 ? newOpp : allInPlayer
        ),
        activePlayerIndex: oIdx,
      };
      break;
    }
  }

  return isRoundComplete(s) ? resolveRound(s) : s;
}
