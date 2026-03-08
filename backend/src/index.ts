import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";

import { DEFAULT_CONFIG } from "./engine/types";
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
import type { BotDifficulty } from "./bot/strategy";
import { prisma } from "./db";
import { supabaseAdmin } from "./db/supabaseAdmin";

// ── User type ─────────────────────────────────────────────────────────────────

interface User {
  userId:   string;
  username: string;
  socketId: string;
  elo:      number;
}

// ── Bot constants ─────────────────────────────────────────────────────────────

const BOT_ID               = "00000000-0000-0000-0000-000000000000";
const BOT_QUEUE_TIMEOUT_MS = 20_000;

// ── Turn timer ────────────────────────────────────────────────────────────────

const TURN_DURATION_MS         = 15_000;
const RUNOUT_STREET_DELAY_MS   = 1_000;

// ── In-memory store ───────────────────────────────────────────────────────────

const users      = new Map<string, User>();
const queues: Record<Mode, User[]> = { ranked: [], unranked: [] };
const matches    = new Map<string, InternalGameState>();
let matchCounter = 0;

// bot state
const botDifficulties = new Map<string, BotDifficulty>(); // matchId → difficulty
const botTimers       = new Map<string, ReturnType<typeof setTimeout>>(); // matchId → timer
const queueTimers     = new Map<string, ReturnType<typeof setTimeout>>(); // userId → timer

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

function makeBotUser(): User {
  return { userId: BOT_ID, username: "RiverBot", socketId: "", elo: 1200 };
}

function getBotDifficulty(mode: Mode, elo: number): BotDifficulty {
  if (mode === "unranked") return "easy";
  if (elo < 1100) return "easy";
  if (elo <= 1300) return "medium";
  return "hard";
}

function clearQueueTimer(userId: string): void {
  const t = queueTimers.get(userId);
  if (t) { clearTimeout(t); queueTimers.delete(userId); }
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
  };
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
    if (player.id === BOT_ID) continue; // bot has no socket
    const socketId = state.socketIds[player.id];
    const socket   = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    const heroLegal: LegalActions | undefined =
      state.street !== "SHOWDOWN" && state.toActId === player.id && !player.folded
        ? getLegalActions(state, player.id)
        : undefined;

    socket.emit("game.state", {
      publicState:   { ...pub, legalActions: heroLegal },
      heroHoleCards: state.holeCards[player.id] ?? [],
    });
  }

  // Schedule bot turn if it's the bot's turn to act
  if (state.toActId === BOT_ID && state.street !== "SHOWDOWN" && !state.ended) {
    const existing = botTimers.get(state.matchId);
    if (existing) clearTimeout(existing);

    const delay = 1000 + Math.random() * 1500; // 1000–2500 ms
    const timer = setTimeout(() => {
      botTimers.delete(state.matchId);
      if (state.toActId !== BOT_ID || state.street === "SHOWDOWN" || state.ended) return;

      const legal      = getLegalActions(state, BOT_ID);
      const holeCards  = state.holeCards[BOT_ID];
      if (!holeCards) return;

      const difficulty = botDifficulties.get(state.matchId) ?? "easy";
      const { action, amount } = decideBotAction(
        holeCards, state.board, state.street,
        legal, state.pot, state.bigBlind, difficulty,
      );

      console.log(
        `[bot] RiverBot acting — action=${action}${amount !== undefined ? ` amount=${amount}` : ""}`,
      );
      applyAction(state, BOT_ID, action, amount);
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
    state.handResult = {
      handId:       `${state.matchId}-${state.handNumber}`,
      winnerUserId: null,
      pot:          chopPot,
      deltas:       chopDeltas,
      reason:       "SHOWDOWN",
      showUntilMs:  Date.now() + 12_000,
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
    setTimeout(() => startNextHand(state), 12_000);
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
    p_ranked:   state.mode === "ranked",
  });

  if (error) throw error;
  return data as EndMatchResult | null; // null = duplicate call
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
    showUntilMs:  Date.now() + 12_000,
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

    // Remove from active matches immediately so no further actions are accepted.
    matches.delete(state.matchId);

    // Clean up bot-specific state
    const existingBotTimer = botTimers.get(state.matchId);
    if (existingBotTimer) { clearTimeout(existingBotTimer); botTimers.delete(state.matchId); }
    botDifficulties.delete(state.matchId);

    const matchId        = state.matchId;
    const winnerUsername = winner.username;
    const winnerId       = winner.id;
    const ranked         = state.mode === "ranked";
    const p1             = state.players[0];
    const p2             = state.players[1];
    const isBotMatch     = p1.id === BOT_ID || p2.id === BOT_ID;

    // Async: call RPC (DB guard), then emit match.ended with authoritative deltas.
    (async () => {
      let ratingDelta: Record<string, number> | null = null;
      try {
        if (!isBotMatch) {
          const result = await recordMatchEnd(state, winnerId);

          if (result === null) {
            // DB guard fired — already recorded, skip emit to avoid duplicate.
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
        } else {
          console.log(
            `[match.ended] bot match winnerId=${winnerId.slice(0, 8)} winner=${winnerUsername}`,
          );
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

  setTimeout(() => startNextHand(state), 12_000);
}

function startNewHand(state: InternalGameState): void {
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

async function createMatch(p1: User, p2: User, mode: Mode, botDifficulty?: BotDifficulty): Promise<void> {
  const matchId = uuidv4();
  const config  = DEFAULT_CONFIG;

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
    turnDurationMs:  TURN_DURATION_MS,
    turnDeadlineMs:  0, // set by startNewHand
  };

  matches.set(matchId, state);
  if (botDifficulty) botDifficulties.set(matchId, botDifficulty);

  const room = `match:${matchId}`;
  io.sockets.sockets.get(sbUser.socketId)?.join(room);
  io.sockets.sockets.get(bbUser.socketId)?.join(room);

  io.sockets.sockets.get(sbUser.socketId)?.emit("match.found", {
    matchId, opponent: { userId: bbUser.userId, username: bbUser.username }, mode,
  });
  io.sockets.sockets.get(bbUser.socketId)?.emit("match.found", {
    matchId, opponent: { userId: sbUser.userId, username: sbUser.username }, mode,
  });

  console.log(
    `[match] ${sbUser.username}(SB) vs ${bbUser.username}(BB) — ${matchId.slice(0, 8)}` +
    ` mode=${mode} blinds=${config.smallBlind}/${config.bigBlind}`,
  );

  startNewHand(state);
}

// New SB/dealer for next hand: rotate from previous dealer
function startNextHand(state: InternalGameState): void {
  // Rotate dealer: whichever player was NOT dealer becomes the new dealer
  const newDealer = state.players.find((p) => p.id !== state.dealerId)!;
  state.dealerId  = newDealer.id;
  startNewHand(state);
}

// ── Turn timer loop ───────────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const state of matches.values()) {
    // Skip matches with no active turn, at showdown, or with timer cleared/guarded
    if (
      !state.toActId          ||
      state.toActId === BOT_ID   || // bot acts via its own timer
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
      const dbUser     = await prisma.user.upsert({
        where:  { id: verifiedId },
        update: { username: trimmed },
        create: { id: verifiedId, username: trimmed },
      });
      const user: User = {
        userId:   verifiedId,
        username: dbUser.username,
        socketId: socket.id,
        elo:      dbUser.elo,
      };
      users.set(socket.id, user);
      console.log(`[auth] ${user.username} (${user.userId.slice(0, 8)}) elo=${user.elo}`);
      ack({ userId: user.userId, username: user.username, elo: user.elo });
    },
  );

  socket.on("queue.join", ({ mode }: { mode?: Mode } = {}) => {
    const user      = users.get(socket.id);
    if (!user) return;
    const queueMode: Mode = mode === "unranked" ? "unranked" : "ranked";
    const q = queues[queueMode];
    if (q.some((u) => u.userId === user.userId)) return;
    q.push(user);
    console.log(`[queue:${queueMode}] ${user.username} joined — size: ${q.length}`);
    if (q.length >= 2) {
      const [p1, p2] = q.splice(0, 2);
      clearQueueTimer(p1.userId);
      clearQueueTimer(p2.userId);
      createMatch(p1, p2, queueMode).catch((err) =>
        console.error("[match] createMatch error:", err),
      );
    } else {
      // No opponent yet — pair with bot after 20 seconds
      const timer = setTimeout(() => {
        queueTimers.delete(user.userId);
        const idx = q.findIndex((u) => u.userId === user.userId);
        if (idx === -1) return; // already matched or left
        q.splice(idx, 1);
        const difficulty = getBotDifficulty(queueMode, user.elo);
        console.log(`[queue:${queueMode}] ${user.username} timed out — matching with bot (${difficulty})`);
        createMatch(user, makeBotUser(), "unranked", difficulty).catch((err) =>
          console.error("[match] bot createMatch error:", err),
        );
      }, BOT_QUEUE_TIMEOUT_MS);
      queueTimers.set(user.userId, timer);
    }
  });

  socket.on("queue.leave", () => {
    const user = users.get(socket.id);
    if (!user) return;
    clearQueueTimer(user.userId);
    for (const m of ["ranked", "unranked"] as Mode[]) {
      const idx = queues[m].findIndex((u) => u.userId === user.userId);
      if (idx !== -1) {
        queues[m].splice(idx, 1);
        console.log(`[queue:${m}] ${user.username} left — size: ${queues[m].length}`);
      }
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

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (user) {
      clearQueueTimer(user.userId);
      for (const m of ["ranked", "unranked"] as Mode[]) {
        const idx = queues[m].findIndex((u) => u.userId === user.userId);
        if (idx !== -1) queues[m].splice(idx, 1);
      }
      users.delete(socket.id);
      console.log(`[disconnect] ${user.username}`);
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

httpServer.listen(4000, () => console.log("Backend running on http://localhost:4000"));
