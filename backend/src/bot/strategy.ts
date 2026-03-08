import type { Card, LegalActions } from "../engine/types";
import { bestHand } from "../engine/handEvaluator";

// ── Difficulty ────────────────────────────────────────────────────────────────

export type BotDifficulty = "easy" | "medium" | "hard";

interface BotConfig {
  strongRaiseFreq:  number; // probability to raise when holding a strong hand
  bluffFreq:        number; // probability to bluff-raise with a weak hand
  potOddsThreshold: number; // fold medium hand if pot odds exceed this
  callLooseness:    number; // fraction of marginal hands that call vs fold
}

const BOT_CONFIGS: Record<BotDifficulty, BotConfig> = {
  easy:   { strongRaiseFreq: 0.15, bluffFreq: 0.00, potOddsThreshold: 0.45, callLooseness: 0.85 },
  medium: { strongRaiseFreq: 0.35, bluffFreq: 0.08, potOddsThreshold: 0.30, callLooseness: 0.55 },
  hard:   { strongRaiseFreq: 0.55, bluffFreq: 0.18, potOddsThreshold: 0.20, callLooseness: 0.35 },
};

// ── Hand strength ─────────────────────────────────────────────────────────────

type HandStrength = "STRONG" | "MEDIUM" | "WEAK" | "TRASH";

const RANK_VAL: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

/** Classify preflop hand strength using a 4-bucket lookup. */
function preflopStrength(c1: Card, c2: Card): HandStrength {
  let r1 = RANK_VAL[c1[0]], r2 = RANK_VAL[c2[0]];
  const suited = c1[1] === c2[1];
  if (r1 < r2) { const t = r1; r1 = r2; r2 = t; }

  // Pocket pairs
  if (r1 === r2) {
    if (r1 >= 10) return "STRONG"; // TT+
    if (r1 >= 7)  return "MEDIUM"; // 77-99
    if (r1 >= 5)  return "WEAK";   // 55-66
    return "TRASH";                // 22-44
  }

  if (r1 === 14) { // Ace-high
    if (r2 >= 13)          return "STRONG";                   // AK
    if (r2 >= 11)          return "MEDIUM";                   // AQ, AJ
    if (r2 >= 10)          return suited ? "MEDIUM" : "WEAK"; // AT
    if (r2 >= 6 && suited) return "WEAK";                     // A6s-A9s
    return "TRASH";
  }

  if (r1 === 13) { // King-high
    if (r2 >= 12)          return "MEDIUM";                   // KQ
    if (r2 >= 11)          return suited ? "MEDIUM" : "WEAK"; // KJ
    if (r2 >= 10 && suited) return "WEAK";                    // KTs
    return "TRASH";
  }

  if (r1 === 12) { // Queen-high
    if (r2 >= 11)          return suited ? "MEDIUM" : "WEAK"; // QJ
    if (r2 >= 10 && suited) return "WEAK";                    // QTs
    return "TRASH";
  }

  if (r1 === 11 && r2 === 10) return suited ? "WEAK" : "TRASH"; // JT

  // Suited connectors and one-gappers
  if (suited && r1 >= 6 && r1 - r2 <= 2) return "WEAK";

  return "TRASH";
}

const POSTFLOP_STRENGTH: Record<string, HandStrength> = {
  STRAIGHT_FLUSH:  "STRONG",
  FOUR_OF_A_KIND:  "STRONG",
  FULL_HOUSE:      "STRONG",
  FLUSH:           "STRONG",
  STRAIGHT:        "STRONG",
  THREE_OF_A_KIND: "MEDIUM",
  TWO_PAIR:        "MEDIUM",
  ONE_PAIR:        "WEAK",
  HIGH_CARD:       "TRASH",
};

function evaluateStrength(holeCards: [Card, Card], board: Card[], street: string): HandStrength {
  if (street === "PREFLOP") return preflopStrength(holeCards[0], holeCards[1]);
  const rank = bestHand(holeCards, board);
  return POSTFLOP_STRENGTH[rank.category] ?? "TRASH";
}

// ── Decision function ─────────────────────────────────────────────────────────

export function decideBotAction(
  holeCards:  [Card, Card],
  board:      Card[],
  street:     string,
  legal:      LegalActions,
  pot:        number,
  bigBlind:   number,
  difficulty: BotDifficulty,
): { action: string; amount?: number } {
  const cfg      = BOT_CONFIGS[difficulty];
  const strength = evaluateStrength(holeCards, board, street);

  const callAmount = legal.callAmount ?? 0;
  const potOdds    = callAmount > 0 ? callAmount / (pot + callAmount) : 0;

  const tryRaise = (): { action: string; amount: number } | null => {
    if (!legal.minRaiseTo || !legal.maxRaiseTo) return null;
    // Target ~75% pot raise; clamp to [minRaiseTo, maxRaiseTo]
    const target = Math.round(legal.minRaiseTo + pot * 0.75);
    const cap    = Math.min(Math.max(target, legal.minRaiseTo), legal.maxRaiseTo);
    const amount = Math.round(legal.minRaiseTo + Math.random() * (cap - legal.minRaiseTo));
    return { action: "RAISE_TO", amount };
  };

  // Free to check — consider raising with strong hands, otherwise check
  if (legal.canCheck) {
    if (strength === "STRONG" && Math.random() < cfg.strongRaiseFreq) {
      const r = tryRaise();
      if (r) return r;
    }
    return { action: "CHECK" };
  }

  // Facing a bet
  if (strength === "STRONG") {
    if (Math.random() < cfg.strongRaiseFreq) {
      const r = tryRaise();
      if (r) return r;
    }
    return { action: "CALL" };
  }

  if (strength === "MEDIUM") {
    if (potOdds < cfg.potOddsThreshold) return { action: "CALL" };
    // Bad pot odds: fold with probability (1 - callLooseness)
    if (Math.random() < 1 - cfg.callLooseness) return { action: "FOLD" };
    return { action: "CALL" };
  }

  // WEAK: call with very favorable pot odds, otherwise fold (or bluff)
  if (strength === "WEAK") {
    if (Math.random() < cfg.bluffFreq) {
      const r = tryRaise();
      if (r) return r;
    }
    if (potOdds > 0 && potOdds < cfg.potOddsThreshold * 0.5) return { action: "CALL" };
    return { action: "FOLD" };
  }

  // TRASH: bluff or fold
  if (Math.random() < cfg.bluffFreq) {
    const r = tryRaise();
    if (r) return r;
  }
  return { action: "FOLD" };
}
