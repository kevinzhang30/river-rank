import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";

import { DEFAULT_CONFIG, BULLET_CONFIG } from "./engine/types";
import type {
  InternalGameState,
  PlayerState,
  GameStreet,
  LegalActions,
  HandResult,
  Mode,
} from "./engine/types";
import { newDeck, shuffle } from "./engine/deck";
import { getLegalActions, validateAction, ActionError } from "./engine/betting";
import { showdownWinner, bestHand } from "./engine/handEvaluator";
import { decideBotAction } from "./bot/strategy";
import type { BotGameContext } from "./bot/strategy";

// Legacy type — kept for backwards compatibility during transition
type BotDifficulty = "easy" | "medium" | "hard";
import {
  isBot, getBotProfile, findBotByElo, updateBotElo,
  markBotUsed, recordBotOpponent, loadBotRegistry,
} from "./bot/registry";
import { prisma } from "./db";
import { supabaseAdmin } from "./db/supabaseAdmin";
import {
  loadEmotes, isValidEmoteId, fetchOwnedEmotes, fetchEquippedEmotes,
} from "./emotes";

// ── User type ─────────────────────────────────────────────────────────────────

interface User {
  userId:   string;
  username: string;
  socketId: string;
  elo:      number;
  country:  string | null;
}

// ── Bot constants ─────────────────────────────────────────────────────────────

// Legacy fallback (kept as safety net — remove after bot ladder stabilizes)
const BOT_ID               = "00000000-0000-0000-0000-000000000000";
const BOT_QUEUE_TIMEOUT_MS = 20_000;

// Organic bot timing: random delay before a bot "joins the queue"
const BOT_JOIN_MIN_MS = 4_000;
const BOT_JOIN_MAX_MS = 12_000;

// ── Turn timer ────────────────────────────────────────────────────────────────

const TURN_DURATION_MS         = 15_000;
const BULLET_TURN_DURATION_MS  = 10_000;
const NEXT_HAND_DELAY_MS       = 7_000;
const BULLET_NEXT_HAND_DELAY_MS = 4_000;
const RUNOUT_STREET_DELAY_MS   = 1_000;

// ── In-memory store ───────────────────────────────────────────────────────────

const users         = new Map<string, User>();
const userSockets   = new Map<string, string>(); // userId → socketId
const queuedPlayers = new Set<string>();          // userId set for queue atomicity

// ── Presence tracking (multi-tab safe) ──────────────────────────────────────
const presenceMap  = new Map<string, Set<string>>(); // userId → Set<socketId>
const socketToUser = new Map<string, string>();       // socketId → userId

function markUserOnline(userId: string, socketId: string) {
  let sockets = presenceMap.get(userId);
  if (!sockets) { sockets = new Set(); presenceMap.set(userId, sockets); }
  sockets.add(socketId);
  socketToUser.set(socketId, userId);
}

function markUserOffline(socketId: string) {
  const userId = socketToUser.get(socketId);
  if (!userId) return;
  socketToUser.delete(socketId);
  const sockets = presenceMap.get(userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) presenceMap.delete(userId);
  }
}

function isUserOnline(userId: string): boolean {
  return (presenceMap.get(userId)?.size ?? 0) > 0;
}
const queues: Record<Mode, User[]> = { ranked: [], unranked: [], bullet: [] };
const matches       = new Map<string, InternalGameState>();
const activeMatches = new Map<string, string>(); // userId → matchId
let matchCounter    = 0;

// bot state
const botDifficulties = new Map<string, BotDifficulty>(); // matchId → difficulty
const botTimers       = new Map<string, ReturnType<typeof setTimeout>>(); // matchId → timer
const queueTimers     = new Map<string, ReturnType<typeof setTimeout>>(); // userId → timer

// emotes
const emoteCooldowns = new Map<string, number>(); // "matchId:userId" → last emote timestamp
const EMOTE_COOLDOWN_MS = 7_000;

// challenges
interface PendingChallenge {
  id: string;
  fromUser: User;
  toUserId: string;
  mode: Mode;
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
}
const pendingChallenges = new Map<string, PendingChallenge>(); // challengeId → challenge

// tournaments
interface TournamentState {
  id: string;
  hostId: string;
  joinCode: string;
  size: 4 | 8;
  status: 'lobby' | 'in_progress' | 'completed';
  participants: Map<string, { userId: string; username: string; elo: number }>;
  winnerId?: string;
  matchTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Tracks which players have clicked ready for their current match. matchId → Set<userId> */
  matchReadyPlayers: Map<string, Set<string>>;
}
const tournaments      = new Map<string, TournamentState>();
const playerTournament = new Map<string, string>();  // userId → tournamentId
const tournamentMatchToGameMatch = new Map<string, string>(); // tournamentMatchId → game matchId
const joinCodeIndex    = new Map<string, string>();  // code → tournamentId

// Per-tournament lock to serialize handleTournamentMatchEnd calls (prevents race conditions)
const tournamentLocks  = new Map<string, Promise<void>>();
function withTournamentLock(tournamentId: string, fn: () => Promise<void>): Promise<void> {
  const prev = tournamentLocks.get(tournamentId) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run fn after previous completes (even if it errored)
  tournamentLocks.set(tournamentId, next);
  return next;
}

// ── Server setup ──────────────────────────────────────────────────────────────

const app        = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL ?? "http://localhost:3000", methods: ["GET", "POST"] },
});

// ── JWT auth middleware ────────────────────────────────────────────────────────

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.accessToken as string | undefined;
  if (!token) {
    return next(new Error("unauthorized"));
  }
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return next(new Error("unauthorized"));
  }
  socket.data.user = { id: user.id, email: user.email ?? "" };
  next();
});

app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/leaderboard", async (_req, res) => {
  const top = await prisma.user.findMany({
    orderBy: { elo: "desc" },
    take: 50,
    select: { id: true, username: true, elo: true, gamesPlayed: true, wins: true, losses: true },
  });
  res.json(top);
});

// ── Bot helpers ───────────────────────────────────────────────────────────────

// Legacy fallback safety net. Remove after bot ladder stabilizes.
function makeBotUser(): User {
  return { userId: BOT_ID, username: "RiverBot", socketId: "", elo: 1200, country: null };
}

function clearQueueTimer(userId: string): void {
  const t = queueTimers.get(userId);
  if (t) { clearTimeout(t); queueTimers.delete(userId); }
  // Also clear organic bot timer if one exists
  const organicKey = `organic:${userId}`;
  const ot = botTimers.get(organicKey);
  if (ot) { clearTimeout(ot); botTimers.delete(organicKey); }
  queuedPlayers.delete(userId);
}

function removeUserFromQueues(userId: string, socketId?: string): Mode[] {
  clearQueueTimer(userId);

  const removedFrom: Mode[] = [];
  for (const mode of ["ranked", "unranked", "bullet"] as Mode[]) {
    const idx = queues[mode].findIndex((queuedUser) => (
      queuedUser.userId === userId && (!socketId || queuedUser.socketId === socketId)
    ));
    if (idx === -1) continue;

    queues[mode].splice(idx, 1);
    removedFrom.push(mode);
  }

  return removedFrom;
}

// ── State serialization ───────────────────────────────────────────────────────

/** Convert uppercase GameStreet to lowercase for frontend consumption. */
function toFrontendStreet(s: GameStreet): string {
  return s.toLowerCase();
}

function toPublicState(state: InternalGameState) {
  return {
    matchId:    state.matchId,
    mode:       state.mode,
    street:     toFrontendStreet(state.street),
    pot:        state.pot,
    board:      state.board,
    players:    state.players.map((p) => ({
      userId:   p.id,
      username: p.username,
      stack:    p.stack,
      bet:      p.betThisStreet,
      isDealer: p.id === state.dealerId,
      isToAct:  p.id === state.toActId && !p.folded && state.street !== "SHOWDOWN",
      folded:   p.folded,
      elo:      state.playerElos[p.id] ?? 1000,
      country:  state.playerCountries[p.id] ?? null,
    })),
    log:        state.log.map((e) => ({
      username: e.username,
      action:   e.action,
      amount:   e.amount,
      at:       e.at,
    })),
    handNumber:    state.handNumber,
    smallBlind:    state.smallBlind,
    bigBlind:      state.bigBlind,
    handResult:    state.handResult,
    turnDeadlineMs: state.turnDeadlineMs,
    handsUntilBlindIncrease: (() => {
      const interval = state.config.blindIncreaseIntervalHands;
      const nextMultiple = Math.ceil((state.handNumber + 1) / interval) * interval;
      return nextMultiple - state.handNumber;
    })(),
    nextSmallBlind: Math.round(state.smallBlind * state.config.blindIncreaseFactor),
    nextBigBlind:   Math.round(state.smallBlind * state.config.blindIncreaseFactor) * 2,
    readyPlayers:   Object.keys(state.readyForNextHand).filter(id => state.readyForNextHand[id]),
  };
}

function emitSpectatorState(state: InternalGameState): void {
  const pub = toPublicState(state);
  // Strip private info: no legal actions, no ready players
  const spectatorPub = { ...pub, legalActions: undefined, readyPlayers: undefined };

  // During all-in runout, include both players' hole cards
  const isAllInRunout = state.toActId === "" && !state.handResult
    && (state.players[0].stack === 0 || state.players[1].stack === 0);

  let allInCards: Record<string, [string, string]> | null = null;
  let bestHands: Record<string, string> | null = null;
  if (isAllInRunout) {
    allInCards = {};
    bestHands = {};
    for (const p of state.players) {
      const hc = state.holeCards[p.id];
      if (hc) {
        allInCards[p.id] = hc as [string, string];
        if (state.board.length >= 3 && !p.folded) {
          bestHands[p.id] = bestHand(hc as [string, string], state.board).category;
        }
      }
    }
  }

  io.to(`spectate:${state.matchId}`).emit("spectate.state", {
    publicState: spectatorPub,
    allInCards,
    bestHands,
  });
}

// ── Turn timer helpers ────────────────────────────────────────────────────────

function resetTurnTimer(state: InternalGameState): void {
  state.turnDeadlineMs = Date.now() + state.turnDurationMs;
}

function clearTurnTimer(state: InternalGameState): void {
  state.turnDeadlineMs = 0;
}

function emitGameState(state: InternalGameState): void {
  const pub = toPublicState(state);

  for (const player of state.players) {
    if (isBot(player.id)) continue; // bot has no socket
    const socketId = state.socketIds[player.id];
    const socket   = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    const heroLegal: LegalActions | undefined =
      state.street !== "SHOWDOWN" && state.toActId === player.id && !player.folded
        ? getLegalActions(state, player.id)
        : undefined;

    // Compute hero's best hand from flop onwards
    let heroBestHand: string | null = null;
    if (state.board.length >= 3 && !player.folded && state.holeCards[player.id]) {
      const hc = state.holeCards[player.id] as [string, string];
      heroBestHand = bestHand(hc, state.board).category;
    }

    // Reveal opponent's hole cards during all-in runout (no further action possible)
    const isAllInRunout = state.toActId === "" && !state.handResult
      && (state.players[0].stack === 0 || state.players[1].stack === 0);
    const opponent = state.players.find((p) => p.id !== player.id);
    const opponentHoleCards: string[] | null =
      isAllInRunout && opponent ? (state.holeCards[opponent.id] ?? null) : null;

    // Compute opponent's best hand during all-in runout
    let opponentBestHand: string | null = null;
    if (isAllInRunout && opponent && state.board.length >= 3 && !opponent.folded && state.holeCards[opponent.id]) {
      const ohc = state.holeCards[opponent.id] as [string, string];
      opponentBestHand = bestHand(ohc, state.board).category;
    }

    socket.emit("game.state", {
      publicState:   { ...pub, legalActions: heroLegal },
      heroHoleCards: state.holeCards[player.id] ?? [],
      heroBestHand,
      opponentHoleCards,
      opponentBestHand,
    });
  }

  // Emit spectator state to spectate room
  emitSpectatorState(state);

  // Schedule bot turn if it's a bot's turn to act
  const botProfile = getBotProfile(state.toActId);
  if (botProfile && state.street !== "SHOWDOWN" && !state.ended) {
    const existing = botTimers.get(state.matchId);
    if (existing) clearTimeout(existing);

    const botId = state.toActId;
    const delay = 1000 + Math.random() * 1500; // 1000–2500 ms
    const timer = setTimeout(() => {
      botTimers.delete(state.matchId);
      if (state.toActId !== botId || state.street === "SHOWDOWN" || state.ended) return;

      const legal = getLegalActions(state, botId);
      const holeCards = state.holeCards[botId];
      if (!holeCards) return;

      const opponent = state.players.find((p) => p.id !== botId)!;
      const hero = state.players.find((p) => p.id === botId)!;

      // Determine if bot was last aggressor (simplified: check last log entry)
      const lastAgg = state.log.length > 0 &&
        state.log[state.log.length - 1].action === "raise" &&
        state.log[state.log.length - 1].playerId === botId;

      const ctx: BotGameContext = {
        holeCards,
        board: state.board,
        street: state.street,
        legal,
        pot: state.pot,
        bigBlind: state.bigBlind,
        heroStack: hero.stack,
        villainStack: opponent.stack,
        wasLastAggressor: lastAgg,
      };

      const { action, amount } = decideBotAction(ctx, botProfile);

      console.log(
        `[bot] ${botProfile.username} acting — action=${action}${amount !== undefined ? ` amount=${amount}` : ""}`,
      );
      applyAction(state, botId, action, amount);
    }, delay);

    botTimers.set(state.matchId, timer);
  }
}

// ── Game helpers ──────────────────────────────────────────────────────────────

/** Returns the player who is NOT the dealer. */
function nonDealer(state: InternalGameState): PlayerState {
  return state.players[0].id === state.dealerId ? state.players[1] : state.players[0];
}

/**
 * The current street is over when:
 *   - A player folded (handled directly in FOLD — this just guards advanceStreet calls), OR
 *   - Both players have acted AND their bets are settled (equal, or one is all-in).
 */
function isStreetOver(state: InternalGameState): boolean {
  const [p0, p1] = state.players;
  if (p0.folded || p1.folded) return true;
  if (!p0.hasActed || !p1.hasActed) return false;
  return p0.betThisStreet === p1.betThisStreet || p0.stack === 0 || p1.stack === 0;
}

/**
 * If one player bet more than the other can match (short-stack all-in),
 * return the excess chips to the player who over-committed.
 */
function returnUncalledBet(state: InternalGameState): void {
  const [p0, p1] = state.players;
  const diff = p0.betThisStreet - p1.betThisStreet;
  if (diff > 0) {
    p0.stack          += diff;
    state.pot         -= diff;
    p0.betThisStreet  -= diff;
  } else if (diff < 0) {
    p1.stack          -= diff; // diff < 0 so subtract makes it positive
    state.pot         += diff; // diff < 0 so add decreases pot
    p1.betThisStreet  += diff;
  }
}

// ── Street advancement ────────────────────────────────────────────────────────

async function runoutBoard(state: InternalGameState): Promise<void> {
  const streets: Array<{ name: GameStreet; cards: number }> = [];

  if (state.board.length < 3) streets.push({ name: "FLOP",  cards: 3 });
  if (state.board.length < 4) streets.push({ name: "TURN",  cards: 1 });
  if (state.board.length < 5) streets.push({ name: "RIVER", cards: 1 });

  for (const { name, cards } of streets) {
    await new Promise<void>((resolve) => setTimeout(resolve, RUNOUT_STREET_DELAY_MS));
    state.board.push(...state.deck.splice(0, cards));
    state.street = name;
    emitGameState(state);
  }

  // Final pause before showdown result
  await new Promise<void>((resolve) => setTimeout(resolve, RUNOUT_STREET_DELAY_MS));
  state.street = "SHOWDOWN";
  resolveShowdown(state);
}

function resolveShowdown(state: InternalGameState): void {
  // Ensure 5 board cards (shouldn't be needed but guards edge cases)
  const needed = 5 - state.board.length;
  if (needed > 0) {
    state.board.push(...state.deck.splice(0, needed));
  }

  const h0 = state.holeCards[state.players[0].id];
  const h1 = state.holeCards[state.players[1].id];
  const result = showdownWinner(h0, h1, state.board);

  const best0 = bestHand(h0, state.board);
  const best1 = bestHand(h1, state.board);
  const showdownInfo: HandResult["showdown"] = {
    holeCards: {
      [state.players[0].id]: h0,
      [state.players[1].id]: h1,
    },
    hands: {
      [state.players[0].id]: { category: best0.category, cards: best0.bestCards },
      [state.players[1].id]: { category: best1.category, cards: best1.bestCards },
    },
  };

  if (result === -1) {
    // Chop: split pot evenly
    const half    = Math.floor(state.pot / 2);
    const chopPot = state.pot;
    state.players[0].stack += half;
    state.players[1].stack += chopPot - half;
    state.pot     = 0;
    state.toActId = "";
    clearTurnTimer(state);

    const chopDeltas: Record<string, number> = {};
    for (const p of state.players) {
      chopDeltas[p.id] = p.stack - (state.handStartStacks[p.id] ?? p.stack);
    }
    const nextHandDelay = state.mode === "bullet" ? BULLET_NEXT_HAND_DELAY_MS : NEXT_HAND_DELAY_MS;
    state.handResult = {
      handId:       `${state.matchId}-${state.handNumber}`,
      winnerUserId: null,
      pot:          chopPot,
      deltas:       chopDeltas,
      reason:       "SHOWDOWN",
      showUntilMs:  Date.now() + nextHandDelay,
      showdown:     showdownInfo,
      reveals:      {},
    };

    state.log.push({
      playerId: "",
      username: "Chop",
      action:   "split pot",
      street:   "SHOWDOWN",
      at:       new Date().toISOString(),
    });
    emitGameState(state);
    state.handNumber++;
    const delay = state.mode === "bullet" ? BULLET_NEXT_HAND_DELAY_MS : NEXT_HAND_DELAY_MS;
    state.nextHandTimerId = setTimeout(() => startNextHand(state), delay);
  } else {
    // Winner takes pot — show showdown board first, then award
    emitGameState(state);
    endHand(state, result, "SHOWDOWN", showdownInfo);
  }
}

const NEXT_STREET: Record<GameStreet, GameStreet | null> = {
  PREFLOP:  "FLOP",
  FLOP:     "TURN",
  TURN:     "RIVER",
  RIVER:    "SHOWDOWN",
  SHOWDOWN: null,
};

function advanceStreet(state: InternalGameState): void {
  // Return any unmatched chips (short-stack all-in scenario)
  returnUncalledBet(state);

  // If either player is all-in, animate the runout street-by-street
  if (state.players[0].stack === 0 || state.players[1].stack === 0) {
    // Clear toActId and timer so the 250ms loop doesn't fire during the runout delay
    state.toActId = "";
    clearTurnTimer(state);
    emitGameState(state); // show current board (may be empty preflop) before runout starts
    runoutBoard(state).catch((err) => console.error("[runout] error:", err));
    return;
  }

  const next = NEXT_STREET[state.street];
  if (!next) return; // already at showdown

  // Deal community cards for the new street
  if (next === "FLOP") {
    state.board.push(...state.deck.splice(0, 3));
  } else if (next === "TURN" || next === "RIVER") {
    state.board.push(...state.deck.splice(0, 1));
  }
  // SHOWDOWN: no new cards — board is already complete from RIVER

  state.street = next;

  if (next === "SHOWDOWN") {
    resolveShowdown(state);
    return;
  }

  // Reset per-street state
  for (const p of state.players) {
    p.betThisStreet = 0;
    p.hasActed      = false;
  }
  state.currentBet  = 0;
  state.previousBet = 0;

  // Post-flop: non-dealer acts first
  state.toActId = nonDealer(state).id;
  resetTurnTimer(state);

  // Street-transition log entry (username="" signals a label, not a player action)
  state.log.push({
    playerId: "",
    username: "",
    action:   toFrontendStreet(next), // "flop" | "turn" | "river"
    street:   next,
    at:       new Date().toISOString(),
  });

  emitGameState(state);
}

// ── Action application ────────────────────────────────────────────────────────

function applyAction(state: InternalGameState, playerId: string, action: string, amount?: number): void {
  const player   = state.players.find((p) => p.id === playerId)!;
  const opponent = state.players.find((p) => p.id !== playerId)!;
  const now      = new Date().toISOString();

  switch (action) {
    case "FOLD": {
      player.folded   = true;
      player.hasActed = true;
      state.log.push({ playerId, username: player.username, action: "fold", street: state.street, at: now });
      const winnerIdx = state.players[0].id === opponent.id ? 0 : 1;
      endHand(state, winnerIdx, "FOLD");
      return;
    }

    case "CHECK": {
      player.hasActed = true;
      state.log.push({ playerId, username: player.username, action: "check", street: state.street, at: now });
      if (isStreetOver(state)) {
        advanceStreet(state);
      } else {
        state.toActId = opponent.id;
        resetTurnTimer(state);
        emitGameState(state);
      }
      return;
    }

    case "CALL": {
      const toCall = Math.min(state.currentBet - player.betThisStreet, player.stack);
      player.stack         -= toCall;
      player.betThisStreet += toCall;
      player.hasActed       = true;
      state.pot            += toCall;
      state.log.push({ playerId, username: player.username, action: "call", amount: toCall, street: state.street, at: now });
      if (isStreetOver(state)) {
        advanceStreet(state);
      } else {
        state.toActId = opponent.id;
        resetTurnTimer(state);
        emitGameState(state);
      }
      return;
    }

    case "RAISE_TO": {
      const total = amount!;
      const extra = total - player.betThisStreet;
      state.previousBet     = state.currentBet;
      state.currentBet      = total;
      player.stack         -= extra;
      player.betThisStreet  = total;
      player.hasActed       = true;
      state.pot            += extra;
      state.log.push({ playerId, username: player.username, action: "raise", amount: total, street: state.street, at: now });
      // After a raise the opponent must re-act (unless already all-in)
      if (opponent.stack === 0) {
        advanceStreet(state);
      } else {
        opponent.hasActed = false;
        state.toActId     = opponent.id;
        resetTurnTimer(state);
        emitGameState(state);
      }
      return;
    }

    case "ALL_IN": {
      const extra       = player.stack;
      const allInTotal  = player.betThisStreet + extra;
      const isRaise     = allInTotal > state.currentBet;
      if (isRaise) {
        state.previousBet = state.currentBet;
        state.currentBet  = allInTotal;
      }
      player.stack         = 0;
      player.betThisStreet = allInTotal;
      player.hasActed      = true;
      state.pot           += extra;
      state.log.push({ playerId, username: player.username, action: isRaise ? "raise" : "call", amount: allInTotal, street: state.street, at: now });
      if (isRaise && opponent.stack > 0) {
        opponent.hasActed = false;
        state.toActId     = opponent.id;
        resetTurnTimer(state);
        emitGameState(state);
      } else {
        advanceStreet(state);
      }
      return;
    }
  }
}

// ── Hand lifecycle ────────────────────────────────────────────────────────────

interface EndMatchResult {
  p1Delta:     number;
  p2Delta:     number;
  p1EloBefore: number;
  p2EloBefore: number;
  p1EloAfter:  number;
  p2EloAfter:  number;
  winnerId:    string | null;
  ranked:      boolean;
}

async function recordMatchEnd(
  state:        InternalGameState,
  winnerUserId: string,
): Promise<EndMatchResult | null> {
  const p1 = state.players[0].id;
  const p2 = state.players[1].id;

  const { data, error } = await supabaseAdmin.rpc("end_match", {
    p_match_id: state.matchId,
    p_p1:       p1,
    p_p2:       p2,
    p_winner:   winnerUserId,
    p_ranked:   state.mode === "ranked",  // bullet is unranked
  });

  if (error) throw error;
  return data as EndMatchResult | null; // null = duplicate call
}

function forfeitMatch(
  state: InternalGameState,
  loserId: string,
  reason: "FORFEIT" | "DISCONNECT" | "TIMEOUT",
): void {
  if (state.ended) return;
  state.ended = true;

  const winnerId = state.players.find((p) => p.id !== loserId)!.id;
  const winnerUsername = state.players.find((p) => p.id !== loserId)!.username;

  // Tournament advancement
  if (state.tournamentId && state.tournamentMatchId) {
    withTournamentLock(state.tournamentId, () =>
      handleTournamentMatchEnd(state.tournamentId!, state.tournamentMatchId!, winnerId)
    ).catch(err => console.error('[tournament] advancement error (forfeit):', err));
  }

  // Clear all timers
  if (state.nextHandTimerId) { clearTimeout(state.nextHandTimerId); state.nextHandTimerId = undefined; }
  const existingBotTimer = botTimers.get(state.matchId);
  if (existingBotTimer) { clearTimeout(existingBotTimer); botTimers.delete(state.matchId); }
  clearTurnTimer(state);
  for (const dc of Object.values(state.disconnectedPlayers)) {
    clearTimeout(dc.timer);
  }
  state.disconnectedPlayers = {};

  // Clean up maps
  matches.delete(state.matchId);
  botDifficulties.delete(state.matchId);
  if (state.tournamentMatchId) tournamentMatchToGameMatch.delete(state.tournamentMatchId);
  for (const p of state.players) {
    activeMatches.delete(p.id);
    emoteCooldowns.delete(`${state.matchId}:${p.id}`);
  }

  const matchId    = state.matchId;
  const ranked     = state.mode === "ranked";
  const isBotMatch = state.players.some((p) => isBot(p.id));

  // Notify spectators
  io.to(`spectate:${matchId}`).emit("spectate.ended", { winnerId, winnerUsername });

  (async () => {
    let ratingDelta: Record<string, number> | null = null;
    try {
      const result = await recordMatchEnd(state, winnerId);
      if (result === null) {
        console.warn(`[forfeit] duplicate RPC call for ${matchId.slice(0, 8)}, skipping`);
        return;
      }
      if (ranked) {
        ratingDelta = { [state.players[0].id]: result.p1Delta, [state.players[1].id]: result.p2Delta };
      }
      // Update bot Elo in registry if bot was involved
      if (isBotMatch) {
        for (const p of state.players) {
          if (isBot(p.id)) {
            const newElo = p.id === state.players[0].id
              ? result.p1EloAfter : result.p2EloAfter;
            updateBotElo(p.id, newElo);
          }
        }
      }
    } catch (err) {
      console.error("[db] recordMatchEnd (forfeit) failed:", err);
    }

    io.to(`match:${matchId}`).emit("match.ended", {
      matchId,
      winnerId,
      winnerUsername,
      ranked,
      ratingDelta,
      reason,
    });
    console.log(`[forfeit] match ended — reason=${reason} winner=${winnerUsername} ranked=${ranked}`);
  })();
}

function endHand(state: InternalGameState, winnerIndex: 0 | 1, reason: "FOLD" | "SHOWDOWN", showdownInfo?: HandResult["showdown"]): void {
  const loserIndex         = winnerIndex === 0 ? 1 : 0;
  const winner             = state.players[winnerIndex];
  const loser              = state.players[loserIndex];
  const winAmount          = state.pot;

  winner.stack            += winAmount;
  winner.betThisStreet     = 0;
  loser.betThisStreet      = 0;
  state.pot                = 0;
  state.toActId            = "";
  clearTurnTimer(state);

  // Net chip deltas from the start of this hand
  const deltas: Record<string, number> = {};
  for (const p of state.players) {
    deltas[p.id] = p.stack - (state.handStartStacks[p.id] ?? p.stack);
  }
  state.handResult = {
    handId:       `${state.matchId}-${state.handNumber}`,
    winnerUserId: winner.id,
    pot:          winAmount,
    deltas,
    reason,
    showUntilMs:  Date.now() + (state.mode === "bullet" ? BULLET_NEXT_HAND_DELAY_MS : NEXT_HAND_DELAY_MS),
    showdown:     showdownInfo,
    reveals:      {},
  };

  state.log.push({
    playerId: winner.id,
    username: winner.username,
    action:   "wins",
    amount:   winAmount,
    street:   state.street,
    at:       new Date().toISOString(),
  });

  emitGameState(state);

  if (loser.stack === 0) {
    // ── In-memory guard: prevent double-recording if endHand is somehow called twice ──
    if (state.ended) return;
    state.ended = true;

    // Tournament advancement
    if (state.tournamentId && state.tournamentMatchId) {
      withTournamentLock(state.tournamentId, () =>
        handleTournamentMatchEnd(state.tournamentId!, state.tournamentMatchId!, winner.id)
      ).catch(err => console.error('[tournament] advancement error:', err));
    }

    // Remove from active matches immediately so no further actions are accepted.
    matches.delete(state.matchId);
    if (state.tournamentMatchId) tournamentMatchToGameMatch.delete(state.tournamentMatchId);
    for (const p of state.players) {
      activeMatches.delete(p.id);
    }

    // Clean up bot-specific state
    const existingBotTimer = botTimers.get(state.matchId);
    if (existingBotTimer) { clearTimeout(existingBotTimer); botTimers.delete(state.matchId); }
    botDifficulties.delete(state.matchId);

    // Notify spectators
    io.to(`spectate:${state.matchId}`).emit("spectate.ended", { winnerId: winner.id, winnerUsername: winner.username });

    const matchId        = state.matchId;
    const winnerUsername = winner.username;
    const winnerId       = winner.id;
    const ranked         = state.mode === "ranked";
    const p1             = state.players[0];
    const p2             = state.players[1];
    const isBotMatch     = isBot(p1.id) || isBot(p2.id) || p1.id === BOT_ID || p2.id === BOT_ID;

    // Async: call RPC (DB guard), then emit match.ended with authoritative deltas.
    (async () => {
      let ratingDelta: Record<string, number> | null = null;
      try {
        const result = await recordMatchEnd(state, winnerId);

        if (result === null) {
          console.warn(`[match.ended] duplicate RPC call for ${matchId.slice(0, 8)}, skipping`);
          return;
        }

        if (ranked) {
          ratingDelta = { [p1.id]: result.p1Delta, [p2.id]: result.p2Delta };
          console.log(
            `[match.ended] winnerId=${winnerId.slice(0, 8)} ranked=true` +
            ` ${p1.username}: ${result.p1EloBefore}→${result.p1EloAfter}` +
            ` (${result.p1Delta >= 0 ? "+" : ""}${result.p1Delta})` +
            ` ${p2.username}: ${result.p2EloBefore}→${result.p2EloAfter}` +
            ` (${result.p2Delta >= 0 ? "+" : ""}${result.p2Delta})`,
          );
        } else {
          console.log(
            `[match.ended] winnerId=${winnerId.slice(0, 8)} ranked=false winner=${winnerUsername}`,
          );
        }

        // Update bot Elo in registry cache
        if (isBotMatch) {
          for (const p of [p1, p2]) {
            if (isBot(p.id)) {
              const newElo = p.id === state.players[0].id
                ? result.p1EloAfter : result.p2EloAfter;
              updateBotElo(p.id, newElo);
            }
          }
        }
      } catch (err) {
        console.error("[db] recordMatchEnd failed:", err);
      }

      io.to(`match:${matchId}`).emit("match.ended", {
        matchId,
        winnerId,
        winnerUsername,
        ranked,
        ratingDelta,
      });
    })();

    return;
  }

  // Advance to next hand
  state.handNumber++;
  if (state.handNumber % state.config.blindIncreaseIntervalHands === 0) {
    state.smallBlind = Math.round(state.smallBlind * state.config.blindIncreaseFactor);
    state.bigBlind   = state.smallBlind * 2;
    console.log(`[blinds] hand #${state.handNumber} → ${state.smallBlind}/${state.bigBlind}`);
  }

  const delay = state.mode === "bullet" ? BULLET_NEXT_HAND_DELAY_MS : NEXT_HAND_DELAY_MS;
  state.nextHandTimerId = setTimeout(() => startNextHand(state), delay);
}

function startNewHand(state: InternalGameState): void {
  if (state.ended) return;
  state.readyForNextHand = {};
  state.nextHandTimerId = undefined;
  const now  = new Date().toISOString();
  const deck = shuffle(newDeck());
  const [p0, p1] = state.players;

  // Snapshot stacks before any deductions (for end-of-hand delta computation)
  state.handStartStacks = { [p0.id]: p0.stack, [p1.id]: p1.stack };
  // Clear previous hand result
  state.handResult = undefined;

  // Deal hole cards
  state.holeCards = {
    [p0.id]: [deck[0], deck[1]],
    [p1.id]: [deck[2], deck[3]],
  };
  state.deck  = deck.slice(4);
  state.board = [];

  // Reset per-hand player state
  p0.betThisStreet = 0;
  p0.folded        = false;
  p0.hasActed      = false;
  p1.betThisStreet = 0;
  p1.folded        = false;
  p1.hasActed      = false;

  // Post blinds — dealer is SB in heads-up
  const sbPlayer = state.players.find((p) => p.id === state.dealerId)!;
  const bbPlayer = state.players.find((p) => p.id !== state.dealerId)!;

  const sbAmt = Math.min(state.smallBlind, sbPlayer.stack);
  const bbAmt = Math.min(state.bigBlind,   bbPlayer.stack);

  sbPlayer.stack         -= sbAmt;
  sbPlayer.betThisStreet  = sbAmt;
  bbPlayer.stack         -= bbAmt;
  bbPlayer.betThisStreet  = bbAmt;
  state.pot               = sbAmt + bbAmt;
  state.currentBet        = bbAmt;
  state.previousBet       = 0;
  state.street            = "PREFLOP";

  // Preflop: dealer (SB) acts first
  state.toActId = state.dealerId;
  resetTurnTimer(state);

  state.log = [
    { playerId: sbPlayer.id, username: sbPlayer.username, action: "post", amount: sbAmt, street: "PREFLOP", at: now },
    { playerId: bbPlayer.id, username: bbPlayer.username, action: "post", amount: bbAmt, street: "PREFLOP", at: now },
  ];

  console.log(
    `[hand #${state.handNumber}] ${sbPlayer.username}(SB) vs ${bbPlayer.username}(BB)` +
    ` blinds=${state.smallBlind}/${state.bigBlind}`,
  );

  emitGameState(state);
}

// ── Match factory ─────────────────────────────────────────────────────────────

async function createMatch(
  p1: User, p2: User, mode: Mode,
  botDifficulty?: BotDifficulty,
  tournamentContext?: { tournamentId: string; tournamentMatchId: string },
): Promise<void> {
  const matchId = uuidv4();
  const config  = mode === "bullet" ? BULLET_CONFIG : DEFAULT_CONFIG;
  const turnDurationMs = mode === "bullet" ? BULLET_TURN_DURATION_MS : TURN_DURATION_MS;

  // Alternate who starts as dealer across matches
  const [sbUser, bbUser] = matchCounter++ % 2 === 0 ? [p1, p2] : [p2, p1];

  const players: [PlayerState, PlayerState] = [
    { id: sbUser.userId, username: sbUser.username, stack: config.startingStack, betThisStreet: 0, folded: false, hasActed: false },
    { id: bbUser.userId, username: bbUser.username, stack: config.startingStack, betThisStreet: 0, folded: false, hasActed: false },
  ];

  const state: InternalGameState = {
    matchId,
    mode,
    street:     "PREFLOP",
    pot:        0,
    currentBet:  0,
    previousBet: 0,
    board:       [],
    deck:        [],
    players,
    holeCards:   {},
    dealerId:    sbUser.userId,
    toActId:     sbUser.userId,
    log:         [],
    handNumber: 1,
    smallBlind: config.smallBlind,
    bigBlind:   config.bigBlind,
    socketIds:       {
      [sbUser.userId]: sbUser.socketId,
      [bbUser.userId]: bbUser.socketId,
    },
    config,
    handStartStacks: {},
    playerElos:      { [p1.userId]: p1.elo, [p2.userId]: p2.elo },
    playerCountries: { [p1.userId]: p1.country, [p2.userId]: p2.country },
    turnDurationMs:         turnDurationMs,
    turnDeadlineMs:         0, // set by startNewHand
    consecutiveTimeouts:    { [p1.userId]: 0, [p2.userId]: 0 },
    disconnectedPlayers:    {},
    readyForNextHand:       {},
  };

  if (tournamentContext) {
    state.tournamentId = tournamentContext.tournamentId;
    state.tournamentMatchId = tournamentContext.tournamentMatchId;
  }

  matches.set(matchId, state);
  if (!isBot(p1.userId)) activeMatches.set(p1.userId, matchId);
  if (!isBot(p2.userId)) activeMatches.set(p2.userId, matchId);
  if (botDifficulty) botDifficulties.set(matchId, botDifficulty);

  const room = `match:${matchId}`;
  for (const sid of io.sockets.adapter.rooms.get(`user:${sbUser.userId}`) ?? []) {
    const s = io.sockets.sockets.get(sid);
    s?.join(room);
    // Refresh equipped emotes on match start so lobby loadout changes take effect
    if (s && !isBot(sbUser.userId)) {
      fetchEquippedEmotes(supabaseAdmin, sbUser.userId).then(eq => { s.data.equippedEmotes = eq; });
    }
  }
  for (const sid of io.sockets.adapter.rooms.get(`user:${bbUser.userId}`) ?? []) {
    const s = io.sockets.sockets.get(sid);
    s?.join(room);
    if (s && !isBot(bbUser.userId)) {
      fetchEquippedEmotes(supabaseAdmin, bbUser.userId).then(eq => { s.data.equippedEmotes = eq; });
    }
  }

  io.to(`user:${sbUser.userId}`).emit("match.found", {
    matchId, opponent: { userId: bbUser.userId, username: bbUser.username, elo: bbUser.elo }, mode,
  });
  io.to(`user:${bbUser.userId}`).emit("match.found", {
    matchId, opponent: { userId: sbUser.userId, username: sbUser.username, elo: sbUser.elo }, mode,
  });

  console.log(
    `[match] ${sbUser.username}(SB) vs ${bbUser.username}(BB) — ${matchId.slice(0, 8)}` +
    ` mode=${mode} blinds=${config.smallBlind}/${config.bigBlind}`,
  );

  startNewHand(state);
}

// New SB/dealer for next hand: rotate from previous dealer
function startNextHand(state: InternalGameState): void {
  if (state.ended) return;
  // Rotate dealer: whichever player was NOT dealer becomes the new dealer
  const newDealer = state.players.find((p) => p.id !== state.dealerId)!;
  state.dealerId  = newDealer.id;
  startNewHand(state);
}

// ── Tournament helpers ────────────────────────────────────────────────────────

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateBracket(participants: { userId: string }[], size: 4 | 8) {
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  const totalRounds = Math.log2(size);
  const slots: { round: number; position: number; p1Id: string | null; p2Id: string | null; status: string }[] = [];

  for (let round = 1; round <= totalRounds; round++) {
    const matchesInRound = size / Math.pow(2, round);
    for (let pos = 0; pos < matchesInRound; pos++) {
      slots.push({ round, position: pos, p1Id: null, p2Id: null, status: 'pending' });
    }
  }

  // Fill round 1
  const firstRoundSlots = size / 2;
  for (let i = 0; i < firstRoundSlots; i++) {
    const slot = slots.find(s => s.round === 1 && s.position === i)!;
    slot.p1Id = shuffled[i * 2]?.userId ?? null;
    slot.p2Id = shuffled[i * 2 + 1]?.userId ?? null;
    if (slot.p1Id && slot.p2Id) slot.status = 'ready';
    else if (slot.p1Id || slot.p2Id) slot.status = 'bye';
    else slot.status = 'bye'; // empty match — no players on either side
  }
  return slots;
}

async function launchTournamentMatch(tournamentId: string, tournamentMatchId: string, p1Id: string, p2Id: string) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return;

  // Find User objects from the users map (need connected sockets)
  let p1User: User | undefined;
  let p2User: User | undefined;
  for (const u of users.values()) {
    if (u.userId === p1Id) p1User = u;
    if (u.userId === p2Id) p2User = u;
  }

  // If either is disconnected, forfeit them
  if (!p1User && !p2User) return;
  if (!p1User) {
    await withTournamentLock(tournamentId, () =>
      handleTournamentMatchEnd(tournamentId, tournamentMatchId, p2Id));
    return;
  }
  if (!p2User) {
    await withTournamentLock(tournamentId, () =>
      handleTournamentMatchEnd(tournamentId, tournamentMatchId, p1Id));
    return;
  }

  // Update DB status
  await supabaseAdmin
    .from('tournament_matches')
    .update({ status: 'in_progress' })
    .eq('id', tournamentMatchId);

  await createMatch(p1User, p2User, 'unranked', undefined, { tournamentId, tournamentMatchId });

  // Map tournament match to game match for spectators
  const gameMatchId = activeMatches.get(p1Id);
  if (gameMatchId) {
    tournamentMatchToGameMatch.set(tournamentMatchId, gameMatchId);
  }

  io.to(`tournament:${tournamentId}`).emit('tournament.match_started', {
    tournamentMatchId, p1Id, p2Id,
  });
  console.log(`[tournament] match launched ${tournamentMatchId.slice(0, 8)} — ${p1User.username} vs ${p2User.username}`);
}

async function handleTournamentMatchEnd(tournamentId: string, tournamentMatchId: string, winnerId: string) {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return;

  // Update match in DB
  await supabaseAdmin
    .from('tournament_matches')
    .update({ winner_id: winnerId, status: 'completed' })
    .eq('id', tournamentMatchId);

  // Read match details
  const { data: matchRow } = await supabaseAdmin
    .from('tournament_matches')
    .select('round, position')
    .eq('id', tournamentMatchId)
    .single();
  if (!matchRow) return;

  const { round, position } = matchRow;
  const totalRounds = Math.log2(tournament.size);

  io.to(`tournament:${tournamentId}`).emit('tournament.bracket_updated', {
    tournamentMatchId, winnerId,
    nextRound: round < totalRounds ? round + 1 : null,
    nextPosition: round < totalRounds ? Math.floor(position / 2) : null,
  });

  if (round === totalRounds) {
    // Tournament complete
    tournament.status = 'completed';
    tournament.winnerId = winnerId;

    await supabaseAdmin
      .from('tournaments')
      .update({ status: 'completed', winner_id: winnerId, ended_at: new Date().toISOString() })
      .eq('id', tournamentId);

    // Clean up playerTournament for all participants
    for (const pId of tournament.participants.keys()) {
      playerTournament.delete(pId);
    }
    // Clean up match timers
    for (const timer of tournament.matchTimers.values()) clearTimeout(timer);
    tournament.matchTimers.clear();

    io.to(`tournament:${tournamentId}`).emit('tournament.completed', { winnerId });

    // Get winner username
    const winnerP = tournament.participants.get(winnerId);
    console.log(`[tournament] ${tournamentId.slice(0, 8)} completed — winner: ${winnerP?.username ?? winnerId.slice(0, 8)}`);
    return;
  }

  // Advance winner to next round
  const nextRound = round + 1;
  const nextPosition = Math.floor(position / 2);
  const isP1Slot = position % 2 === 0;

  const updateField = isP1Slot ? { p1_id: winnerId } : { p2_id: winnerId };
  await supabaseAdmin
    .from('tournament_matches')
    .update(updateField)
    .eq('tournament_id', tournamentId)
    .eq('round', nextRound)
    .eq('position', nextPosition);

  // Check if next match now has both players
  const { data: nextMatch } = await supabaseAdmin
    .from('tournament_matches')
    .select('id, p1_id, p2_id, status')
    .eq('tournament_id', tournamentId)
    .eq('round', nextRound)
    .eq('position', nextPosition)
    .single();

  if (nextMatch && nextMatch.p1_id && nextMatch.p2_id && (nextMatch.status === 'pending' || nextMatch.status === 'bye')) {
    await supabaseAdmin
      .from('tournament_matches')
      .update({ status: 'ready', winner_id: null })
      .eq('id', nextMatch.id);

    io.to(`tournament:${tournamentId}`).emit('tournament.match_ready', {
      tournamentMatchId: nextMatch.id,
      round: nextRound,
      position: nextPosition,
      p1Id: nextMatch.p1_id,
      p2Id: nextMatch.p2_id,
    });
  }

  // Auto-bye: if next match has only one player, check if other feeder is a resolved empty bye
  if (nextMatch && (nextMatch.p1_id || nextMatch.p2_id) && !(nextMatch.p1_id && nextMatch.p2_id)) {
    const otherFeederPos = isP1Slot
      ? nextPosition * 2 + 1  // we filled p1 (from even pos), other feeder fills p2
      : nextPosition * 2;     // we filled p2 (from odd pos), other feeder fills p1

    const { data: otherFeeder } = await supabaseAdmin
      .from('tournament_matches')
      .select('status, winner_id')
      .eq('tournament_id', tournamentId)
      .eq('round', round)  // same round as the match that just ended (feeder round)
      .eq('position', otherFeederPos)
      .single();

    // If other feeder is resolved with no winner (empty bye), auto-advance sole player
    if (otherFeeder && (otherFeeder.status === 'bye' || otherFeeder.status === 'completed') && !otherFeeder.winner_id) {
      const soloWinner = nextMatch.p1_id ?? nextMatch.p2_id;
      if (soloWinner) {
        await supabaseAdmin
          .from('tournament_matches')
          .update({ winner_id: soloWinner, status: 'bye' })
          .eq('id', nextMatch.id);

        io.to(`tournament:${tournamentId}`).emit('tournament.bracket_updated', {
          tournamentMatchId: nextMatch.id, winnerId: soloWinner,
          nextRound: nextRound < totalRounds ? nextRound + 1 : null,
          nextPosition: nextRound < totalRounds ? Math.floor(nextPosition / 2) : null,
        });

        if (nextRound === totalRounds) {
          // Tournament complete — sole player wins
          tournament.status = 'completed';
          tournament.winnerId = soloWinner;
          await supabaseAdmin
            .from('tournaments')
            .update({ status: 'completed', winner_id: soloWinner, ended_at: new Date().toISOString() })
            .eq('id', tournamentId);
          for (const pId of tournament.participants.keys()) playerTournament.delete(pId);
          io.to(`tournament:${tournamentId}`).emit('tournament.completed', { winnerId: soloWinner });
          return;
        }

        // Recurse: advance through further rounds
        await handleTournamentMatchEnd(tournamentId, nextMatch.id, soloWinner);
      }
    }
  }
}

// ── Turn timer loop ───────────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const state of matches.values()) {
    // Skip matches with no active turn, at showdown, or with timer cleared/guarded
    if (
      !state.toActId          ||
      isBot(state.toActId)      || // bot acts via its own timer
      state.street === "SHOWDOWN" ||
      state.turnDeadlineMs === 0      ||
      state.turnDeadlineMs === Infinity ||
      now < state.turnDeadlineMs
    ) continue;

    // Guard: push deadline to Infinity before acting to prevent re-entry on the next tick
    state.turnDeadlineMs = Infinity;

    const playerId = state.toActId;
    const legal    = getLegalActions(state, playerId);
    const autoAction = legal.canCheck ? "CHECK" : "FOLD";

    const playerName = state.players.find((p) => p.id === playerId)?.username ?? playerId.slice(0, 8);
    console.log(`[timeout] match=${state.matchId.slice(0, 8)} player=${playerName} auto=${autoAction}`);

    // Track consecutive timeouts for non-bot players
    state.consecutiveTimeouts[playerId] = (state.consecutiveTimeouts[playerId] ?? 0) + 1;
    const isBotMatch = state.players.some((p) => isBot(p.id));
    if (state.consecutiveTimeouts[playerId] >= 3 && !isBotMatch) {
      console.log(`[timeout] player=${playerName} hit 3 consecutive timeouts — auto-forfeit`);
      forfeitMatch(state, playerId, "TIMEOUT");
      continue;
    }

    applyAction(state, playerId, autoAction);
  }
}, 250);

// ── Socket events ─────────────────────────────────────────────────────────────

io.on("connection", (socket: Socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on(
    "auth.guest",
    async (
      { username }: { username: string },
      ack: (r: { userId: string; username: string; elo: number }) => void,
    ) => {
      // socket.data.user is guaranteed set by the JWT middleware
      const verifiedId = socket.data.user.id as string;
      const trimmed    = username.trim() || "Guest";
      let dbUser;
      try {
        dbUser = await prisma.user.upsert({
          where:  { id: verifiedId },
          update: { username: trimmed },
          create: { id: verifiedId, username: trimmed },
        });
      } catch (e: any) {
        if (e?.code === "P2002") {
          // Username taken — fall back to username + random suffix
          const fallback = `${trimmed}#${Math.floor(Math.random() * 9000 + 1000)}`;
          dbUser = await prisma.user.upsert({
            where:  { id: verifiedId },
            update: { username: fallback },
            create: { id: verifiedId, username: fallback },
          });
        } else {
          throw e;
        }
      }
      // Fetch authoritative elo + country from Supabase profiles (source of truth)
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("elo, country")
        .eq("id", verifiedId)
        .single();

      const user: User = {
        userId:   verifiedId,
        username: dbUser.username ?? trimmed,
        socketId: socket.id,
        elo:      profile?.elo ?? dbUser.elo,
        country:  profile?.country ?? null,
      };
      // ── Multi-tab presence: allow multiple sockets per user ──
      const existingSocketId = userSockets.get(verifiedId);
      if (existingSocketId && existingSocketId !== socket.id) {
        users.delete(existingSocketId); // remove stale entry keyed by old socketId
      }
      userSockets.set(verifiedId, socket.id);
      markUserOnline(verifiedId, socket.id);

      users.set(socket.id, user);
      socket.join(`user:${user.userId}`);

      // Cache owned emotes for emote validation
      socket.data.ownedEmotes = await fetchOwnedEmotes(supabaseAdmin, verifiedId);
      socket.data.equippedEmotes = await fetchEquippedEmotes(supabaseAdmin, verifiedId);

      // Early-adopter claim (first 100 non-bot users get 4 exclusive emotes)
      try {
        const { data: claimResult } = await supabaseAdmin.rpc("claim_early_adopter_emotes", {
          p_user_id: verifiedId,
        });
        if (claimResult === "claimed") {
          console.log(`[early-adopter] ${user.username} claimed emotes`);
          // Refresh owned emotes cache so new emotes work immediately
          socket.data.ownedEmotes = await fetchOwnedEmotes(supabaseAdmin, verifiedId);
        }
      } catch (err) {
        console.error("[early-adopter] claim error:", err);
      }

      console.log(`[auth] ${user.username} (${user.userId.slice(0, 8)}) elo=${user.elo}`);
      ack({ userId: user.userId, username: user.username, elo: user.elo });

      // Reconnect to active match if one exists
      const existingMatchId = activeMatches.get(verifiedId);
      if (existingMatchId) {
        const state = matches.get(existingMatchId);
        if (state && !state.ended) {
          state.socketIds[verifiedId] = socket.id;
          socket.join(`match:${existingMatchId}`);

          // Clear disconnect timer
          const dc = state.disconnectedPlayers[verifiedId];
          if (dc) {
            clearTimeout(dc.timer);
            delete state.disconnectedPlayers[verifiedId];
          }
          state.consecutiveTimeouts[verifiedId] = 0;

          io.to(`match:${existingMatchId}`).emit("player.reconnected", {
            userId: verifiedId,
            username: user.username,
          });

          const opponentPlayer = state.players.find((p) => p.id !== verifiedId)!;
          socket.emit("match.found", {
            matchId: existingMatchId,
            opponent: { userId: opponentPlayer.id, username: opponentPlayer.username },
            mode: state.mode,
          });
          emitGameState(state);
          console.log(`[reconnect] ${user.username} rejoined match ${existingMatchId.slice(0, 8)}`);
        }
      }

      // Reconnect to tournament room if in one
      const tId = playerTournament.get(verifiedId);
      if (tId) socket.join(`tournament:${tId}`);
    },
  );

  socket.on("queue.join", ({ mode }: { mode?: Mode } = {}) => {
    const user      = users.get(socket.id);
    if (!user) return;
    if (activeMatches.has(user.userId)) return; // prevent re-queuing during active match
    if (playerTournament.has(user.userId)) return; // prevent queuing while in tournament
    if (queuedPlayers.has(user.userId)) return;    // atomic guard: prevent race from multiple sockets
    clearQueueTimer(user.userId);                  // reset any stale fallback timer before re-queueing
    const queueMode: Mode = mode === "unranked" ? "unranked" : mode === "bullet" ? "bullet" : "ranked";
    const q = queues[queueMode];
    if (q.some((u) => u.userId === user.userId)) return;
    queuedPlayers.add(user.userId);
    q.push(user);
    console.log(`[queue:${queueMode}] ${user.username} joined — size: ${q.length}`);
    if (q.length >= 2) {
      const [p1, p2] = q.slice(0, 2);
      if (Math.abs(p1.elo - p2.elo) <= 200) {
        q.splice(0, 2);
        clearQueueTimer(p1.userId);
        clearQueueTimer(p2.userId);
        createMatch(p1, p2, queueMode).catch((err) =>
          console.error("[match] createMatch error:", err),
        );
        return;
      }
      // Elo gap too large — both stay in queue and wait for bot timers
    }
    if (!botTimers.has(`organic:${user.userId}`)) {
      // No opponent yet — organic bot timer (7-12s), with legacy 20s fallback
      const organicDelay = BOT_JOIN_MIN_MS + Math.random() * (BOT_JOIN_MAX_MS - BOT_JOIN_MIN_MS);
      const organicTimer = setTimeout(() => {
        const idx = q.findIndex((u) => u.userId === user.userId);
        if (idx === -1) return; // already matched or left

        const bot = findBotByElo(user.elo, user.userId, queueMode);
        if (!bot) {
          console.log(`[queue:${queueMode}] ${user.username} — no bot found, waiting for legacy fallback`);
          return; // let legacy 20s timer handle it
        }

        // Found a bot — remove from queue and create match
        q.splice(idx, 1);
        clearQueueTimer(user.userId);
        const botUser: User = { userId: bot.id, username: bot.username, socketId: "", elo: bot.elo, country: bot.country ?? null };
        markBotUsed(bot.id);
        recordBotOpponent(user.userId, bot.id);
        console.log(`[queue:${queueMode}] ${user.username} matched with bot ${bot.username} (elo=${bot.elo})`);
        createMatch(user, botUser, queueMode).catch((err) =>
          console.error("[match] bot createMatch error:", err),
        );
      }, organicDelay);

      // Legacy fallback safety net. Remove after bot ladder stabilizes.
      const legacyTimer = setTimeout(() => {
        queueTimers.delete(user.userId);
        queuedPlayers.delete(user.userId);
        const idx = q.findIndex((u) => u.userId === user.userId);
        if (idx === -1) return; // already matched or left
        q.splice(idx, 1);
        console.log(`[queue:${queueMode}] ${user.username} — legacy 20s fallback triggered`);
        const botMode = queueMode === "bullet" ? "bullet" : "unranked";
        createMatch(user, makeBotUser(), botMode).catch((err) =>
          console.error("[match] legacy bot createMatch error:", err),
        );
      }, BOT_QUEUE_TIMEOUT_MS);

      // Store legacy timer so clearQueueTimer can cancel it
      queueTimers.set(user.userId, legacyTimer);
      // Also track organic timer so we can clear it
      // We piggyback on botTimers since it's not match-specific here — use a unique key
      const organicKey = `organic:${user.userId}`;
      botTimers.set(organicKey, organicTimer);
    }
  });

  socket.on("queue.leave", () => {
    const user = users.get(socket.id);
    if (!user) return;
    for (const mode of removeUserFromQueues(user.userId)) {
      console.log(`[queue:${mode}] ${user.username} left — size: ${queues[mode].length}`);
    }
  });

  socket.on(
    "game.action",
    ({ matchId, action, amount }: { matchId: string; action: string; amount?: number }) => {
      const user = users.get(socket.id);
      if (!user) return;
      const state = matches.get(matchId);
      if (!state) return;

      // Only the player whose turn it is may act
      if (state.toActId !== user.userId) {
        socket.emit("game.error", { message: "Not your turn" });
        return;
      }

      // Validate
      try {
        validateAction(state, user.userId, action, amount);
      } catch (err) {
        const msg = err instanceof ActionError ? err.message : "Invalid action";
        socket.emit("game.error", { message: msg });
        console.warn(`[action.rejected] ${user.username} ${action} — ${msg}`);
        return;
      }

      // Reset consecutive timeout counter on manual action
      state.consecutiveTimeouts[user.userId] = 0;

      // Apply
      console.log(
        `[action] match=${matchId.slice(0, 8)} player=${user.username}` +
        ` action=${action}${amount !== undefined ? ` amount=${amount}` : ""}`,
      );
      applyAction(state, user.userId, action, amount);
    },
  );

  socket.on(
    "hand.reveal",
    ({ matchId, cards }: { matchId: string; cards: string[] }) => {
      const user = users.get(socket.id);
      if (!user) return;
      const state = matches.get(matchId);
      if (!state || !state.handResult) return;
      if (Date.now() >= state.handResult.showUntilMs) return;

      // Validate: cards must be a non-empty subset of the player's actual hole cards
      const playerHoleCards = state.holeCards[user.userId];
      if (!playerHoleCards) return;
      const validCards = cards.filter((c) => playerHoleCards.includes(c));
      if (validCards.length === 0) return;

      if (!state.handResult.reveals) state.handResult.reveals = {};
      state.handResult.reveals[user.userId] = validCards;
      emitGameState(state);
    },
  );

  socket.on("hand.ready", ({ matchId }: { matchId: string }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const state = matches.get(matchId);
    if (!state || !state.handResult) return;
    if (Date.now() >= state.handResult.showUntilMs) return;

    state.readyForNextHand[user.userId] = true;

    const isBotMatch = state.players.some((p) => isBot(p.id));
    const allReady = isBotMatch
      ? state.players.some((p) => !isBot(p.id) && state.readyForNextHand[p.id])
      : state.players.every((p) => state.readyForNextHand[p.id]);

    if (allReady) {
      clearTimeout(state.nextHandTimerId);
      startNextHand(state);
    } else {
      emitGameState(state);
    }
  });

  socket.on("game.forfeit", ({ matchId }: { matchId: string }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const state = matches.get(matchId);
    if (!state) return;
    if (!state.players.some((p) => p.id === user.userId)) return;
    forfeitMatch(state, user.userId, "FORFEIT");
  });

  // ── Emotes ────────────────────────────────────────────────────────────────

  socket.on(
    "emote.send",
    ({ matchId, emoteId }: { matchId: string; emoteId: string }, ack?: (r: string) => void) => {
      const respond = (code: string) => { ack?.(code); };
      const user = users.get(socket.id);
      if (!user) return respond("no_user");

      const state = matches.get(matchId);
      if (!state) return respond("no_match");
      if (!state.players.some((p) => p.id === user.userId)) return respond("not_in_match");

      if (!isValidEmoteId(emoteId)) return respond("bad_emote");

      const owned: Set<string> | undefined = socket.data.ownedEmotes;
      if (!owned || !owned.has(emoteId)) return respond("not_owned");

      const equipped: Set<string> | undefined = socket.data.equippedEmotes;
      if (!equipped || !equipped.has(emoteId)) return respond("not_equipped");

      const cooldownKey = `${matchId}:${user.userId}`;
      const now = Date.now();
      const lastSent = emoteCooldowns.get(cooldownKey) ?? 0;
      if (now - lastSent < EMOTE_COOLDOWN_MS) return respond("cooldown");
      emoteCooldowns.set(cooldownKey, now);

      io.to(`match:${matchId}`).emit("emote.event", {
        actorUserId: user.userId,
        emoteId,
        createdAt: now,
      });
      io.to(`spectate:${matchId}`).emit("emote.event", {
        actorUserId: user.userId,
        emoteId,
        createdAt: now,
      });

      respond("ok");
    },
  );

  // ── Friends & challenges ──────────────────────────────────────────────────

  socket.on("friends.status", ({ friendIds }: { friendIds: string[] }, ack: (online: string[]) => void) => {
    ack(friendIds.filter(id => isUserOnline(id)));
  });

  socket.on(
    "challenge.create",
    ({ toUserId, mode }: { toUserId: string; mode: Mode }, ack: (r: { challengeId?: string; error?: string }) => void) => {
      const user = users.get(socket.id);
      if (!user) return ack({ error: "not_authenticated" });
      if (activeMatches.has(user.userId)) return ack({ error: "in_match" });

      const challengeId = uuidv4();

      // Auto-expire after 60s
      const timer = setTimeout(() => {
        pendingChallenges.delete(challengeId);
        socket.emit("challenge.expired", { challengeId });
        supabaseAdmin.from("pending_challenges").delete().eq("id", challengeId).then(({ error }) => {
          if (error) console.error("[challenge] db delete (expire) error:", error.message);
        });
        console.log(`[challenge] expired ${challengeId.slice(0, 8)}`);
      }, 60_000);

      const challenge: PendingChallenge = {
        id: challengeId,
        fromUser: user,
        toUserId,
        mode,
        createdAt: Date.now(),
        timer,
      };
      pendingChallenges.set(challengeId, challenge);

      // Persist to DB so Realtime delivers it even if target's socket is offline
      supabaseAdmin.from("pending_challenges").insert({
        id:            challengeId,
        from_user_id:  user.userId,
        to_user_id:    toUserId,
        from_username: user.username,
        mode,
      }).then(({ error }) => {
        if (error) console.error("[challenge] db insert error:", error.message);
      });

      // Also try instant socket delivery if target is connected
      io.to(`user:${toUserId}`).emit("challenge.received", {
        challengeId,
        fromUsername: user.username,
        fromUserId: user.userId,
        mode,
      });

      ack({ challengeId });
      console.log(`[challenge] ${user.username} → ${toUserId.slice(0, 8)} mode=${mode} id=${challengeId.slice(0, 8)}`);
    },
  );

  socket.on(
    "challenge.accept",
    ({ challengeId }: { challengeId: string }) => {
      const user = users.get(socket.id);
      if (!user) return;

      const challenge = pendingChallenges.get(challengeId);
      if (!challenge || challenge.toUserId !== user.userId) return;

      clearTimeout(challenge.timer);
      pendingChallenges.delete(challengeId);
      supabaseAdmin.from("pending_challenges").delete().eq("id", challengeId).then(({ error }) => {
        if (error) console.error("[challenge] db delete (accept) error:", error.message);
      });

      // Refresh challenger's socket ID (may have reconnected)
      let challenger = challenge.fromUser;
      for (const [, u] of users) {
        if (u.userId === challenger.userId) {
          challenger = u;
          break;
        }
      }

      console.log(`[challenge] accepted ${challengeId.slice(0, 8)} — creating match`);
      createMatch(challenger, user, challenge.mode).catch((err) =>
        console.error("[match] challenge createMatch error:", err),
      );
    },
  );

  socket.on(
    "challenge.cancel",
    ({ challengeId }: { challengeId: string }) => {
      const user = users.get(socket.id);
      if (!user) return;

      const challenge = pendingChallenges.get(challengeId);
      if (!challenge || challenge.fromUser.userId !== user.userId) return;

      clearTimeout(challenge.timer);
      pendingChallenges.delete(challengeId);
      supabaseAdmin.from("pending_challenges").delete().eq("id", challengeId).then(({ error }) => {
        if (error) console.error("[challenge] db delete (cancel) error:", error.message);
      });

      // Notify target that challenge was cancelled
      io.to(`user:${challenge.toUserId}`).emit("challenge.expired", { challengeId });

      console.log(`[challenge] cancelled ${challengeId.slice(0, 8)} by ${user.username}`);
    },
  );

  socket.on(
    "challenge.decline",
    ({ challengeId }: { challengeId: string }) => {
      const user = users.get(socket.id);
      if (!user) return;

      const challenge = pendingChallenges.get(challengeId);
      if (!challenge || challenge.toUserId !== user.userId) return;

      clearTimeout(challenge.timer);
      pendingChallenges.delete(challengeId);
      supabaseAdmin.from("pending_challenges").delete().eq("id", challengeId).then(({ error }) => {
        if (error) console.error("[challenge] db delete (decline) error:", error.message);
      });

      // Notify challenger
      io.to(`user:${challenge.fromUser.userId}`).emit("challenge.declined", { challengeId });

      console.log(`[challenge] declined ${challengeId.slice(0, 8)}`);
    },
  );

  // ── Tournament handlers ───────────────────────────────────────────────────

  socket.on("tournament.create", async (
    { size }: { size: 4 | 8 },
    ack: (r: { tournamentId?: string; joinCode?: string; error?: string }) => void,
  ) => {
    const user = users.get(socket.id);
    if (!user) return ack({ error: "Not authenticated" });
    if (playerTournament.has(user.userId)) return ack({ error: "Already in a tournament" });
    if (activeMatches.has(user.userId)) return ack({ error: "Already in a match" });
    if (size !== 4 && size !== 8) return ack({ error: "Invalid size" });

    // Generate unique join code
    let joinCode = generateJoinCode();
    let attempts = 0;
    while (joinCodeIndex.has(joinCode) && attempts < 20) {
      joinCode = generateJoinCode();
      attempts++;
    }
    if (joinCodeIndex.has(joinCode)) return ack({ error: "Could not generate unique code" });

    // Insert into DB
    const { data: tournamentRow, error } = await supabaseAdmin
      .from('tournaments')
      .insert({ host_id: user.userId, join_code: joinCode, size, status: 'lobby' })
      .select('id')
      .single();
    if (error || !tournamentRow) return ack({ error: "Failed to create tournament" });

    const tournamentId = tournamentRow.id;

    await supabaseAdmin
      .from('tournament_participants')
      .insert({ tournament_id: tournamentId, user_id: user.userId });

    // In-memory state
    const ts: TournamentState = {
      id: tournamentId,
      hostId: user.userId,
      joinCode,
      size,
      status: 'lobby',
      participants: new Map([[user.userId, { userId: user.userId, username: user.username, elo: user.elo }]]),
      matchTimers: new Map(),
      matchReadyPlayers: new Map(),
    };
    tournaments.set(tournamentId, ts);
    playerTournament.set(user.userId, tournamentId);
    joinCodeIndex.set(joinCode, tournamentId);

    socket.join(`tournament:${tournamentId}`);
    console.log(`[tournament] created ${tournamentId.slice(0, 8)} by ${user.username} — size=${size} code=${joinCode}`);
    ack({ tournamentId, joinCode });
  });

  socket.on("tournament.join", async (
    { joinCode }: { joinCode: string },
    ack: (r: { tournamentId?: string; error?: string }) => void,
  ) => {
    const user = users.get(socket.id);
    if (!user) return ack({ error: "Not authenticated" });
    if (playerTournament.has(user.userId)) return ack({ error: "Already in a tournament" });
    if (activeMatches.has(user.userId)) return ack({ error: "Already in a match" });

    const code = joinCode.trim().toUpperCase();
    const tournamentId = joinCodeIndex.get(code);
    if (!tournamentId) return ack({ error: "Tournament not found" });

    const tournament = tournaments.get(tournamentId);
    if (!tournament) return ack({ error: "Tournament not found" });
    if (tournament.status !== 'lobby') return ack({ error: "Tournament already started" });
    if (tournament.participants.size >= tournament.size) return ack({ error: "Tournament is full" });
    if (tournament.participants.has(user.userId)) return ack({ error: "Already in this tournament" });

    await supabaseAdmin
      .from('tournament_participants')
      .insert({ tournament_id: tournamentId, user_id: user.userId });

    tournament.participants.set(user.userId, { userId: user.userId, username: user.username, elo: user.elo });
    playerTournament.set(user.userId, tournamentId);

    socket.join(`tournament:${tournamentId}`);
    io.to(`tournament:${tournamentId}`).emit('tournament.player_joined', {
      tournamentId,
      userId: user.userId,
      username: user.username,
      participantCount: tournament.participants.size,
    });
    console.log(`[tournament] ${user.username} joined ${tournamentId.slice(0, 8)} (${tournament.participants.size}/${tournament.size})`);
    ack({ tournamentId });
  });

  socket.on("tournament.leave", async (
    { tournamentId }: { tournamentId: string },
    ack: (r: { ok?: boolean; error?: string }) => void,
  ) => {
    const user = users.get(socket.id);
    if (!user) return ack({ error: "Not authenticated" });

    const tournament = tournaments.get(tournamentId);
    if (!tournament) return ack({ error: "Tournament not found" });
    if (!tournament.participants.has(user.userId)) return ack({ error: "Not in this tournament" });

    // Allow leaving in any status
    if (tournament.status !== 'lobby') {
      // In progress or completed — just remove from tracking, let match forfeits handle the rest
      playerTournament.delete(user.userId);
      socket.leave(`tournament:${tournamentId}`);
      console.log(`[tournament] ${user.username} left active tournament ${tournamentId.slice(0, 8)}`);
      return ack({ ok: true });
    }

    if (tournament.hostId === user.userId) {
      // Host leaves → cancel tournament
      await supabaseAdmin.from('tournaments').delete().eq('id', tournamentId);
      for (const pId of tournament.participants.keys()) {
        playerTournament.delete(pId);
      }
      joinCodeIndex.delete(tournament.joinCode);
      tournaments.delete(tournamentId);
      io.to(`tournament:${tournamentId}`).emit('tournament.cancelled', { tournamentId });
      console.log(`[tournament] ${tournamentId.slice(0, 8)} cancelled — host left`);
    } else {
      await supabaseAdmin
        .from('tournament_participants')
        .delete()
        .eq('tournament_id', tournamentId)
        .eq('user_id', user.userId);
      tournament.participants.delete(user.userId);
      playerTournament.delete(user.userId);
      socket.leave(`tournament:${tournamentId}`);
      io.to(`tournament:${tournamentId}`).emit('tournament.player_left', {
        tournamentId,
        userId: user.userId,
        participantCount: tournament.participants.size,
      });
      console.log(`[tournament] ${user.username} left ${tournamentId.slice(0, 8)} (${tournament.participants.size}/${tournament.size})`);
    }
    ack({ ok: true });
  });

  socket.on("tournament.start", async (
    { tournamentId }: { tournamentId: string },
    ack: (r: { ok?: boolean; error?: string }) => void,
  ) => {
    const user = users.get(socket.id);
    if (!user) return ack({ error: "Not authenticated" });

    const tournament = tournaments.get(tournamentId);
    if (!tournament) return ack({ error: "Tournament not found" });
    if (tournament.hostId !== user.userId) return ack({ error: "Only the host can start" });
    if (tournament.status !== 'lobby') return ack({ error: "Tournament already started" });
    if (tournament.participants.size < 2) return ack({ error: "Need at least 2 players" });

    // Generate bracket
    const participantList = Array.from(tournament.participants.values());
    const bracketSlots = generateBracket(participantList, tournament.size);

    // Assign seeds
    let seedIdx = 0;
    for (const slot of bracketSlots.filter(s => s.round === 1)) {
      if (slot.p1Id) {
        seedIdx++;
        await supabaseAdmin
          .from('tournament_participants')
          .update({ seed: seedIdx })
          .eq('tournament_id', tournamentId)
          .eq('user_id', slot.p1Id);
      }
      if (slot.p2Id) {
        seedIdx++;
        await supabaseAdmin
          .from('tournament_participants')
          .update({ seed: seedIdx })
          .eq('tournament_id', tournamentId)
          .eq('user_id', slot.p2Id);
      }
    }

    // Insert match rows
    const matchInserts = bracketSlots.map(s => ({
      tournament_id: tournamentId,
      round: s.round,
      position: s.position,
      p1_id: s.p1Id,
      p2_id: s.p2Id,
      status: s.status,
    }));
    await supabaseAdmin.from('tournament_matches').insert(matchInserts);

    // Update tournament status
    tournament.status = 'in_progress';
    await supabaseAdmin
      .from('tournaments')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', tournamentId);

    // Read inserted matches to get IDs
    const { data: dbMatches } = await supabaseAdmin
      .from('tournament_matches')
      .select('id, round, position, p1_id, p2_id, status')
      .eq('tournament_id', tournamentId)
      .order('round')
      .order('position');

    // Process byes: auto-advance, then propagate through later rounds
    const totalRounds = Math.log2(tournament.size);
    for (let round = 1; round <= totalRounds; round++) {
      // Re-read current round matches each iteration (previous round may have updated them)
      const { data: roundMatches } = await supabaseAdmin
        .from('tournament_matches')
        .select('id, round, position, p1_id, p2_id, winner_id, status')
        .eq('tournament_id', tournamentId)
        .eq('round', round);

      for (const bm of (roundMatches ?? [])) {
        const hasP1 = !!bm.p1_id;
        const hasP2 = !!bm.p2_id;

        // Skip if already processed or is a real match
        if (bm.status === 'ready' || bm.status === 'completed') continue;
        if (hasP1 && hasP2) continue; // real match, will be set to ready below

        // For later rounds, only process bye if both feeder matches are resolved
        if (round > 1) {
          const feederPos1 = bm.position * 2;
          const feederPos2 = bm.position * 2 + 1;
          const { data: feeders } = await supabaseAdmin
            .from('tournament_matches')
            .select('status')
            .eq('tournament_id', tournamentId)
            .eq('round', round - 1)
            .in('position', [feederPos1, feederPos2]);
          const hasUnresolvedFeeder = (feeders ?? []).some(
            f => f.status === 'pending' || f.status === 'ready' || f.status === 'in_progress'
          );
          if (hasUnresolvedFeeder) continue;
        }

        // Bye: one or zero players
        const winnerId = bm.p1_id ?? bm.p2_id; // null if empty match
        await supabaseAdmin
          .from('tournament_matches')
          .update({ winner_id: winnerId, status: 'bye' })
          .eq('id', bm.id);

        // Advance winner (if any) to next round
        if (winnerId && round < totalRounds) {
          const nextRound = round + 1;
          const nextPosition = Math.floor(bm.position / 2);
          const isP1Slot = bm.position % 2 === 0;
          const updateField = isP1Slot ? { p1_id: winnerId } : { p2_id: winnerId };
          await supabaseAdmin
            .from('tournament_matches')
            .update(updateField)
            .eq('tournament_id', tournamentId)
            .eq('round', nextRound)
            .eq('position', nextPosition);
        }
      }
    }

    // Re-read all matches after bye processing
    const { data: updatedMatches } = await supabaseAdmin
      .from('tournament_matches')
      .select('id, round, position, p1_id, p2_id, winner_id, status')
      .eq('tournament_id', tournamentId)
      .order('round')
      .order('position');

    // Mark matches with both players as ready
    for (const m of (updatedMatches ?? [])) {
      if (m.p1_id && m.p2_id && (m.status === 'pending' || m.status === 'bye') && !m.winner_id) {
        await supabaseAdmin
          .from('tournament_matches')
          .update({ status: 'ready' })
          .eq('id', m.id);
        m.status = 'ready';
      }
    }

    // Build full state for broadcast
    const matchesPayload = (updatedMatches ?? []).map(m => ({
      id: m.id,
      round: m.round,
      position: m.position,
      p1: m.p1_id ? { userId: m.p1_id, username: tournament.participants.get(m.p1_id)?.username ?? 'Unknown' } : null,
      p2: m.p2_id ? { userId: m.p2_id, username: tournament.participants.get(m.p2_id)?.username ?? 'Unknown' } : null,
      winnerId: m.winner_id,
      status: m.status,
    }));
    const participantsPayload = participantList.map((p, i) => ({
      userId: p.userId, username: p.username, seed: i + 1,
    }));

    io.to(`tournament:${tournamentId}`).emit('tournament.started', {
      id: tournamentId,
      hostId: tournament.hostId,
      joinCode: tournament.joinCode,
      size: tournament.size,
      status: 'in_progress',
      winnerId: null,
      participants: participantsPayload,
      matches: matchesPayload,
    });

    // Notify players that their matches are ready for ready-up
    const readyMatches = (updatedMatches ?? []).filter(m => m.status === 'ready');
    for (const rm of readyMatches) {
      io.to(`tournament:${tournamentId}`).emit('tournament.match_ready', {
        tournamentMatchId: rm.id,
        round: rm.round,
        position: rm.position,
        p1Id: rm.p1_id,
        p2Id: rm.p2_id,
      });
    }

    console.log(`[tournament] ${tournamentId.slice(0, 8)} started — ${participantList.length} players, ${readyMatches.length} ready matches`);
    ack({ ok: true });
  });

  socket.on("tournament.get_state", async (
    { tournamentId }: { tournamentId: string },
    ack: (r: any) => void,
  ) => {
    // Read from DB for authoritative state
    const { data: t } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .eq('id', tournamentId)
      .single();
    if (!t) return ack({ error: "Tournament not found" });

    const { data: participants } = await supabaseAdmin
      .from('tournament_participants')
      .select('user_id, seed')
      .eq('tournament_id', tournamentId);

    // Get usernames from profiles
    const userIds = (participants ?? []).map(p => p.user_id);
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .in('id', userIds);
    const profileMap = new Map((profiles ?? []).map(p => [p.id, p.username]));

    const { data: matchRows } = await supabaseAdmin
      .from('tournament_matches')
      .select('id, round, position, p1_id, p2_id, winner_id, status')
      .eq('tournament_id', tournamentId)
      .order('round')
      .order('position');

    ack({
      id: t.id,
      hostId: t.host_id,
      joinCode: t.join_code,
      size: t.size,
      status: t.status,
      winnerId: t.winner_id,
      participants: (participants ?? []).map(p => ({
        userId: p.user_id,
        username: profileMap.get(p.user_id) ?? 'Unknown',
        seed: p.seed,
      })),
      matches: (matchRows ?? []).map(m => ({
        id: m.id,
        round: m.round,
        position: m.position,
        p1: m.p1_id ? { userId: m.p1_id, username: profileMap.get(m.p1_id) ?? 'Unknown' } : null,
        p2: m.p2_id ? { userId: m.p2_id, username: profileMap.get(m.p2_id) ?? 'Unknown' } : null,
        winnerId: m.winner_id,
        status: m.status,
      })),
    });
  });

  // ── Tournament ready-up ───────────────────────────────────────────────────

  socket.on("tournament.match_ready_up", async (
    { tournamentMatchId }: { tournamentMatchId: string },
    ack: (r: { ok?: boolean; error?: string }) => void,
  ) => {
    const user = users.get(socket.id);
    if (!user) return ack({ error: "Not authenticated" });

    const tournamentId = playerTournament.get(user.userId);
    if (!tournamentId) return ack({ error: "Not in a tournament" });

    const tournament = tournaments.get(tournamentId);
    if (!tournament || tournament.status !== 'in_progress') return ack({ error: "Tournament not in progress" });

    // Validate this match exists and is ready
    const { data: matchRow } = await supabaseAdmin
      .from('tournament_matches')
      .select('id, p1_id, p2_id, status')
      .eq('id', tournamentMatchId)
      .eq('tournament_id', tournamentId)
      .single();

    if (!matchRow) return ack({ error: "Match not found" });
    if (matchRow.status !== 'ready') return ack({ error: "Match is not ready" });
    if (matchRow.p1_id !== user.userId && matchRow.p2_id !== user.userId) {
      return ack({ error: "Not your match" });
    }

    // Track readiness
    if (!tournament.matchReadyPlayers.has(tournamentMatchId)) {
      tournament.matchReadyPlayers.set(tournamentMatchId, new Set());
    }
    const readySet = tournament.matchReadyPlayers.get(tournamentMatchId)!;
    readySet.add(user.userId);

    // Broadcast who readied up
    io.to(`tournament:${tournamentId}`).emit('tournament.player_readied', {
      tournamentMatchId,
      userId: user.userId,
      readyPlayerIds: Array.from(readySet),
    });

    console.log(`[tournament] ${user.username} readied up for match ${tournamentMatchId.slice(0, 8)} (${readySet.size}/2)`);

    // If both players ready, launch the match
    if (readySet.size >= 2 && matchRow.p1_id && matchRow.p2_id) {
      tournament.matchReadyPlayers.delete(tournamentMatchId);
      launchTournamentMatch(tournamentId, tournamentMatchId, matchRow.p1_id, matchRow.p2_id)
        .catch(err => console.error('[tournament] launch error:', err));
    }

    ack({ ok: true });
  });

  // ── Spectate ──────────────────────────────────────────────────────────────

  socket.on("spectate.join", (
    { tournamentMatchId }: { tournamentMatchId: string },
    ack: (r: { ok?: boolean; matchId?: string; error?: string }) => void,
  ) => {
    const user = users.get(socket.id);
    if (!user) return ack({ error: "Not authenticated" });

    // Validate user is in a tournament
    const tournamentId = playerTournament.get(user.userId);
    if (!tournamentId) return ack({ error: "Not in a tournament" });

    // Look up game matchId
    const matchId = tournamentMatchToGameMatch.get(tournamentMatchId);
    if (!matchId) return ack({ error: "Match not found or not in progress" });

    // Reject if user is a player in this match (anti-cheat)
    const state = matches.get(matchId);
    if (state && state.players.some((p) => p.id === user.userId)) {
      return ack({ error: "Cannot spectate your own match" });
    }

    socket.join(`spectate:${matchId}`);

    // Immediately send current state
    if (state) {
      const pub = toPublicState(state);
      const spectatorPub = { ...pub, legalActions: undefined, readyPlayers: undefined };

      const isAllInRunout = state.toActId === "" && !state.handResult
        && (state.players[0].stack === 0 || state.players[1].stack === 0);
      let allInCards: Record<string, [string, string]> | null = null;
      let bestHands: Record<string, string> | null = null;
      if (isAllInRunout) {
        allInCards = {};
        bestHands = {};
        for (const p of state.players) {
          const hc = state.holeCards[p.id];
          if (hc) {
            allInCards[p.id] = hc as [string, string];
            if (state.board.length >= 3 && !p.folded) {
              bestHands[p.id] = bestHand(hc as [string, string], state.board).category;
            }
          }
        }
      }

      socket.emit("spectate.state", { publicState: spectatorPub, allInCards, bestHands });
    }

    console.log(`[spectate] ${user.username} spectating match ${matchId.slice(0, 8)}`);
    ack({ ok: true, matchId });
  });

  socket.on("spectate.leave", ({ matchId }: { matchId: string }) => {
    socket.leave(`spectate:${matchId}`);
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (user) {
      markUserOffline(socket.id);
      const stillOnline = isUserOnline(user.userId);

      // Only clean up queue/challenges/match when ALL sockets are gone
      if (!stillOnline) {
        removeUserFromQueues(user.userId);

        // Persist last_online timestamp
        supabaseAdmin
          .from("profiles")
          .update({ last_online: new Date().toISOString() })
          .eq("id", user.userId)
          .then(({ error }) => {
            if (error) console.error("[presence] last_online update error:", error.message);
          });

        // Clean up pending challenges where this user is the challenger
        for (const [cid, challenge] of pendingChallenges) {
          if (challenge.fromUser.userId === user.userId) {
            clearTimeout(challenge.timer);
            pendingChallenges.delete(cid);
            supabaseAdmin.from("pending_challenges").delete().eq("id", cid).then(({ error }) => {
              if (error) console.error("[challenge] db delete (disconnect) error:", error.message);
            });
            // Notify target
            io.to(`user:${challenge.toUserId}`).emit("challenge.expired", { challengeId: cid });
          }
        }

        // Tournament disconnect: don't auto-cancel/remove on socket disconnect
        // because page navigation (dashboard → tournament page) causes a brief disconnect.
        // Cleanup only happens via explicit tournament.leave.
        // If in_progress: match disconnect handling below (30s grace → forfeit → handleTournamentMatchEnd) handles it.

        // Handle active match disconnect
        const matchId = activeMatches.get(user.userId);
        if (matchId) {
          const state = matches.get(matchId);
          if (state && !state.ended) {
            const isBotMatch = state.players.some((p) => isBot(p.id));
            const gracePeriod = isBotMatch ? 10_000 : 30_000;
            const timer = setTimeout(() => {
              delete state.disconnectedPlayers[user.userId];
              if (!state.ended) {
                forfeitMatch(state, user.userId, "DISCONNECT");
              }
            }, gracePeriod);
            state.disconnectedPlayers[user.userId] = { since: Date.now(), timer };
            if (!isBotMatch) {
              io.to(`match:${matchId}`).emit("player.disconnected", {
                userId: user.userId,
                username: user.username,
              });
            }
            console.log(`[disconnect] ${user.username} — ${gracePeriod / 1000}s grace period started${isBotMatch ? " (bot match)" : ""}`);
          }
        }

        queuedPlayers.delete(user.userId);
      } else {
        for (const mode of removeUserFromQueues(user.userId, socket.id)) {
          console.log(`[queue:${mode}] ${user.username} disconnected while queued — size: ${queues[mode].length}`);
        }
      }

      users.delete(socket.id);
      // Only remove from userSockets if this socket is still the current one
      if (userSockets.get(user.userId) === socket.id) {
        userSockets.delete(user.userId);
      }
      console.log(`[disconnect] ${user.username}${stillOnline ? " (other tabs still open)" : ""}`);
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

Promise.all([loadBotRegistry(), loadEmotes(supabaseAdmin)])
  .then(() => {
    httpServer.listen(4000, () => console.log("Backend running on http://localhost:4000"));
  })
  .catch((err) => {
    console.error("[startup] partial init failure, starting anyway:", err);
    httpServer.listen(4000, () => console.log("Backend running on http://localhost:4000 (partial init)"));
  });
