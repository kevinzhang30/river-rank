import { describe, it, expect } from "vitest";
import { applyAction } from "../applyAction";
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

// Preflop state: alice(SB) stack=950 bet=50, bob(BB) stack=900 bet=100, pot=150
const preflop = () => startHand(bootstrap(), CONFIG, SEED);

// ── FOLD ──────────────────────────────────────────────────────────────────────

describe("applyAction — fold", () => {
  it("sets folded=true for the actor", () => {
    const s = applyAction(preflop(), { type: "fold", playerId: "alice" });
    expect(s.players[0].folded).toBe(true);
  });

  it("ends the hand immediately", () => {
    const s = applyAction(preflop(), { type: "fold", playerId: "alice" });
    expect(s.isHandOver).toBe(true);
  });

  it("awards the pot to the non-folder (BB wins SB fold)", () => {
    const s = applyAction(preflop(), { type: "fold", playerId: "alice" });
    expect(s.winnerId).toBe("bob");
  });

  it("BB folding awards pot to SB", () => {
    const s0 = preflop();
    // SB calls first so BB can act
    const s1 = applyAction(s0, { type: "call", playerId: "alice" });
    const s2 = applyAction(s1, { type: "fold", playerId: "bob" });
    expect(s2.winnerId).toBe("alice");
    expect(s2.isHandOver).toBe(true);
  });

  it("does not mutate the input state", () => {
    const s = preflop();
    applyAction(s, { type: "fold", playerId: "alice" });
    expect(s.isHandOver).toBe(false);
    expect(s.players[0].folded).toBe(false);
  });
});

// ── CHECK ─────────────────────────────────────────────────────────────────────

describe("applyAction — check", () => {
  it("SB is marked hasActed=true after calling (before round ends)", () => {
    const s0 = preflop();
    const s1 = applyAction(s0, { type: "call", playerId: "alice" });
    // Round is not yet complete (bob hasn't acted), so no street advance
    expect(s1.players[0].hasActed).toBe(true);
    expect(s1.street).toBe("preflop");
  });

  it("two checks on the flop advance to the turn", () => {
    // Reach the flop via SB call + BB check
    const s0 = preflop();
    const s1 = applyAction(s0, { type: "call", playerId: "alice" });
    const flop = applyAction(s1, { type: "check", playerId: "bob" });
    expect(flop.street).toBe("flop");

    // BB checks first on flop (postflop BB acts first at idx 1)
    const s3 = applyAction(flop, { type: "check", playerId: "bob" });
    const turn = applyAction(s3, { type: "check", playerId: "alice" });
    expect(turn.street).toBe("turn");
  });

  it("rejects check when there is a bet to call", () => {
    expect(() =>
      applyAction(preflop(), { type: "check", playerId: "alice" })
    ).toThrow();
  });
});

// ── CALL ──────────────────────────────────────────────────────────────────────

describe("applyAction — call", () => {
  it("deducts the correct amount from SB stack", () => {
    const s = applyAction(preflop(), { type: "call", playerId: "alice" });
    expect(s.players[0].stack).toBe(900); // 950 - 50
  });

  it("adds the call amount to the pot", () => {
    const s = applyAction(preflop(), { type: "call", playerId: "alice" });
    expect(s.pot).toBe(200); // 150 + 50
  });

  it("sets betThisStreet equal to the big blind", () => {
    const s = applyAction(preflop(), { type: "call", playerId: "alice" });
    expect(s.players[0].betThisStreet).toBe(100);
  });

  it("passes action to the opponent", () => {
    const s = applyAction(preflop(), { type: "call", playerId: "alice" });
    expect(s.activePlayerIndex).toBe(1);
  });

  it("sets isAllIn when calling with exact stack", () => {
    // SB has exactly 50 left to call (toCall=50, stack=50)
    const s0 = preflop();
    const thinSB: GameState = {
      ...s0,
      players: [{ ...s0.players[0], stack: 50 }, s0.players[1]],
    };
    const s1 = applyAction(thinSB, { type: "call", playerId: "alice" });
    expect(s1.players[0].isAllIn).toBe(true);
    expect(s1.players[0].stack).toBe(0);
  });

  it("rejects call when nothing to call", () => {
    const s0 = preflop();
    const s1 = applyAction(s0, { type: "call", playerId: "alice" });
    // bets equalized; BB's turn — must check not call
    expect(() =>
      applyAction(s1, { type: "call", playerId: "bob" })
    ).toThrow();
  });
});

// ── RAISE_TO ──────────────────────────────────────────────────────────────────

describe("applyAction — raise_to", () => {
  it("sets betThisStreet to the raised total", () => {
    const s = applyAction(preflop(), { type: "raise_to", playerId: "alice", amount: 300 });
    expect(s.players[0].betThisStreet).toBe(300);
  });

  it("deducts only the additional chips from stack", () => {
    // alice had stack=950, bet=50; raises to 300 → pays 250 more
    const s = applyAction(preflop(), { type: "raise_to", playerId: "alice", amount: 300 });
    expect(s.players[0].stack).toBe(700);
  });

  it("adds only the additional chips to the pot", () => {
    const s = applyAction(preflop(), { type: "raise_to", playerId: "alice", amount: 300 });
    expect(s.pot).toBe(400); // 150 + 250
  });

  it("resets the opponent's hasActed so they must re-act", () => {
    const s = applyAction(preflop(), { type: "raise_to", playerId: "alice", amount: 300 });
    expect(s.players[1].hasActed).toBe(false);
    expect(s.activePlayerIndex).toBe(1);
  });

  it("sets isAllIn on an all-in raise", () => {
    // alice max = 950 + 50 = 1000
    const s = applyAction(preflop(), { type: "raise_to", playerId: "alice", amount: 1000 });
    expect(s.players[0].isAllIn).toBe(true);
    expect(s.players[0].stack).toBe(0);
  });

  it("rejects raise_to at or below the current bet", () => {
    expect(() =>
      applyAction(preflop(), { type: "raise_to", playerId: "alice", amount: 100 })
    ).toThrow();
  });

  it("rejects raise_to exceeding stack+committed", () => {
    expect(() =>
      applyAction(preflop(), { type: "raise_to", playerId: "alice", amount: 1001 })
    ).toThrow();
  });
});

// ── ALL_IN ────────────────────────────────────────────────────────────────────

describe("applyAction — all_in", () => {
  it("sets stack to 0 and isAllIn to true", () => {
    const s = applyAction(preflop(), { type: "all_in", playerId: "alice" });
    expect(s.players[0].stack).toBe(0);
    expect(s.players[0].isAllIn).toBe(true);
  });

  it("adds entire remaining stack to the pot", () => {
    const s = applyAction(preflop(), { type: "all_in", playerId: "alice" });
    // alice had stack=950; pot was 150 → 1100
    expect(s.pot).toBe(1100);
    expect(s.players[0].betThisStreet).toBe(1000);
  });

  it("resets opponent hasActed when all-in is a raise", () => {
    // alice all-in (1000) > bob's 100 → bob must re-act
    const s = applyAction(preflop(), { type: "all_in", playerId: "alice" });
    expect(s.players[1].hasActed).toBe(false);
  });

  it("does not re-open action when all-in total equals opponent's bet", () => {
    // alice.stack=50, betThisStreet=50 (blind); all-in → betThisStreet=100.
    // 100 == bob's 100 → not a raise, so bob.hasActed stays false.
    // Round is NOT complete (bob hasn't voluntarily acted).
    const s0 = preflop();
    const shortSB: GameState = {
      ...s0,
      players: [{ ...s0.players[0], stack: 50 }, s0.players[1]],
    };
    const s1 = applyAction(shortSB, { type: "all_in", playerId: "alice" });
    expect(s1.players[0].isAllIn).toBe(true);
    expect(s1.players[1].hasActed).toBe(false); // bob still needs to act
    expect(s1.activePlayerIndex).toBe(1);
    expect(s1.street).toBe("preflop"); // round not over yet
  });
});

// ── STREET ADVANCEMENT ────────────────────────────────────────────────────────

describe("applyAction — street advancement", () => {
  // Helper: advance through preflop to the flop
  function reachFlop(): GameState {
    const s0 = preflop();
    const s1 = applyAction(s0, { type: "call", playerId: "alice" });
    return applyAction(s1, { type: "check", playerId: "bob" });
  }

  it("preflop → flop: street advances after SB call + BB check", () => {
    expect(reachFlop().street).toBe("flop");
  });

  it("flop has exactly 3 board cards", () => {
    expect(reachFlop().board).toHaveLength(3);
  });

  it("flop resets betThisStreet to 0 for both players", () => {
    const flop = reachFlop();
    expect(flop.players[0].betThisStreet).toBe(0);
    expect(flop.players[1].betThisStreet).toBe(0);
  });

  it("flop resets hasActed to false for both players", () => {
    const flop = reachFlop();
    expect(flop.players[0].hasActed).toBe(false);
    expect(flop.players[1].hasActed).toBe(false);
  });

  it("BB (index 1) acts first on the flop", () => {
    expect(reachFlop().activePlayerIndex).toBe(1);
  });

  it("flop → turn adds 1 board card (total 4)", () => {
    const flop = reachFlop();
    const s1 = applyAction(flop, { type: "check", playerId: "bob" });
    const turn = applyAction(s1, { type: "check", playerId: "alice" });
    expect(turn.street).toBe("turn");
    expect(turn.board).toHaveLength(4);
  });

  it("turn → river adds 1 board card (total 5)", () => {
    const flop = reachFlop();
    const t1 = applyAction(flop, { type: "check", playerId: "bob" });
    const turn = applyAction(t1, { type: "check", playerId: "alice" });
    const r1 = applyAction(turn, { type: "check", playerId: "bob" });
    const river = applyAction(r1, { type: "check", playerId: "alice" });
    expect(river.street).toBe("river");
    expect(river.board).toHaveLength(5);
  });

  it("river → showdown after two checks", () => {
    const flop = reachFlop();
    const check = (s: GameState, id: string) =>
      applyAction(s, { type: "check", playerId: id });
    const t1 = check(flop, "bob");
    const turn = check(t1, "alice");
    const r1 = check(turn, "bob");
    const river = check(r1, "alice");
    const sd1 = check(river, "bob");
    const showdown = check(sd1, "alice");
    expect(showdown.street).toBe("showdown");
    expect(showdown.board).toHaveLength(5);
  });

  it("pot carries across streets untouched when no bets placed", () => {
    const flop = reachFlop(); // pot = 200
    const t1 = applyAction(flop, { type: "check", playerId: "bob" });
    const turn = applyAction(t1, { type: "check", playerId: "alice" });
    expect(turn.pot).toBe(200);
  });
});

// ── ALL-IN → SHOWDOWN ─────────────────────────────────────────────────────────

describe("applyAction — all-in skips to showdown", () => {
  it("preflop all-in called → showdown with 5 board cards", () => {
    const s0 = preflop();
    const s1 = applyAction(s0, { type: "all_in", playerId: "alice" }); // alice shoves
    const s2 = applyAction(s1, { type: "call", playerId: "bob" });    // bob calls
    expect(s2.street).toBe("showdown");
    expect(s2.board).toHaveLength(5);
  });

  it("hand is not yet over at showdown (awaits evaluation)", () => {
    const s0 = preflop();
    const s1 = applyAction(s0, { type: "all_in", playerId: "alice" });
    const s2 = applyAction(s1, { type: "call", playerId: "bob" });
    expect(s2.isHandOver).toBe(false);
    expect(s2.winnerId).toBeNull();
  });

  it("flop all-in called → showdown with 5 board cards (2 added)", () => {
    const s0 = preflop();
    const s1 = applyAction(s0, { type: "call", playerId: "alice" });
    const flop = applyAction(s1, { type: "check", playerId: "bob" });
    expect(flop.board).toHaveLength(3);

    const s3 = applyAction(flop, { type: "all_in", playerId: "bob" });
    const s4 = applyAction(s3, { type: "call", playerId: "alice" });
    expect(s4.street).toBe("showdown");
    expect(s4.board).toHaveLength(5);
  });

  it("showdown deck is consistent: 5 board + 4 hole + remaining = 52", () => {
    const s0 = preflop();
    const s1 = applyAction(s0, { type: "all_in", playerId: "alice" });
    const s2 = applyAction(s1, { type: "call", playerId: "bob" });
    const dealtCards =
      s2.board.length +
      s2.players[0].holeCards!.length +
      s2.players[1].holeCards!.length +
      s2.deck.length;
    expect(dealtCards).toBe(52);
  });
});
