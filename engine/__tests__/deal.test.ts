import { describe, it, expect } from "vitest";
import { dealHoleCards } from "../deal";
import type { GameConfig, GameState, PlayerState } from "../types";

// ── Fixture ───────────────────────────────────────────────────────────────────

function makePlayer(id: string, position: PlayerState["position"]): PlayerState {
  return {
    id,
    position,
    stack: 1000,
    holeCards: null,
    betThisStreet: 0,
    hasActed: false,
    folded: false,
    isAllIn: false,
  };
}

const CONFIG: GameConfig = { smallBlind: 50, bigBlind: 100, startingStack: 1000 };

const INITIAL_STATE: GameState = {
  config: CONFIG,
  street: "preflop",
  pot: 0,
  board: [],
  deck: [],
  players: [makePlayer("alice", "SB"), makePlayer("bob", "BB")],
  activePlayerIndex: 0,
  handNumber: 1,
  isHandOver: false,
  winnerId: null,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("dealHoleCards", () => {
  it("gives each player exactly 2 hole cards", () => {
    const state = dealHoleCards(INITIAL_STATE, 42);
    expect(state.players[0].holeCards).toHaveLength(2);
    expect(state.players[1].holeCards).toHaveLength(2);
  });

  it("leaves 48 cards in the remaining deck", () => {
    const state = dealHoleCards(INITIAL_STATE, 42);
    expect(state.deck).toHaveLength(48);
  });

  it("hole cards are not duplicated across players", () => {
    const state = dealHoleCards(INITIAL_STATE, 42);
    const sbCards = state.players[0].holeCards!;
    const bbCards = state.players[1].holeCards!;
    const allDealt = [...sbCards, ...bbCards];
    expect(new Set(allDealt).size).toBe(4);
  });

  it("hole cards are not in the remaining deck", () => {
    const state = dealHoleCards(INITIAL_STATE, 42);
    const dealt = new Set([
      ...state.players[0].holeCards!,
      ...state.players[1].holeCards!,
    ]);
    for (const card of state.deck) {
      expect(dealt.has(card)).toBe(false);
    }
  });

  it("is deterministic — same seed yields same cards", () => {
    const a = dealHoleCards(INITIAL_STATE, 7);
    const b = dealHoleCards(INITIAL_STATE, 7);
    expect(a.players[0].holeCards).toEqual(b.players[0].holeCards);
    expect(a.players[1].holeCards).toEqual(b.players[1].holeCards);
  });

  it("different seeds yield different hole cards", () => {
    const a = dealHoleCards(INITIAL_STATE, 1);
    const b = dealHoleCards(INITIAL_STATE, 2);
    expect(a.players[0].holeCards).not.toEqual(b.players[0].holeCards);
  });

  it("does not mutate the input state", () => {
    dealHoleCards(INITIAL_STATE, 42);
    expect(INITIAL_STATE.players[0].holeCards).toBeNull();
    expect(INITIAL_STATE.players[1].holeCards).toBeNull();
    expect(INITIAL_STATE.deck).toHaveLength(0);
  });

  it("preserves all other state fields unchanged", () => {
    const state = dealHoleCards(INITIAL_STATE, 42);
    expect(state.street).toBe("preflop");
    expect(state.pot).toBe(0);
    expect(state.board).toHaveLength(0);
    expect(state.isHandOver).toBe(false);
    expect(state.winnerId).toBeNull();
    expect(state.players[0].stack).toBe(1000);
    expect(state.players[1].stack).toBe(1000);
  });
});
