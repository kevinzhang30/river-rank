export type Suit = "s" | "h" | "d" | "c";
export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "T" | "J" | "Q" | "K" | "A";

export type Card = `${Rank}${Suit}`;

// ── Config ────────────────────────────────────────────────────────────────────

export interface GameConfig {
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
}

// ── Player ────────────────────────────────────────────────────────────────────

export type Position = "SB" | "BB";

export interface PlayerState {
  id: string;
  position: Position;
  stack: number;
  holeCards: [Card, Card] | null; // null until dealt
  betThisStreet: number;
  hasActed: boolean;
  folded: boolean;
  isAllIn: boolean;
}

// ── Game ──────────────────────────────────────────────────────────────────────

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export interface GameState {
  config: GameConfig;
  street: Street;
  pot: number;
  board: Card[];                   // 0–5 community cards
  deck: Card[];                    // remaining deck
  players: [PlayerState, PlayerState]; // index 0 = SB, index 1 = BB
  activePlayerIndex: 0 | 1;
  handNumber: number;
  isHandOver: boolean;
  winnerId: string | null;
}

// ── Actions ───────────────────────────────────────────────────────────────────

export type ActionType = "fold" | "check" | "call" | "raise_to" | "all_in";

export interface Action {
  type: ActionType;
  playerId: string;
  amount?: number; // required for bet / raise
}
