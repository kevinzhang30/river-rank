import type { Card, LegalActions } from "../engine/types";
import { bestHand } from "../engine/handEvaluator";
import type { BotProfile } from "./registry";

// ── Hand strength (6-bucket) ────────────────────────────────────────────────

export type HandStrength = "PREMIUM" | "STRONG" | "GOOD" | "MEDIUM" | "WEAK" | "TRASH";

const RANK_VAL: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

function preflopStrength(c1: Card, c2: Card): HandStrength {
  let r1 = RANK_VAL[c1[0]], r2 = RANK_VAL[c2[0]];
  const suited = c1[1] === c2[1];
  if (r1 < r2) { const t = r1; r1 = r2; r2 = t; }

  // Pocket pairs
  if (r1 === r2) {
    if (r1 >= 12) return "PREMIUM"; // QQ+
    if (r1 >= 10) return "STRONG";  // TT-JJ
    if (r1 >= 7)  return "GOOD";    // 77-99
    if (r1 >= 4)  return "MEDIUM";  // 44-66
    return "WEAK";                  // 22-33
  }

  // Ace-high
  if (r1 === 14) {
    if (r2 >= 13 && suited) return "PREMIUM";  // AKs
    if (r2 >= 13) return "STRONG";              // AKo
    if (r2 >= 12 && suited) return "STRONG";    // AQs
    if (r2 >= 12) return "GOOD";                // AQo
    if (r2 >= 11) return "GOOD";                // AJ
    if (r2 >= 10) return "MEDIUM";              // AT
    if (suited)   return "WEAK";                // Axs
    return "TRASH";
  }

  // King-high
  if (r1 === 13) {
    if (r2 >= 12) return "GOOD";                        // KQ
    if (r2 >= 11) return suited ? "GOOD" : "MEDIUM";    // KJ
    if (r2 >= 10 && suited) return "MEDIUM";             // KTs
    return "TRASH";
  }

  // Queen-high
  if (r1 === 12) {
    if (r2 >= 11) return suited ? "MEDIUM" : "WEAK";    // QJ
    if (r2 >= 10 && suited) return "WEAK";               // QTs
    return "TRASH";
  }

  // JT
  if (r1 === 11 && r2 === 10) return suited ? "MEDIUM" : "WEAK";

  // Suited connectors / one-gappers
  if (suited && r1 >= 6 && r1 - r2 <= 2) return "WEAK";

  return "TRASH";
}

function postflopStrength(holeCards: [Card, Card], board: Card[]): HandStrength {
  const rank = bestHand(holeCards, board);
  const cat = rank.category;

  if (cat === "STRAIGHT_FLUSH" || cat === "FOUR_OF_A_KIND" || cat === "FULL_HOUSE") return "PREMIUM";
  if (cat === "FLUSH" || cat === "STRAIGHT") return "STRONG";
  if (cat === "THREE_OF_A_KIND") return "GOOD";
  if (cat === "TWO_PAIR") {
    // Strong two pair (top pair involved) = GOOD, otherwise MEDIUM
    const boardRanks = board.map((c) => RANK_VAL[c[0]]).sort((a, b) => b - a);
    const holeRanks = holeCards.map((c) => RANK_VAL[c[0]]).sort((a, b) => b - a);
    if (holeRanks[0] >= boardRanks[0]) return "GOOD";
    return "MEDIUM";
  }
  if (cat === "ONE_PAIR") {
    // Determine pair type via kicker analysis
    const boardRanks = board.map((c) => RANK_VAL[c[0]]).sort((a, b) => b - a);
    const holeRanks = holeCards.map((c) => RANK_VAL[c[0]]).sort((a, b) => b - a);

    // Check if hole card makes top pair
    const topBoard = boardRanks[0];
    if (holeRanks[0] === topBoard || holeRanks[1] === topBoard) {
      // Top pair — kicker quality matters
      const kicker = holeRanks[0] === topBoard ? holeRanks[1] : holeRanks[0];
      if (kicker >= 11) return "GOOD";    // Top pair + good kicker (J+)
      return "MEDIUM";                     // Top pair + weak kicker
    }

    // Middle or bottom pair
    if (holeRanks.some((r) => r >= boardRanks[1] && boardRanks.includes(r))) return "WEAK";
    return "WEAK";
  }

  return "TRASH"; // HIGH_CARD
}

function evaluateStrength(holeCards: [Card, Card], board: Card[], street: string): HandStrength {
  if (street === "PREFLOP") return preflopStrength(holeCards[0], holeCards[1]);
  return postflopStrength(holeCards, board);
}

// ── Board texture ───────────────────────────────────────────────────────────

type BoardTexture = "dry" | "draw_heavy" | "paired";

function classifyBoard(board: Card[]): BoardTexture {
  if (board.length < 3) return "dry";

  const ranks = board.map((c) => RANK_VAL[c[0]]);
  const suits = board.map((c) => c[1]);

  // Paired board
  const uniqueRanks = new Set(ranks);
  if (uniqueRanks.size < ranks.length) return "paired";

  // Flush draw potential (3+ of same suit)
  const suitCounts = new Map<string, number>();
  for (const s of suits) suitCounts.set(s, (suitCounts.get(s) ?? 0) + 1);
  const maxSuitCount = Math.max(...suitCounts.values());
  if (maxSuitCount >= 3) return "draw_heavy";

  // Straight draw potential (3+ cards within 4-rank span)
  const sorted = [...ranks].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 2; i++) {
    if (sorted[i + 2] - sorted[i] <= 4) return "draw_heavy";
  }

  return "dry";
}

// ── Bot game context ────────────────────────────────────────────────────────

export interface BotGameContext {
  holeCards: [Card, Card];
  board: Card[];
  street: string;
  legal: LegalActions;
  pot: number;
  bigBlind: number;
  heroStack: number;
  villainStack: number;
  wasLastAggressor: boolean;
  selfBetThisStreet: number;
  selfIsInPosition: boolean;
}

// ── Weighted action selection ───────────────────────────────────────────────

interface ActionWeights {
  FOLD: number;
  CHECK: number;
  CALL: number;
  RAISE: number;
}

function sampleAction(weights: ActionWeights): string {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total === 0) return "FOLD";

  let r = Math.random() * total;
  for (const [action, w] of entries) {
    r -= w;
    if (r <= 0) return action;
  }
  return entries[entries.length - 1][0];
}

// ── Decision engine ─────────────────────────────────────────────────────────

export function decideBotAction(
  ctx: BotGameContext,
  profile: BotProfile,
): { action: string; amount?: number } {
  const strength = evaluateStrength(ctx.holeCards, ctx.board, ctx.street);
  const boardTex = classifyBoard(ctx.board);
  const callAmount = ctx.legal.callAmount ?? 0;
  const potOdds = callAmount > 0 ? callAmount / (ctx.pot + callAmount) : 0;

  // Stack depth categories (3-tier)
  const effectiveStack = Math.min(ctx.heroStack, ctx.villainStack);
  const bb = ctx.bigBlind || 20;
  const stackDepth = effectiveStack / bb;
  const isShort = stackDepth < 10;
  const isMedium = stackDepth >= 10 && stackDepth < 25;
  const isDeep = stackDepth >= 25;

  // Profile-derived adjustments
  const { aggression, bluffFrequency, looseness } = profile;

  // Compute action weights based on strength + context
  const weights: ActionWeights = { FOLD: 0, CHECK: 0, CALL: 0, RAISE: 0 };

  if (ctx.legal.canCheck) {
    // Free to act — no bet to call
    switch (strength) {
      case "PREMIUM":
        weights.CHECK = 0.15;
        weights.RAISE = 0.85 * aggression * 2;
        break;
      case "STRONG":
        weights.CHECK = 0.3;
        weights.RAISE = 0.7 * aggression * 1.5;
        break;
      case "GOOD":
        weights.CHECK = 0.5;
        weights.RAISE = 0.5 * aggression;
        break;
      case "MEDIUM":
        weights.CHECK = 0.7;
        weights.RAISE = 0.3 * aggression;
        break;
      case "WEAK":
        weights.CHECK = 0.85;
        weights.RAISE = bluffFrequency * 0.5; // small bluff chance
        break;
      case "TRASH":
        weights.CHECK = 0.9;
        weights.RAISE = bluffFrequency * 0.3;
        break;
    }

    // Board texture adjustments
    if (boardTex === "draw_heavy" && (strength === "GOOD" || strength === "STRONG")) {
      weights.RAISE *= 1.3; // bet to protect on draw-heavy boards
    }
    if (boardTex === "dry" && strength === "PREMIUM") {
      weights.CHECK *= 1.5; // slow-play more on dry boards
    }
  } else {
    // Facing a bet
    switch (strength) {
      case "PREMIUM":
        weights.CALL = 0.2;
        weights.RAISE = 0.8 * aggression * 2;
        break;
      case "STRONG":
        weights.CALL = 0.5;
        weights.RAISE = 0.5 * aggression * 1.5;
        break;
      case "GOOD":
        weights.CALL = 0.6;
        weights.RAISE = 0.25 * aggression;
        weights.FOLD = potOdds > 0.4 ? 0.15 : 0;
        break;
      case "MEDIUM":
        if (potOdds < 0.3) {
          weights.CALL = 0.6 * looseness * 2;
          weights.FOLD = 0.4 * (1 - looseness);
        } else {
          weights.CALL = 0.3 * looseness * 2;
          weights.FOLD = 0.7 * (1 - looseness);
        }
        weights.RAISE = bluffFrequency * 0.2;
        break;
      case "WEAK":
        if (potOdds < 0.15) {
          weights.CALL = 0.3 * looseness;
          weights.FOLD = 0.7;
        } else {
          weights.CALL = 0.1 * looseness;
          weights.FOLD = 0.8;
        }
        weights.RAISE = bluffFrequency * 0.4; // bluff raise
        break;
      case "TRASH":
        weights.FOLD = 0.85;
        weights.CALL = 0.05 * looseness;
        weights.RAISE = bluffFrequency * 0.5; // bluff raise
        break;
    }

    // ── Stack commitment: prevent embarrassing folds when already invested ──
    if (ctx.street === "PREFLOP" && ctx.selfBetThisStreet > 0) {
      const totalStack = ctx.selfBetThisStreet + ctx.heroStack;
      if (totalStack > 0) {
        const commitRatio = ctx.selfBetThisStreet / totalStack;
        if (commitRatio >= 0.25 && strength !== "TRASH") {
          weights.FOLD *= Math.max(0.1, 1 - commitRatio * 2);
          weights.CALL = Math.max(weights.CALL, 0.5);
        }
      }
    }

    // ── Preflop defense vs small raises ──
    if (ctx.street === "PREFLOP" && callAmount > 0 && !ctx.legal.canCheck) {
      const raiseSize = callAmount / bb;
      // Only defend when raise is small both in bb terms and relative to stack
      if (raiseSize <= 3 && callAmount / ctx.heroStack < 0.15 && strength !== "TRASH") {
        weights.FOLD *= 0.6;
        weights.CALL *= 1.3;
      }
    }

    // ── Short-stack push/fold widening ──
    if (isShort) {
      if (strength === "GOOD" || strength === "STRONG" || strength === "PREMIUM") {
        weights.RAISE *= 2.0;
        weights.FOLD *= 0.2;
        weights.CALL = Math.max(weights.CALL, 0.6);
      }
      if (strength === "MEDIUM") {
        weights.FOLD *= 0.2;
        weights.RAISE *= 2.0;
        weights.CALL = Math.max(weights.CALL, 0.6);
      }
      if (stackDepth < 5 && strength === "WEAK") {
        weights.FOLD *= 0.3;
        weights.CALL = Math.max(weights.CALL, 0.4);
      }
    }

    // Previous aggressor check: if villain has been betting and we have a marginal hand, fold more
    if (ctx.wasLastAggressor && (strength === "WEAK" || strength === "TRASH")) {
      weights.FOLD *= 1.3;
    }

    // Deep stacks: play tighter with marginal hands
    if (isDeep && (strength === "MEDIUM" || strength === "WEAK")) {
      weights.FOLD *= 1.2;
      weights.CALL *= 0.8;
    }
  }

  // ── All-in defense: facing a huge bet, tighten up with decent hands ──
  if (!ctx.legal.canCheck && callAmount > 0) {
    const betToStackRatio = callAmount / (ctx.heroStack + callAmount);
    const isAllIn = callAmount >= ctx.heroStack; // calling costs entire stack

    if (isAllIn || betToStackRatio > 0.5) {
      // Facing all-in or pot-committing bet: strong+ hands should never fold
      if (strength === "PREMIUM" || strength === "STRONG") {
        weights.FOLD = 0;
        weights.CALL = Math.max(weights.CALL, 1);
      } else if (strength === "GOOD") {
        weights.FOLD *= 0.3;
        weights.CALL = Math.max(weights.CALL, 0.5);
      } else if (strength === "MEDIUM") {
        // Medium hands: consider pot odds more carefully against all-ins
        weights.FOLD *= 0.7;
        weights.CALL = Math.max(weights.CALL, 0.3 * looseness);
      }
      // Weak/trash: folding to all-ins is fine (unless it means match loss — handled below)
    }
  }

  // ── Elite bot modifiers ──────────────────────────────────────────────────
  // These only activate when the elite-specific config fields are set.

  // Three-bet frequency: re-raise more often preflop
  if (profile.threeBetFreq != null && ctx.street === "PREFLOP" && !ctx.legal.canCheck) {
    if (strength === "PREMIUM" || strength === "STRONG") {
      weights.RAISE *= (1 + profile.threeBetFreq * 2);
    } else if (strength === "GOOD" || strength === "MEDIUM") {
      weights.RAISE += profile.threeBetFreq * 0.3;
      weights.FOLD *= (1 - profile.threeBetFreq * 0.3);
    }
  }

  // Blind defense bonus: defend wider from BB
  if (profile.blindDefenseBonus != null && ctx.street === "PREFLOP" && !ctx.selfIsInPosition && !ctx.legal.canCheck) {
    weights.FOLD *= (1 - profile.blindDefenseBonus);
    weights.CALL *= (1 + profile.blindDefenseBonus * 0.5);
    if (strength === "GOOD" || strength === "STRONG" || strength === "PREMIUM") {
      weights.RAISE *= (1 + profile.blindDefenseBonus * 0.5);
    }
  }

  // Short-stack aggression: push harder when short-stacked
  if (profile.shortStackAggression != null && isShort) {
    if (strength !== "TRASH") {
      weights.RAISE *= (1 + profile.shortStackAggression * 2);
      weights.FOLD *= (1 - profile.shortStackAggression * 0.7);
    }
    if (strength === "TRASH") {
      weights.RAISE += profile.shortStackAggression * bluffFrequency * 2;
    }
  }

  // Trap frequency: slow-play strong hands (flop/turn only, capped, reduced on draw-heavy)
  if (profile.trapFrequency != null && ctx.legal.canCheck) {
    if ((strength === "PREMIUM" || strength === "STRONG") &&
        (ctx.street === "FLOP" || ctx.street === "TURN")) {
      const trapInfluence = boardTex === "draw_heavy"
        ? Math.min(profile.trapFrequency, 0.7) * 0.5
        : Math.min(profile.trapFrequency, 0.7);
      weights.CHECK *= (1 + trapInfluence * 2);
      weights.RAISE *= (1 - trapInfluence * 0.4);
    }
  }

  // Double-barrel frequency: continue aggression on flop/turn
  if (profile.doubleBarrelFreq != null && ctx.wasLastAggressor && ctx.legal.canCheck) {
    if (ctx.street === "FLOP" || ctx.street === "TURN") {
      if (strength === "GOOD" || strength === "MEDIUM") {
        weights.RAISE *= (1 + profile.doubleBarrelFreq * 1.5);
        weights.CHECK *= (1 - profile.doubleBarrelFreq * 0.3);
      }
      if (strength === "WEAK" || strength === "TRASH") {
        weights.RAISE += profile.doubleBarrelFreq * bluffFrequency * 1.5;
      }
    }
  }

  // ── Never fold into match loss ──
  // If folding would leave the bot with 0 chips (losing the match), always call instead
  if (weights.FOLD > 0 && ctx.heroStack <= callAmount) {
    weights.FOLD = 0;
    weights.CALL = Math.max(weights.CALL, 1);
  }

  // Remove illegal actions
  if (!ctx.legal.canCheck) weights.CHECK = 0;
  if (!ctx.legal.canCall) weights.CALL = 0;
  if (!ctx.legal.canFold) weights.FOLD = 0;
  if (!ctx.legal.minRaiseTo || !ctx.legal.maxRaiseTo) weights.RAISE = 0;

  // Ensure at least one action has weight
  const totalWeight = weights.FOLD + weights.CHECK + weights.CALL + weights.RAISE;
  if (totalWeight === 0) {
    if (ctx.legal.canCheck) return { action: "CHECK" };
    if (ctx.legal.canCall) return { action: "CALL" };
    return { action: "FOLD" };
  }

  const action = sampleAction(weights);

  if (action === "RAISE" && ctx.legal.minRaiseTo && ctx.legal.maxRaiseTo) {
    const raiseAmount = computeRaiseAmount(
      ctx, strength, profile, isShort, isMedium,
    );
    return { action: "RAISE_TO", amount: raiseAmount };
  }

  return { action };
}

// ── Raise sizing ────────────────────────────────────────────────────────────

function computeRaiseAmount(
  ctx: BotGameContext,
  strength: HandStrength,
  profile: BotProfile,
  isShort: boolean,
  isMedium: boolean,
): number {
  const min = ctx.legal.minRaiseTo!;
  const max = ctx.legal.maxRaiseTo!;

  // Short stacks: tend to shove
  if (isShort && (strength === "PREMIUM" || strength === "STRONG" || strength === "GOOD")) {
    return max; // all-in
  }

  // Medium stacks (10-25bb): prefer 2.2-2.5x raises to apply pressure
  if (isMedium && (strength === "PREMIUM" || strength === "STRONG")) {
    const target = Math.round(ctx.bigBlind * 2.3);
    return Math.min(Math.max(target, min), max);
  }

  // Size based on hand strength and aggression
  const { aggression } = profile;
  let potFraction: number;
  switch (strength) {
    case "PREMIUM":
      potFraction = 0.7 + aggression * 0.3; // 70-100% pot
      break;
    case "STRONG":
      potFraction = 0.6 + aggression * 0.2; // 60-80% pot
      break;
    case "GOOD":
      potFraction = 0.5 + aggression * 0.15; // 50-65% pot
      break;
    default:
      // Bluffs: vary more to be unpredictable
      potFraction = 0.4 + Math.random() * 0.3; // 40-70% pot
      break;
  }

  const target = Math.round(min + ctx.pot * potFraction);
  // Add small randomness (±10%)
  const jitter = Math.round(target * (0.9 + Math.random() * 0.2));
  return Math.min(Math.max(jitter, min), max);
}
