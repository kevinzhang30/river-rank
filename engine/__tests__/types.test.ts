import { describe, it, expect } from "vitest";
import type {
  GameConfig,
  GameState,
  PlayerState,
  Action,
  Card,
} from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlayer(
  id: string,
  position: PlayerState["position"],
  stack: number
): PlayerState {
  return {
    id,
    position,
    stack,
    holeCards: null,
    betThisStreet: 0,
    hasActed: false,
    folded: false,
    isAllIn: false,
  };
}

function makeInitialState(config: GameConfig): GameState {
  return {
    config,
    street: "preflop",
    pot: 0,
    board: [],
    deck: [],
    players: [
      makePlayer("alice", "SB", config.startingStack),
      makePlayer("bob", "BB", config.startingStack),
    ],
    activePlayerIndex: 0,
    handNumber: 1,
    isHandOver: false,
    winnerId: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GameConfig", () => {
  it("holds blind and stack values", () => {
    const config: GameConfig = { smallBlind: 50, bigBlind: 100, startingStack: 1000 };
    expect(config.bigBlind).toBe(config.smallBlind * 2);
    expect(config.startingStack).toBeGreaterThan(config.bigBlind);
  });
});

describe("PlayerState", () => {
  it("initialises with no hole cards and zero bet", () => {
    const player = makePlayer("alice", "SB", 1000);
    expect(player.holeCards).toBeNull();
    expect(player.betThisStreet).toBe(0);
    expect(player.folded).toBe(false);
    expect(player.isAllIn).toBe(false);
  });

  it("accepts a valid hole-card tuple once assigned", () => {
    const player = makePlayer("bob", "BB", 1000);
    const cards: [Card, Card] = ["As", "Kh"];
    player.holeCards = cards;
    expect(player.holeCards).toHaveLength(2);
    expect(player.holeCards[0]).toBe("As");
  });
});

describe("GameState", () => {
  const config: GameConfig = { smallBlind: 50, bigBlind: 100, startingStack: 1000 };

  it("starts on preflop with an empty board", () => {
    const state = makeInitialState(config);
    expect(state.street).toBe("preflop");
    expect(state.board).toHaveLength(0);
  });

  it("has exactly two players with correct positions", () => {
    const state = makeInitialState(config);
    expect(state.players).toHaveLength(2);
    expect(state.players[0].position).toBe("SB");
    expect(state.players[1].position).toBe("BB");
  });

  it("starts with pot zero and no winner", () => {
    const state = makeInitialState(config);
    expect(state.pot).toBe(0);
    expect(state.isHandOver).toBe(false);
    expect(state.winnerId).toBeNull();
  });

  it("stacks equal startingStack before any blinds posted", () => {
    const state = makeInitialState(config);
    for (const p of state.players) {
      expect(p.stack).toBe(config.startingStack);
    }
  });
});

describe("Action", () => {
  it("fold action has no amount", () => {
    const action: Action = { type: "fold", playerId: "alice" };
    expect(action.amount).toBeUndefined();
  });

  it("raise_to action carries an amount", () => {
    const action: Action = { type: "raise_to", playerId: "bob", amount: 200 };
    expect(action.amount).toBe(200);
  });

  it("all_in action needs no amount", () => {
    const action: Action = { type: "all_in", playerId: "alice" };
    expect(action.type).toBe("all_in");
    expect(action.amount).toBeUndefined();
  });
});
