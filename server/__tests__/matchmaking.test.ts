import { describe, it, expect, beforeEach } from "vitest";
import { MatchmakingQueue } from "../matchmaking";
import type { Player } from "../matchmaking";

// ── helpers ───────────────────────────────────────────────────────────────────

function p(id: string, rating: number): Player {
  return { id, rating };
}

// ── size / has / dequeue ──────────────────────────────────────────────────────

describe("MatchmakingQueue — size, has, dequeue", () => {
  let q: MatchmakingQueue;
  beforeEach(() => { q = new MatchmakingQueue(); });

  it("starts empty", () => {
    expect(q.size).toBe(0);
  });

  it("size increases as players join", () => {
    q.enqueue(p("alice", 1000));
    expect(q.size).toBe(1);
  });

  it("has() returns true while player is waiting", () => {
    q.enqueue(p("alice", 1000));
    expect(q.has("alice")).toBe(true);
  });

  it("has() returns false for unknown player", () => {
    expect(q.has("ghost")).toBe(false);
  });

  it("dequeue removes a waiting player and returns true", () => {
    q.enqueue(p("alice", 1000));
    expect(q.dequeue("alice")).toBe(true);
    expect(q.size).toBe(0);
    expect(q.has("alice")).toBe(false);
  });

  it("dequeue returns false for a player not in queue", () => {
    expect(q.dequeue("nobody")).toBe(false);
  });

  it("dequeue is idempotent: second call returns false", () => {
    q.enqueue(p("alice", 1000));
    q.dequeue("alice");
    expect(q.dequeue("alice")).toBe(false);
  });
});

// ── enqueue — null while waiting ──────────────────────────────────────────────

describe("MatchmakingQueue — enqueue returns null while fewer than 2 players", () => {
  it("first enqueue returns null", () => {
    const q = new MatchmakingQueue();
    expect(q.enqueue(p("alice", 1000))).toBeNull();
  });
});

// ── enqueue — duplicate guard ─────────────────────────────────────────────────

describe("MatchmakingQueue — duplicate guard", () => {
  it("throws if the same player enqueues twice", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    expect(() => q.enqueue(p("alice", 1000))).toThrow(/alice/);
  });

  it("does not throw after the player has been dequeued", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    q.dequeue("alice");
    expect(() => q.enqueue(p("alice", 1000))).not.toThrow();
  });
});

// ── enqueue — match creation ──────────────────────────────────────────────────

describe("MatchmakingQueue — match creation on second enqueue", () => {
  it("second enqueue returns a Match, not null", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    const match = q.enqueue(p("bob", 1000));
    expect(match).not.toBeNull();
  });

  it("match contains both players", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    const match = q.enqueue(p("bob", 1100))!;
    const ids = [match.player1.id, match.player2.id];
    expect(ids).toContain("alice");
    expect(ids).toContain("bob");
  });

  it("player1 is lower-rated, player2 is higher-rated", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 900));
    const match = q.enqueue(p("bob", 1200))!;
    expect(match.player1.rating).toBeLessThanOrEqual(match.player2.rating);
    expect(match.player1.id).toBe("alice");
    expect(match.player2.id).toBe("bob");
  });

  it("queue is empty after a match is formed", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    q.enqueue(p("bob", 1000));
    expect(q.size).toBe(0);
  });

  it("matched players are no longer in the queue", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    q.enqueue(p("bob", 1000));
    expect(q.has("alice")).toBe(false);
    expect(q.has("bob")).toBe(false);
  });
});

// ── matchId ───────────────────────────────────────────────────────────────────

describe("MatchmakingQueue — matchId", () => {
  it("matchId is a non-empty string", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    const match = q.enqueue(p("bob", 1000))!;
    expect(typeof match.matchId).toBe("string");
    expect(match.matchId.length).toBeGreaterThan(0);
  });

  it("successive matches get distinct matchIds", () => {
    const q = new MatchmakingQueue();

    q.enqueue(p("a", 1000));
    const m1 = q.enqueue(p("b", 1000))!;

    q.enqueue(p("c", 1000));
    const m2 = q.enqueue(p("d", 1000))!;

    expect(m1.matchId).not.toBe(m2.matchId);
  });
});

// ── pairing order ─────────────────────────────────────────────────────────────

describe("MatchmakingQueue — pairing order", () => {
  it("2 players with a large rating gap still pair immediately", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    const match = q.enqueue(p("bob", 1500))!;
    const ids = [match.player1.id, match.player2.id];
    expect(ids).toContain("alice");
    expect(ids).toContain("bob");
  });

  it("3rd player waits alone after first pair is formed", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    q.enqueue(p("bob",   1500)); // alice+bob pair immediately
    q.enqueue(p("carol", 1050)); // carol waits alone
    expect(q.size).toBe(1);
    expect(q.has("carol")).toBe(true);
    expect(q.has("alice")).toBe(false);
    expect(q.has("bob")).toBe(false);
  });

  it("4th player pairs with the waiting 3rd player", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    q.enqueue(p("bob",   1500)); // alice+bob paired, queue empty
    q.enqueue(p("carol", 1050)); // carol waits
    const match = q.enqueue(p("dave", 1100))!; // carol+dave
    const ids = [match.player1.id, match.player2.id];
    expect(ids).toContain("carol");
    expect(ids).toContain("dave");
    expect(q.size).toBe(0);
  });

  it("when all diffs equal, matches the earliest pair (FIFO tiebreak)", () => {
    // Three players all at 1000 — every pair has diff 0.
    // FIFO → pair indices (0,1): alice & bob; carol waits.
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    q.enqueue(p("bob",   1000));
    q.enqueue(p("carol", 1000));
    expect(q.has("carol")).toBe(true);
    expect(q.has("alice")).toBe(false);
    expect(q.has("bob")).toBe(false);
  });

  it("4 sequential players produce 2 independent matches", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("a", 1000));
    const m1 = q.enqueue(p("b", 1005))!; // a+b paired
    q.enqueue(p("c", 1100));
    const m2 = q.enqueue(p("d", 1105))!; // c+d paired
    const m1ids = [m1.player1.id, m1.player2.id];
    const m2ids = [m2.player1.id, m2.player2.id];
    expect(m1ids).toContain("a");
    expect(m1ids).toContain("b");
    expect(m2ids).toContain("c");
    expect(m2ids).toContain("d");
    expect(q.size).toBe(0);
  });
});

// ── consecutive matches ───────────────────────────────────────────────────────

describe("MatchmakingQueue — consecutive matches", () => {
  it("queue can handle many sequential matches", () => {
    const q = new MatchmakingQueue();
    const matches: string[] = [];

    for (let i = 0; i < 10; i++) {
      q.enqueue(p(`p${2 * i}`,     1000 + i * 10));
      const m = q.enqueue(p(`p${2 * i + 1}`, 1000 + i * 10 + 5))!;
      matches.push(m.matchId);
    }

    expect(matches.length).toBe(10);
    // All matchIds distinct
    expect(new Set(matches).size).toBe(10);
    expect(q.size).toBe(0);
  });

  it("queue accepts new players after a match is formed", () => {
    const q = new MatchmakingQueue();
    q.enqueue(p("alice", 1000));
    q.enqueue(p("bob",   1000)); // match formed, queue now empty
    expect(q.size).toBe(0);

    q.enqueue(p("carol", 1000));
    expect(q.size).toBe(1);
    expect(q.has("carol")).toBe(true);
  });
});
