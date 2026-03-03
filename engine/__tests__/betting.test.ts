import { describe, it, expect } from "vitest";
import { currentBet, amountToCall, isRoundComplete, assertLegalAction } from "../betting";
import { startHand } from "../handStart";
import type { GameConfig, GameState, PlayerState } from "../types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONFIG: GameConfig = { smallBlind: 50, bigBlind: 100, startingStack: 1000 };
const SEED = 42;

function makePlayer(
  id: string,
  position: PlayerState["position"],
  overrides: Partial<PlayerState> = {}
): PlayerState {
  return {
    id,
    position,
    stack: 1000,
    holeCards: null,
    betThisStreet: 0,
    hasActed: false,
    folded: false,
    isAllIn: false,
    ...overrides,
  };
}

function bootstrap(): GameState {
  return {
    config: CONFIG,
    street: "preflop",
    pot: 0,
    board: [],
    deck: [],
    players: [makePlayer("alice", "SB"), makePlayer("bob", "BB")],
    activePlayerIndex: 0,
    handNumber: 0,
    isHandOver: false,
    winnerId: null,
  };
}

// After startHand: alice(SB) stack=950 bet=50, bob(BB) stack=900 bet=100, pot=150
const preflopState = () => startHand(bootstrap(), CONFIG, SEED);

// ── currentBet ────────────────────────────────────────────────────────────────

describe("currentBet", () => {
  it("returns max of both bets (BB blind > SB blind preflop)", () => {
    expect(currentBet(preflopState())).toBe(100);
  });

  it("returns 0 when no bets on a fresh street", () => {
    const s = preflopState();
    const flopState: GameState = {
      ...s,
      street: "flop",
      players: [
        { ...s.players[0], betThisStreet: 0 },
        { ...s.players[1], betThisStreet: 0 },
      ],
    };
    expect(currentBet(flopState)).toBe(0);
  });
});

// ── amountToCall ──────────────────────────────────────────────────────────────

describe("amountToCall", () => {
  it("SB must call 50 to match BB blind preflop", () => {
    expect(amountToCall(preflopState(), 0)).toBe(50);
  });

  it("BB owes nothing after SB calls (both at 100)", () => {
    const s = preflopState();
    const called: GameState = {
      ...s,
      players: [{ ...s.players[0], betThisStreet: 100 }, s.players[1]],
    };
    expect(amountToCall(called, 1)).toBe(0);
  });
});

// ── isRoundComplete ───────────────────────────────────────────────────────────

describe("isRoundComplete", () => {
  it("is false at hand start (neither player has acted)", () => {
    expect(isRoundComplete(preflopState())).toBe(false);
  });

  it("is false when only one player has acted", () => {
    const s = preflopState();
    const oneActed: GameState = {
      ...s,
      players: [{ ...s.players[0], hasActed: true, betThisStreet: 100 }, s.players[1]],
    };
    expect(isRoundComplete(oneActed)).toBe(false);
  });

  it("is true when both acted and bets are equal", () => {
    const s = preflopState();
    const both: GameState = {
      ...s,
      players: [
        { ...s.players[0], hasActed: true, betThisStreet: 100 },
        { ...s.players[1], hasActed: true, betThisStreet: 100 },
      ],
    };
    expect(isRoundComplete(both)).toBe(true);
  });

  it("is true when a player folded", () => {
    const s = preflopState();
    const folded: GameState = {
      ...s,
      players: [{ ...s.players[0], folded: true }, s.players[1]],
    };
    expect(isRoundComplete(folded)).toBe(true);
  });

  it("is true when both are all-in even with unequal bets", () => {
    const s = preflopState();
    const bothAllIn: GameState = {
      ...s,
      players: [
        { ...s.players[0], hasActed: true, isAllIn: true, betThisStreet: 300 },
        { ...s.players[1], hasActed: true, isAllIn: true, betThisStreet: 200 },
      ],
    };
    expect(isRoundComplete(bothAllIn)).toBe(true);
  });

  it("is false when one is all-in but opponent has not acted yet", () => {
    const s = preflopState();
    const oneAllIn: GameState = {
      ...s,
      players: [
        { ...s.players[0], hasActed: true, isAllIn: true, betThisStreet: 1000 },
        { ...s.players[1], hasActed: false },           // not all-in, must still act
      ],
    };
    expect(isRoundComplete(oneAllIn)).toBe(false);
  });

  it("is true when one player went all-in on blind post and the other has now acted", () => {
    // Scenario: BB posts blind using their entire stack (isAllIn=true, hasActed=false).
    // SB calls (hasActed=true). Round should be complete even though BB never
    // had a chance to voluntarily act.
    const s = preflopState();
    const bbBlindAllIn: GameState = {
      ...s,
      players: [
        { ...s.players[0], hasActed: true,  isAllIn: true,  betThisStreet: 1000 }, // SB called
        { ...s.players[1], hasActed: false, isAllIn: true,  betThisStreet: 1000 }, // BB blind all-in
      ],
    };
    expect(isRoundComplete(bbBlindAllIn)).toBe(true);
  });
});

// ── assertLegalAction ─────────────────────────────────────────────────────────

describe("assertLegalAction — legality", () => {
  it("throws when it is not the player's turn", () => {
    const s = preflopState(); // alice's turn (SB)
    expect(() =>
      assertLegalAction(s, { type: "fold", playerId: "bob" })
    ).toThrow();
  });

  it("allows fold at any time on your turn", () => {
    const s = preflopState();
    expect(() =>
      assertLegalAction(s, { type: "fold", playerId: "alice" })
    ).not.toThrow();
  });

  it("rejects check when there is a bet to call", () => {
    const s = preflopState(); // SB must call 50
    expect(() =>
      assertLegalAction(s, { type: "check", playerId: "alice" })
    ).toThrow(/check/i);
  });

  it("allows check when bets are equal", () => {
    const s = preflopState();
    const equalBets: GameState = {
      ...s,
      activePlayerIndex: 1,
      players: [
        { ...s.players[0], betThisStreet: 100, hasActed: true },
        s.players[1],
      ],
    };
    expect(() =>
      assertLegalAction(equalBets, { type: "check", playerId: "bob" })
    ).not.toThrow();
  });

  it("rejects call when nothing to call", () => {
    const s = preflopState();
    const equalBets: GameState = {
      ...s,
      activePlayerIndex: 1,
      players: [
        { ...s.players[0], betThisStreet: 100, hasActed: true },
        s.players[1],
      ],
    };
    expect(() =>
      assertLegalAction(equalBets, { type: "call", playerId: "bob" })
    ).toThrow(/nothing to call/i);
  });

  it("allows call when there is a bet", () => {
    const s = preflopState();
    expect(() =>
      assertLegalAction(s, { type: "call", playerId: "alice" })
    ).not.toThrow();
  });

  it("rejects raise_to at or below current bet", () => {
    const s = preflopState(); // currentBet = 100
    expect(() =>
      assertLegalAction(s, { type: "raise_to", playerId: "alice", amount: 100 })
    ).toThrow(/must exceed/i);
  });

  it("rejects raise_to above stack+committed", () => {
    const s = preflopState(); // alice: stack=950, bet=50 → max=1000
    expect(() =>
      assertLegalAction(s, { type: "raise_to", playerId: "alice", amount: 1001 })
    ).toThrow(/exceeds/i);
  });

  it("allows raise_to above current bet and within stack", () => {
    const s = preflopState();
    expect(() =>
      assertLegalAction(s, { type: "raise_to", playerId: "alice", amount: 200 })
    ).not.toThrow();
  });

  it("allows raise_to equal to stack+committed (all-in raise)", () => {
    const s = preflopState(); // alice max = 1000
    expect(() =>
      assertLegalAction(s, { type: "raise_to", playerId: "alice", amount: 1000 })
    ).not.toThrow();
  });

  it("allows all_in unconditionally", () => {
    const s = preflopState();
    expect(() =>
      assertLegalAction(s, { type: "all_in", playerId: "alice" })
    ).not.toThrow();
  });

  it("throws on an already-finished hand", () => {
    const s = { ...preflopState(), isHandOver: true };
    expect(() =>
      assertLegalAction(s, { type: "fold", playerId: "alice" })
    ).toThrow(/over/i);
  });
});
