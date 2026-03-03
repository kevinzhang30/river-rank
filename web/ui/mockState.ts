import type { PublicGameState } from "./types";

// PhilIvey bet $30 on the flop. Hero (dealer) is next to act.
const now = new Date().toISOString();

export const mockHeroHoleCards: [string, string] = ["Ah", "Kd"];

export const mockState: PublicGameState = {
  matchId: "a3f9b1c2-dead-beef-cafe-123456789abc",
  mode: "ranked",
  street: "flop",
  pot: 160,
  board: ["Ts", "7h", "2c"],
  players: [
    {
      userId: "opp-1",
      username: "PhilIvey",
      stack: 870,
      bet: 30,
      isDealer: false,
      isToAct: false,
      folded: false,
    },
    {
      userId: "hero-1",
      username: "You",
      stack: 970,
      bet: 0,
      isDealer: true,
      isToAct: true,
      folded: false,
    },
  ],
  log: [
    { username: "You",      action: "post",  amount: 10, at: now },
    { username: "PhilIvey", action: "post",  amount: 20, at: now },
    { username: "You",      action: "call",  amount: 20, at: now },
    { username: "PhilIvey", action: "check",             at: now },
    { username: "PhilIvey", action: "bet",   amount: 30, at: now },
  ],
  handNumber: 1,
  smallBlind: 10,
  bigBlind: 20,
};
