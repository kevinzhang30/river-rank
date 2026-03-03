import type { PublicGameState, PublicPlayer, LogEntry, Mode } from "./types";

// ── Raw shape emitted by the current backend (state.update) ──────────────────

export interface BackendPlayer {
  userId: string;
  username: string;
}

export interface BackendLogEntry {
  userId: string;
  action: string;
  turn: number;
  at: string;
}

export interface BackendGameState {
  matchId: string;
  players: BackendPlayer[];
  createdAt: string;
  turn: number;
  log: BackendLogEntry[];
}

// ── Type guard ────────────────────────────────────────────────────────────────

export function isBackendGameState(v: unknown): v is BackendGameState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.matchId === "string" &&
    Array.isArray(s.players) &&
    typeof s.turn === "number"
  );
}

// ── Adapter ───────────────────────────────────────────────────────────────────
//
// Best-effort conversion from BackendGameState → PublicGameState.
// Fields unknown to the backend (street, pot, board, stack, bet, isDealer,
// isToAct, folded) are filled with neutral defaults. This adapter is superseded
// once the backend emits game.state with a full PublicGameState directly.

export function adaptBackendState(
  raw: BackendGameState,
  heroUserId: string | null,
  mode: Mode = "ranked"
): PublicGameState | null {
  if (!raw?.players || raw.players.length < 2) return null;

  const byId = Object.fromEntries(raw.players.map((p) => [p.userId, p.username]));

  const players = raw.players.slice(0, 2).map(
    (p, i): PublicPlayer => ({
      userId: p.userId,
      username: p.username,
      stack: 1000,                         // unknown — placeholder
      bet: 0,                              // unknown — placeholder
      isDealer: i === 0,
      isToAct: p.userId === heroUserId,
      folded: false,
    })
  );

  const log: LogEntry[] = raw.log.map((e) => ({
    username: byId[e.userId] ?? e.userId,
    action: e.action.toLowerCase(),
    at: e.at,
  }));

  return {
    matchId: raw.matchId,
    mode,
    street: "preflop",
    pot: 0,
    board: [],
    players: players as [PublicPlayer, PublicPlayer],
    log,
    handNumber: 1,
    smallBlind: 10,
    bigBlind: 20,
  };
}
