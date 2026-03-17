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
  elo:      number;
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

export interface TournamentMatchInfo {
  id: string;
  round: number;
  position: number;
  p1: { userId: string; username: string } | null;
  p2: { userId: string; username: string } | null;
  winnerId: string | null;
  status: 'pending' | 'ready' | 'in_progress' | 'completed' | 'bye';
}

export interface TournamentState {
  id: string;
  hostId: string;
  joinCode: string;
  size: 4 | 8;
  status: 'lobby' | 'in_progress' | 'completed';
  winnerId: string | null;
  participants: { userId: string; username: string; seed: number | null }[];
  matches: TournamentMatchInfo[];
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
