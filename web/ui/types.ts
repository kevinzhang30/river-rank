export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
export type Mode = "ranked" | "unranked" | "bullet";

export interface PublicPlayer {
  userId:   string;
  username: string;
  stack:    number;
  bet:      number;
  isDealer: boolean;
  isToAct:  boolean;
  folded:   boolean;
}

export interface LegalActions {
  canFold:     boolean;
  canCheck:    boolean;
  canCall:     boolean;
  callAmount?: number;
  minRaiseTo?: number;
  maxRaiseTo?: number;
}

export interface LogEntry {
  username: string;
  action:   string;
  amount?:  number;
  at:       string;
}

export interface PublicGameState {
  matchId:      string;
  mode:         Mode;
  street:       Street;
  pot:          number;
  board:        string[];
  players:      [PublicPlayer, PublicPlayer];
  log:          LogEntry[];
  handNumber:   number;
  smallBlind:   number;
  bigBlind:     number;
  legalActions?:  LegalActions;
  handResult?:    HandResult;
  turnDeadlineMs?: number;
  handsUntilBlindIncrease?: number;
  nextSmallBlind?:           number;
  nextBigBlind?:             number;
  readyPlayers?:             string[];
}

export interface HandResult {
  handId:       string;
  winnerUserId: string | null;
  pot:          number;
  deltas:       Record<string, number>;
  reason:       "FOLD" | "SHOWDOWN";
  showUntilMs:  number;
  showdown?: {
    holeCards: Record<string, [string, string]>;
    hands:     Record<string, { category: string; cards: string[] }>;
  };
  reveals?: Record<string, string[]>;
}

export interface HeroPrivate {
  holeCards: [string, string];
}

export interface LeaderboardEntry {
  id:          string;
  username:    string;
  elo:         number;
  gamesPlayed: number;
  wins:        number;
  losses:      number;
  country:     string | null;
}
