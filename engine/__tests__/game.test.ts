import { describe, it, expect } from "vitest";
import { createGame, act, nextHand, isMatchOver, matchWinner } from "../game";
import type { GameConfig, GameState } from "../types";

// ── Config ────────────────────────────────────────────────────────────────────

const CFG: GameConfig = { smallBlind: 50, bigBlind: 100, startingStack: 1000 };
const SEED = 42;

// ── createGame ────────────────────────────────────────────────────────────────

describe("createGame", () => {
  const s = createGame(CFG, ["alice", "bob"], SEED);

  it("starts at hand 1", () => expect(s.handNumber).toBe(1));
  it("street is preflop",  () => expect(s.street).toBe("preflop"));
  it("is not hand over",   () => expect(s.isHandOver).toBe(false));

  it("playerIds[0] is SB at index 0", () => {
    expect(s.players[0].id).toBe("alice");
    expect(s.players[0].position).toBe("SB");
  });

  it("playerIds[1] is BB at index 1", () => {
    expect(s.players[1].id).toBe("bob");
    expect(s.players[1].position).toBe("BB");
  });

  it("posts blinds and builds pot", () => {
    expect(s.players[0].stack).toBe(950); // 1000 - SB 50
    expect(s.players[1].stack).toBe(900); // 1000 - BB 100
    expect(s.pot).toBe(150);
  });

  it("deals 2 hole cards to each player", () => {
    expect(s.players[0].holeCards).toHaveLength(2);
    expect(s.players[1].holeCards).toHaveLength(2);
  });

  it("48 cards remain in deck", () => expect(s.deck).toHaveLength(48));

  it("total chips equal 2 × startingStack", () => {
    expect(s.players[0].stack + s.players[1].stack + s.pot).toBe(2000);
  });
});

// ── act — fold ────────────────────────────────────────────────────────────────

describe("act — fold", () => {
  it("SB fold: hand is over and bob is winner", () => {
    const s = act(createGame(CFG, ["alice", "bob"], SEED),
                  { type: "fold", playerId: "alice" });
    expect(s.isHandOver).toBe(true);
    expect(s.winnerId).toBe("bob");
  });

  it("SB fold: bob's stack grows by pot amount", () => {
    const s0 = createGame(CFG, ["alice", "bob"], SEED);   // pot=150, bob.stack=900
    const s1 = act(s0, { type: "fold", playerId: "alice" });
    expect(s1.players[1].stack).toBe(1050);               // 900 + 150
  });

  it("SB fold: alice keeps her remaining stack", () => {
    const s1 = act(createGame(CFG, ["alice", "bob"], SEED),
                   { type: "fold", playerId: "alice" });
    expect(s1.players[0].stack).toBe(950);
  });

  it("BB fold after SB calls: alice wins", () => {
    const s0 = createGame(CFG, ["alice", "bob"], SEED);
    const s1 = act(s0, { type: "call", playerId: "alice" });
    const s2 = act(s1, { type: "fold", playerId: "bob" });
    expect(s2.winnerId).toBe("alice");
  });

  it("chips are conserved after fold (no chips created or destroyed)", () => {
    const s1 = act(createGame(CFG, ["alice", "bob"], SEED),
                   { type: "fold", playerId: "alice" });
    expect(s1.players[0].stack + s1.players[1].stack).toBe(2000);
  });
});

// ── act — showdown auto-settlement ───────────────────────────────────────────

describe("act — showdown auto-settlement", () => {
  function allInShowdown(): GameState {
    const s0 = createGame(CFG, ["alice", "bob"], SEED);
    const s1 = act(s0, { type: "all_in", playerId: "alice" });
    return act(s1, { type: "call", playerId: "bob" });
  }

  it("hand is over immediately after the call (auto-settled)", () => {
    expect(allInShowdown().isHandOver).toBe(true);
  });

  it("street is showdown", () => {
    expect(allInShowdown().street).toBe("showdown");
  });

  it("board has 5 cards", () => {
    expect(allInShowdown().board).toHaveLength(5);
  });

  it("winnerId is a valid player id or null (tie)", () => {
    const end = allInShowdown();
    expect(["alice", "bob", null]).toContain(end.winnerId);
  });

  it("chips are conserved after showdown", () => {
    const end = allInShowdown();
    expect(end.players[0].stack + end.players[1].stack).toBe(2000);
  });

  it("non-tie: winner holds all chips, loser holds 0", () => {
    const end = allInShowdown();
    if (end.winnerId !== null) {
      const winner = end.players.find(p => p.id === end.winnerId)!;
      const loser  = end.players.find(p => p.id !== end.winnerId)!;
      expect(winner.stack).toBe(2000);
      expect(loser.stack).toBe(0);
    }
  });
});

// ── act — full betting hand (call + check to showdown) ───────────────────────

describe("act — full hand without all-in", () => {
  function playToShowdown(): GameState {
    let s = createGame(CFG, ["alice", "bob"], SEED);
    const go = (type: "call" | "check", id: string) =>
      (s = act(s, { type, playerId: id }));

    go("call",  "alice"); // preflop: SB calls
    go("check", "bob");   // BB checks option → flop
    go("check", "bob");   // flop: BB first
    go("check", "alice"); // → turn
    go("check", "bob");   // turn: BB first
    go("check", "alice"); // → river
    go("check", "bob");   // river: BB first
    go("check", "alice"); // → showdown (auto-settled)
    return s;
  }

  it("reaches showdown", () => expect(playToShowdown().street).toBe("showdown"));
  it("hand is over",     () => expect(playToShowdown().isHandOver).toBe(true));

  it("chips conserved across all streets", () => {
    const end = playToShowdown();
    expect(end.players[0].stack + end.players[1].stack).toBe(2000);
  });
});

// ── act — all-in on blind post ────────────────────────────────────────────────

describe("act — all-in on blind post", () => {
  it("BB all-in on blind: SB call resolves immediately to showdown", () => {
    // BB = startingStack so BB goes all-in just posting the blind.
    const cfg: GameConfig = { smallBlind: 50, bigBlind: 1000, startingStack: 1000 };
    const s0 = createGame(cfg, ["alice", "bob"], SEED);
    // bob (BB) is now all-in (stack=0, isAllIn=true, hasActed=false).
    // alice (SB) still needs to act.
    expect(s0.players[1].isAllIn).toBe(true);
    expect(s0.players[1].stack).toBe(0);

    // alice calls → round complete (bob was all-in, alice now acted) → showdown
    const s1 = act(s0, { type: "call", playerId: "alice" });
    expect(s1.isHandOver).toBe(true);
    expect(s1.street).toBe("showdown");
    expect(s1.players[0].stack + s1.players[1].stack).toBe(2000);
  });

  it("SB all-in on blind: BB can still call or fold", () => {
    const cfg: GameConfig = { smallBlind: 1000, bigBlind: 100, startingStack: 1000 };
    // SB posts 1000 (full stack, all-in). BB posts 100 (has 900 left).
    const s0 = createGame(cfg, ["alice", "bob"], SEED);
    expect(s0.players[0].isAllIn).toBe(true);  // alice SB all-in

    // BB (bob) can call — toCall = 1000 - 100 = 900
    const s1 = act(s0, { type: "call", playerId: "bob" });
    expect(s1.isHandOver).toBe(true);
    expect(s1.players[0].stack + s1.players[1].stack).toBe(2000);
  });
});

// ── nextHand ──────────────────────────────────────────────────────────────────

describe("nextHand", () => {
  function finishedHand1(): GameState {
    return act(createGame(CFG, ["alice", "bob"], SEED),
               { type: "fold", playerId: "alice" });
  }
  // hand 1 result: alice=950, bob=1050

  it("throws if the current hand is not over", () => {
    expect(() => nextHand(createGame(CFG, ["alice", "bob"], SEED), SEED))
      .toThrow(/not over/i);
  });

  it("increments handNumber to 2", () => {
    expect(nextHand(finishedHand1(), SEED + 1).handNumber).toBe(2);
  });

  it("swaps positions: bob becomes SB, alice becomes BB", () => {
    const h2 = nextHand(finishedHand1(), SEED + 1);
    expect(h2.players[0].id).toBe("bob");
    expect(h2.players[0].position).toBe("SB");
    expect(h2.players[1].id).toBe("alice");
    expect(h2.players[1].position).toBe("BB");
  });

  it("carries stacks from the previous hand", () => {
    // hand 1 end: alice=950, bob=1050
    // hand 2: bob (SB) posts 50 → 1000; alice (BB) posts 100 → 850
    const h2 = nextHand(finishedHand1(), SEED + 1);
    expect(h2.players[0].stack).toBe(1000); // bob SB: 1050 - 50
    expect(h2.players[1].stack).toBe(850);  // alice BB: 950 - 100
  });

  it("deals fresh hole cards", () => {
    const h2 = nextHand(finishedHand1(), SEED + 1);
    expect(h2.players[0].holeCards).not.toBeNull();
    expect(h2.players[1].holeCards).not.toBeNull();
  });

  it("resets isHandOver to false", () => {
    expect(nextHand(finishedHand1(), SEED + 1).isHandOver).toBe(false);
  });

  it("resets winnerId to null", () => {
    expect(nextHand(finishedHand1(), SEED + 1).winnerId).toBeNull();
  });

  it("total chips are conserved into the next hand", () => {
    const h2 = nextHand(finishedHand1(), SEED + 1);
    expect(h2.players[0].stack + h2.players[1].stack + h2.pot).toBe(2000);
  });
});

// ── isMatchOver / matchWinner ─────────────────────────────────────────────────

describe("isMatchOver / matchWinner", () => {
  it("false during an in-progress hand", () => {
    const s = createGame(CFG, ["alice", "bob"], SEED);
    expect(isMatchOver(s)).toBe(false);
    expect(matchWinner(s)).toBeNull();
  });

  it("false after a hand ends but both players still have chips", () => {
    const s = act(createGame(CFG, ["alice", "bob"], SEED),
                  { type: "fold", playerId: "alice" });
    expect(isMatchOver(s)).toBe(false);
  });

  it("true when a player is bust", () => {
    const s = createGame(CFG, ["alice", "bob"], SEED);
    const bust: GameState = {
      ...s, isHandOver: true, winnerId: "bob",
      players: [
        { ...s.players[0], stack: 0    },
        { ...s.players[1], stack: 2000 },
      ],
    };
    expect(isMatchOver(bust)).toBe(true);
    expect(matchWinner(bust)).toBe("bob");
  });

  it("matchWinner returns the player with a positive stack", () => {
    const s = createGame(CFG, ["alice", "bob"], SEED);
    const bobWins: GameState = {
      ...s, isHandOver: true, winnerId: "bob",
      players: [
        { ...s.players[0], stack: 0    },
        { ...s.players[1], stack: 2000 },
      ],
    };
    expect(matchWinner(bobWins)).toBe("bob");
  });

  it("matchWinner returns null when game is still running", () => {
    expect(matchWinner(createGame(CFG, ["alice", "bob"], SEED))).toBeNull();
  });
});

// ── multi-hand sequence ───────────────────────────────────────────────────────

describe("multi-hand sequence", () => {
  it("handNumber increments over 4 hands", () => {
    let s = createGame(CFG, ["alice", "bob"], 1);
    for (let h = 1; h <= 4; h++) {
      expect(s.handNumber).toBe(h);
      s = act(s, { type: "fold", playerId: s.players[0].id });
      if (h < 4) s = nextHand(s, h + 10);
    }
  });

  it("SB alternates every hand: alice → bob → alice → bob", () => {
    const sbIds: string[] = [];
    let s = createGame(CFG, ["alice", "bob"], 1);
    for (let h = 0; h < 4; h++) {
      sbIds.push(s.players[0].id);
      s = act(s, { type: "fold", playerId: s.players[0].id });
      if (h < 3) s = nextHand(s, h + 10);
    }
    expect(sbIds).toEqual(["alice", "bob", "alice", "bob"]);
  });

  it("chips are conserved across 4 consecutive hands", () => {
    let s = createGame(CFG, ["alice", "bob"], 1);
    for (let h = 0; h < 4; h++) {
      s = act(s, { type: "fold", playerId: s.players[0].id });
      expect(s.players[0].stack + s.players[1].stack).toBe(2000);
      if (h < 3) s = nextHand(s, h + 10);
    }
  });

  it("can play a full hand (call + checks) then continue to the next hand", () => {
    let s = createGame(CFG, ["alice", "bob"], SEED);
    const go = (type: "call" | "check", id: string) =>
      (s = act(s, { type, playerId: id }));

    go("call",  "alice"); go("check", "bob");   // → flop
    go("check", "bob");   go("check", "alice"); // → turn
    go("check", "bob");   go("check", "alice"); // → river
    go("check", "bob");   go("check", "alice"); // → showdown

    expect(s.isHandOver).toBe(true);
    s = nextHand(s, SEED + 1);
    expect(s.handNumber).toBe(2);
    expect(s.isHandOver).toBe(false);
  });
});

// ── scripted match to elimination ─────────────────────────────────────────────

describe("scripted match to elimination", () => {
  it("all-in showdown: winner takes all or chips are split on tie", () => {
    const s = createGame(CFG, ["alice", "bob"], SEED);
    const s1 = act(s,  { type: "all_in", playerId: "alice" });
    const s2 = act(s1, { type: "call",   playerId: "bob"   });

    expect(s2.isHandOver).toBe(true);
    expect(s2.players[0].stack + s2.players[1].stack).toBe(2000);

    if (s2.winnerId !== null) {
      // One player eliminated
      expect(isMatchOver(s2)).toBe(true);
      expect(matchWinner(s2)).toBe(s2.winnerId);
      const winner = s2.players.find(p => p.id === s2.winnerId)!;
      const loser  = s2.players.find(p => p.id !== s2.winnerId)!;
      expect(winner.stack).toBe(2000);
      expect(loser.stack).toBe(0);
    } else {
      // Exact tie — match continues
      expect(isMatchOver(s2)).toBe(false);
      expect(matchWinner(s2)).toBeNull();
    }
  });

  it("repeated all-in until match ends (chip conservation throughout)", () => {
    // Use a seed sequence so hands are deterministic.
    // Play until one player is eliminated (or safety limit).
    let s = createGame(CFG, ["alice", "bob"], 1);
    let hands = 0;
    const MAX = 50;

    while (!isMatchOver(s) && hands < MAX) {
      const sbId = s.players[0].id;
      const bbId = s.players[1].id;

      // Always shove preflop
      s = act(s, { type: "all_in", playerId: sbId });
      if (!s.isHandOver) {
        s = act(s, { type: "call", playerId: bbId });
      }

      expect(s.players[0].stack + s.players[1].stack).toBe(2000); // always

      if (!isMatchOver(s)) {
        s = nextHand(s, hands + 100);
      }
      hands++;
    }

    // Within 50 all-in hands the match should resolve (astronomically unlikely to tie every hand)
    if (isMatchOver(s)) {
      expect(matchWinner(s)).not.toBeNull();
      const winner = s.players.find(p => p.stack > 0)!;
      expect(matchWinner(s)).toBe(winner.id);
    }
    // Chip conservation verified in the loop above
  });
});
