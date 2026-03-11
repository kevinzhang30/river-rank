// ── Primitives ────────────────────────────────────────────────────────────────

/** A card string: rank + suit, e.g. "As", "Td", "2h". */
export type Card = string;

export type GameStreet = "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN";
export type Mode       = "ranked"  | "unranked";

// ── Config ────────────────────────────────────────────────────────────────────

export interface GameConfig {
  startingStack:               number;
  smallBlind:                  number;
  bigBlind:                    number;
  /** Blinds increase after every N hands. */
  blindIncreaseIntervalHands:  number;
  /** Multiply both blinds by this factor when the interval triggers. */
  blindIncreaseFactor:         number;
}

export const DEFAULT_CONFIG: GameConfig = {
  startingStack:              1000,
  smallBlind:                 10,
  bigBlind:                   20,
  blindIncreaseIntervalHands: 3,
  blindIncreaseFactor:        1.5,
};

// ── Player state ──────────────────────────────────────────────────────────────

export interface PlayerState {
  id:            string;
  username:      string;
  stack:         number;
  betThisStreet: number;
  folded:        boolean;
  hasActed:      boolean;
}

// ── Log ───────────────────────────────────────────────────────────────────────

export interface InternalLogEntry {
  playerId: string;
  username: string;
  action:   string;
  amount?:  number;
  street:   GameStreet;
  at:       string;
}

// ── Game state ────────────────────────────────────────────────────────────────

export interface InternalGameState {
  matchId:    string;
  mode:       Mode;
  street:     GameStreet;
  pot:        number;
  /** The highest betThisStreet committed by any player this street. */
  currentBet: number;
  board:      Card[];
  deck:       Card[];
  players:    [PlayerState, PlayerState];
  /** Hole cards keyed by player id. */
  holeCards:  Record<string, [Card, Card]>;
  /** Player id of the dealer / small blind. */
  dealerId:   string;
  /** Player id whose turn it is to act. */
  toActId:     string;
  /**
   * The currentBet value before the most recent raise this street.
   * Used to compute the minimum re-raise size. Resets to 0 each street.
   */
  previousBet: number;
  log:         InternalLogEntry[];
  handNumber: number;
  smallBlind: number;
  bigBlind:   number;
  /** Maps player id → socket id. */
  socketIds:       Record<string, string>;
  config:          GameConfig;
  /** Stacks at the start of the current hand (before blinds), for delta computation. */
  handStartStacks: Record<string, number>;
  /** Elo ratings at match creation, keyed by player id. Used to compute final elo delta. */
  playerElos:      Record<string, number>;
  /** Set when a hand ends; cleared when the next hand begins. */
  handResult?:     HandResult;
  /** Configurable turn length in ms. */
  turnDurationMs:  number;
  /** Unix timestamp when the current player's turn expires. 0 = no active timer. */
  turnDeadlineMs:  number;
  /** Set to true the moment match-end is triggered; prevents double-recording. */
  ended?:          boolean;
  /** Per-player count of consecutive turn timeouts (auto-forfeit after 3). */
  consecutiveTimeouts: Record<string, number>;
  /** Tracks disconnected players and their 30s reconnection timers. */
  disconnectedPlayers: Record<string, { since: number; timer: ReturnType<typeof setTimeout> }>;
}

// ── Hand result (broadcast after each hand ends) ─────────────────────────────

export interface HandResult {
  handId:       string;
  winnerUserId: string | null;   // null = split pot
  pot:          number;
  deltas:       Record<string, number>; // userId → net chip change for this hand
  reason:       "FOLD" | "SHOWDOWN";
  showUntilMs:  number;
  /** Populated at showdown: both players' hole cards + best hand category/cards. */
  showdown?: {
    holeCards: Record<string, [string, string]>;
    hands:     Record<string, { category: string; cards: string[] }>;
  };
  /** Cards voluntarily revealed by each player during inter-hand pause. */
  reveals?: Record<string, string[]>;
}

// ── Legal actions (sent to hero only) ────────────────────────────────────────

export interface LegalActions {
  canFold:     boolean;
  canCheck:    boolean;
  canCall:     boolean;
  callAmount?: number;
  minRaiseTo?: number;
  maxRaiseTo?: number;
}
