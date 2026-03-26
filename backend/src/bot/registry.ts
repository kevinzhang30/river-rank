import { supabaseAdmin } from "../db/supabaseAdmin";

// ── Types ────────────────────────────────────────────────────────────────────

export type BotStyle = "tight" | "loose" | "balanced" | "aggro";

export interface BotProfile {
  id: string;
  username: string;
  elo: number;
  country: string | null;
  style: BotStyle;
  enabled: boolean;
  rankedEnabled: boolean;
  unrankedEnabled: boolean;
  lastUsedAt: Date | null;
  aggression: number;
  bluffFrequency: number;
  looseness: number;
  // Elite bot fields (optional — undefined for regular bots)
  isElite?: boolean;
  threeBetFreq?: number;
  blindDefenseBonus?: number;
  shortStackAggression?: number;
  trapFrequency?: number;
  doubleBarrelFreq?: number;
}

// ── In-memory registry ──────────────────────────────────────────────────────

const botIds = new Set<string>();
let botsByElo: BotProfile[] = [];

// Anti-repeat: userId → last 5 bot IDs faced (in-memory only for Phase 1)
const recentBotOpponents = new Map<string, string[]>();

const MAX_RECENT = 5;

// ── Public API ──────────────────────────────────────────────────────────────

export async function loadBotRegistry(): Promise<void> {
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from("profiles")
    .select("id, username, elo, country")
    .eq("is_bot", true);

  if (profilesError) throw profilesError;

  const { data: configs, error: configsError } = await supabaseAdmin
    .from("bot_config")
    .select("id, style, aggression, bluff_frequency, looseness, enabled, ranked_enabled, unranked_enabled, last_used_at, is_elite, three_bet_freq, blind_defense_bonus, short_stack_aggression, trap_frequency, double_barrel_freq");

  if (configsError) throw configsError;

  const configMap = new Map(
    (configs ?? []).map((c: any) => [c.id, c]),
  );

  botIds.clear();
  const loaded: BotProfile[] = [];

  for (const bot of profiles ?? []) {
    botIds.add(bot.id);
    const cfg = configMap.get(bot.id);
    loaded.push({
      id: bot.id,
      username: bot.username ?? "Bot",
      elo: bot.elo,
      country: bot.country ?? null,
      style: (cfg?.style as BotStyle) ?? "balanced",
      enabled: cfg?.enabled ?? true,
      rankedEnabled: cfg?.ranked_enabled ?? true,
      unrankedEnabled: cfg?.unranked_enabled ?? true,
      lastUsedAt: cfg?.last_used_at ? new Date(cfg.last_used_at) : null,
      aggression: cfg?.aggression ?? 0.5,
      bluffFrequency: cfg?.bluff_frequency ?? 0.1,
      looseness: cfg?.looseness ?? 0.5,
      isElite: cfg?.is_elite ?? false,
      threeBetFreq: cfg?.three_bet_freq ?? undefined,
      blindDefenseBonus: cfg?.blind_defense_bonus ?? undefined,
      shortStackAggression: cfg?.short_stack_aggression ?? undefined,
      trapFrequency: cfg?.trap_frequency ?? undefined,
      doubleBarrelFreq: cfg?.double_barrel_freq ?? undefined,
    });
  }

  // Sort by Elo ascending for matching
  loaded.sort((a, b) => a.elo - b.elo);
  botsByElo = loaded;

  console.log(`[bot-registry] loaded ${botsByElo.length} bots`);
}

export function isBot(userId: string): boolean {
  return botIds.has(userId);
}

export function getBotProfile(userId: string): BotProfile | null {
  return botsByElo.find((b) => b.id === userId) ?? null;
}

/**
 * Find a bot whose Elo is within ±200 of the target, excluding recently
 * faced bots. Prefers bots closest in Elo, with tie-breaking on least
 * recently used.
 */
export function findBotByElo(
  targetElo: number,
  userId: string,
  mode: "ranked" | "unranked" | "bullet",
): BotProfile | null {
  const recent = recentBotOpponents.get(userId) ?? [];
  const recentSet = new Set(recent);
  const isRanked = mode === "ranked";

  // Filter candidates
  const candidates = botsByElo.filter((b) => {
    if (!b.enabled) return false;
    if (recentSet.has(b.id)) return false;
    if (isRanked && !b.rankedEnabled) return false;
    if (!isRanked && !b.unrankedEnabled) return false;
    // Elo range guard: low-tier bots excluded for high-Elo players
    if (b.elo < 950 && targetElo > 1400) return false;
    // Within ±200
    if (Math.abs(b.elo - targetElo) > 200) return false;
    return true;
  });

  if (candidates.length === 0) {
    // Relax: try any enabled bot in range, ignoring recent
    const relaxed = botsByElo.filter((b) => {
      if (!b.enabled) return false;
      if (isRanked && !b.rankedEnabled) return false;
      if (!isRanked && !b.unrankedEnabled) return false;
      if (b.elo < 950 && targetElo > 1400) return false;
      if (Math.abs(b.elo - targetElo) > 200) return false;
      return true;
    });
    if (relaxed.length === 0) return null;
    // Pick closest Elo
    relaxed.sort((a, b) => Math.abs(a.elo - targetElo) - Math.abs(b.elo - targetElo));
    return relaxed[0];
  }

  // Sort by Elo proximity, then by least recently used
  candidates.sort((a, b) => {
    const eloDiff = Math.abs(a.elo - targetElo) - Math.abs(b.elo - targetElo);
    if (eloDiff !== 0) return eloDiff;
    const aTime = a.lastUsedAt?.getTime() ?? 0;
    const bTime = b.lastUsedAt?.getTime() ?? 0;
    return aTime - bTime; // prefer least recently used
  });

  return candidates[0];
}

/**
 * Record that a user just played against a bot (for anti-repeat tracking).
 */
export function recordBotOpponent(userId: string, botId: string): void {
  let recent = recentBotOpponents.get(userId);
  if (!recent) {
    recent = [];
    recentBotOpponents.set(userId, recent);
  }
  recent.push(botId);
  if (recent.length > MAX_RECENT) recent.shift();
}

/**
 * Update a bot's Elo in the in-memory registry after a match.
 * The authoritative Elo lives in the DB (updated by end_match RPC);
 * this keeps the registry cache in sync.
 */
export function updateBotElo(botId: string, newElo: number): void {
  const bot = botsByElo.find((b) => b.id === botId);
  if (!bot) return;
  bot.elo = newElo;
  // Re-sort
  botsByElo.sort((a, b) => a.elo - b.elo);
}

/**
 * Mark a bot as recently used (updates in-memory + fires DB update).
 */
export function markBotUsed(botId: string): void {
  const bot = botsByElo.find((b) => b.id === botId);
  if (bot) bot.lastUsedAt = new Date();

  // Fire-and-forget DB update
  supabaseAdmin
    .from("bot_config")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", botId)
    .then(({ error }) => {
      if (error) console.error("[bot-registry] failed to update lastUsedAt:", error);
    });
}
