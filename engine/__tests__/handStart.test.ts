import { describe, it, expect } from "vitest";
import { startHand } from "../handStart";
import type { GameConfig, GameState, PlayerState } from "../types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONFIG: GameConfig = { smallBlind: 50, bigBlind: 100, startingStack: 1000 };

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

// Bootstrap state: handNumber 0, players in intended hand-1 order [SB, BB].
function bootstrap(
  aliceStack = 1000,
  bobStack = 1000,
  config: GameConfig = CONFIG
): GameState {
  return {
    config,
    street: "preflop",
    pot: 0,
    board: [],
    deck: [],
    players: [makePlayer("alice", "SB", aliceStack), makePlayer("bob", "BB", bobStack)],
    activePlayerIndex: 0,
    handNumber: 0,
    isHandOver: false,
    winnerId: null,
  };
}

const SEED = 42;

// ── Hand 1 basics ─────────────────────────────────────────────────────────────

describe("startHand — hand 1", () => {
  const hand1 = startHand(bootstrap(), CONFIG, SEED);

  it("sets handNumber to 1", () => {
    expect(hand1.handNumber).toBe(1);
  });

  it("keeps alice as SB and bob as BB", () => {
    expect(hand1.players[0].id).toBe("alice");
    expect(hand1.players[0].position).toBe("SB");
    expect(hand1.players[1].id).toBe("bob");
    expect(hand1.players[1].position).toBe("BB");
  });

  it("deducts blinds from stacks", () => {
    expect(hand1.players[0].stack).toBe(950); // 1000 - 50
    expect(hand1.players[1].stack).toBe(900); // 1000 - 100
  });

  it("records betThisStreet for each blind", () => {
    expect(hand1.players[0].betThisStreet).toBe(50);
    expect(hand1.players[1].betThisStreet).toBe(100);
  });

  it("puts combined blinds in the pot", () => {
    expect(hand1.pot).toBe(150);
  });

  it("starts on preflop with empty board", () => {
    expect(hand1.street).toBe("preflop");
    expect(hand1.board).toHaveLength(0);
  });

  it("SB acts first preflop (activePlayerIndex === 0)", () => {
    expect(hand1.activePlayerIndex).toBe(0);
  });

  it("deals 2 hole cards to each player", () => {
    expect(hand1.players[0].holeCards).toHaveLength(2);
    expect(hand1.players[1].holeCards).toHaveLength(2);
  });

  it("leaves 48 cards in the deck", () => {
    expect(hand1.deck).toHaveLength(48);
  });

  it("is not over and has no winner", () => {
    expect(hand1.isHandOver).toBe(false);
    expect(hand1.winnerId).toBeNull();
  });

  it("resets hasActed and folded flags", () => {
    for (const p of hand1.players) {
      expect(p.hasActed).toBe(false);
      expect(p.folded).toBe(false);
    }
  });
});

// ── Dealer alternation ────────────────────────────────────────────────────────

describe("startHand — dealer alternation", () => {
  it("swaps positions on hand 2", () => {
    const hand1 = startHand(bootstrap(), CONFIG, SEED);
    const hand2 = startHand(hand1, CONFIG, SEED);

    expect(hand2.handNumber).toBe(2);
    expect(hand2.players[0].id).toBe("bob");   // former BB → SB
    expect(hand2.players[0].position).toBe("SB");
    expect(hand2.players[1].id).toBe("alice"); // former SB → BB
    expect(hand2.players[1].position).toBe("BB");
  });

  it("swaps back on hand 3", () => {
    const hand1 = startHand(bootstrap(), CONFIG, SEED);
    const hand2 = startHand(hand1, CONFIG, SEED);
    const hand3 = startHand(hand2, CONFIG, SEED);

    expect(hand3.players[0].id).toBe("alice");
    expect(hand3.players[0].position).toBe("SB");
    expect(hand3.players[1].id).toBe("bob");
    expect(hand3.players[1].position).toBe("BB");
  });

  it("carries stacks across hand boundary", () => {
    const hand1 = startHand(bootstrap(), CONFIG, SEED);
    // hand1: alice.stack=950, bob.stack=900
    const hand2 = startHand(hand1, CONFIG, SEED);
    // hand2: bob is SB (900 - 50 = 850), alice is BB (950 - 100 = 850)
    expect(hand2.players[0].stack).toBe(850); // bob SB
    expect(hand2.players[1].stack).toBe(850); // alice BB
  });
});

// ── All-in blind posting ──────────────────────────────────────────────────────

describe("startHand — all-in blind posting", () => {
  it("SB goes all-in when stack < smallBlind", () => {
    const state = startHand(bootstrap(30, 1000), CONFIG, SEED);
    const sb = state.players[0];
    expect(sb.stack).toBe(0);
    expect(sb.betThisStreet).toBe(30);
    expect(sb.isAllIn).toBe(true);
    expect(state.pot).toBe(130); // 30 + 100
  });

  it("SB goes all-in when stack === smallBlind", () => {
    const state = startHand(bootstrap(50, 1000), CONFIG, SEED);
    const sb = state.players[0];
    expect(sb.stack).toBe(0);
    expect(sb.isAllIn).toBe(true);
  });

  it("BB goes all-in when stack < bigBlind", () => {
    const state = startHand(bootstrap(1000, 75), CONFIG, SEED);
    const bb = state.players[1];
    expect(bb.stack).toBe(0);
    expect(bb.betThisStreet).toBe(75);
    expect(bb.isAllIn).toBe(true);
    expect(state.pot).toBe(125); // 50 + 75
  });

  it("BB goes all-in when stack === bigBlind", () => {
    const state = startHand(bootstrap(1000, 100), CONFIG, SEED);
    const bb = state.players[1];
    expect(bb.stack).toBe(0);
    expect(bb.isAllIn).toBe(true);
  });

  it("both players all-in when both stacks are tiny", () => {
    const state = startHand(bootstrap(20, 40), CONFIG, SEED);
    expect(state.players[0].isAllIn).toBe(true);
    expect(state.players[1].isAllIn).toBe(true);
    expect(state.pot).toBe(60);
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe("startHand — determinism", () => {
  it("same seed produces same hole cards", () => {
    const a = startHand(bootstrap(), CONFIG, 7);
    const b = startHand(bootstrap(), CONFIG, 7);
    expect(a.players[0].holeCards).toEqual(b.players[0].holeCards);
    expect(a.players[1].holeCards).toEqual(b.players[1].holeCards);
  });

  it("different seeds produce different hole cards", () => {
    const a = startHand(bootstrap(), CONFIG, 1);
    const b = startHand(bootstrap(), CONFIG, 2);
    expect(a.players[0].holeCards).not.toEqual(b.players[0].holeCards);
  });
});
