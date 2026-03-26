/**
 * Bot Seed Script — creates ~1000 bot accounts via Supabase Admin API.
 *
 * Notes:
 * - Bots are created as real auth users so profile/auth integrity stays intact.
 * - Safe to re-run:
 *   - deterministic bot emails
 *   - existing bot auth users are reused
 *   - profiles + bot_config are updated on every run
 *
 * Usage:
 *   npx tsx backend/src/bot/seed.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type BotStyle = "tight" | "loose" | "balanced" | "aggro";
type BotTier = "bronze" | "silver" | "gold" | "platinum" | "diamond";

interface BotDef {
  slug: string;
  username: string;
  elo: number;
  style: BotStyle;
  aggression: number;
  bluffFrequency: number;
  looseness: number;
  country: string;
  wins: number;
  losses: number;
}

interface TierConfig {
  tier: BotTier;
  count: number;
  eloMin: number;
  eloMax: number;
  styleWeights: [number, number, number, number]; // [tight, loose, balanced, aggro]
  gamesBase: number;
  gamesExtraRange: [number, number];
  winRateRange: [number, number];
  variation: number;
}

const STYLE_PARAMS: Record<
  BotStyle,
  { aggression: number; bluffFrequency: number; looseness: number }
> = {
  tight: { aggression: 0.3, bluffFrequency: 0.05, looseness: 0.2 },
  loose: { aggression: 0.4, bluffFrequency: 0.12, looseness: 0.7 },
  balanced: { aggression: 0.5, bluffFrequency: 0.1, looseness: 0.45 },
  aggro: { aggression: 0.8, bluffFrequency: 0.2, looseness: 0.4 },
};

// ── Word Lists ──────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  "mason", "riley", "jordan", "alex", "casey", "taylor", "morgan", "jamie",
  "quinn", "drew", "blake", "avery", "reese", "skyler", "devon", "kai",
  "sage", "rowan", "river", "phoenix", "hayden", "parker", "logan", "cameron",
  "charlie", "finley", "emery", "lennox", "micah", "elliot", "harley", "remy",
  "dallas", "frankie", "sam", "max", "leo", "noah", "liam", "ethan",
  "oliver", "lucas", "henry", "jack", "owen", "caleb", "wyatt", "luke",
  "nate", "ryan", "cole", "seth", "dean", "grant", "trey", "kent",
  "bryce", "dane", "reed", "finn", "shane", "troy", "wade", "zane",
  "nina", "elena", "kira", "mila", "zara", "dani", "sarah", "maya",
  "lena", "rosa", "aria", "isla", "jade", "cleo", "vera", "luna",
];

const ADJECTIVES = [
  "cold", "dark", "red", "blue", "iron", "gold", "swift", "gray",
  "sharp", "bold", "deep", "bright", "raw", "flat", "dry", "warm",
  "high", "low", "long", "true", "old", "new", "wild", "calm",
  "cool", "pale", "thin", "wide", "full", "last", "lone", "prime",
  "keen", "rare", "pure", "soft", "faint", "stark", "brisk", "grim",
];

const NOUNS = [
  "ridge", "creek", "mesa", "harbor", "grove", "vale", "peak", "bluff",
  "flint", "cairn", "dusk", "mist", "haze", "frost", "storm", "cliff",
  "stone", "ember", "ash", "pine", "birch", "cedar", "maple", "oak",
  "hawk", "wolf", "bear", "fox", "lynx", "crane", "raven", "elk",
  "shore", "cove", "bay", "reef", "tide", "surf", "sand", "dune",
];

const HANDLE_SUFFIXES = [
  "x", "v", "z", "jr", "99", "77", "42", "88", "21", "7",
  "00", "11", "33", "xo", "gg", "tv", "yy", "hq", "go", "io",
  "up", "ez", "on", "fx", "ly",
];

const POKER_WORDS = [
  "river", "flop", "ace", "call", "fold", "bluff", "raise", "check",
  "pot", "nuts", "draw", "flush", "straight", "pocket", "blind", "ante",
  "stack", "tilt", "snap", "value",
];

const POKER_MODIFIERS = [
  "kid", "pro", "king", "fish", "shark", "rat", "dog", "cat", "nit", "boss",
];

const PREMIUM_ADJECTIVES = [
  "iron", "silver", "cold", "sharp", "dark", "swift", "stone", "black", "north", "frost",
];

const PREMIUM_NOUNS = [
  "ridge", "peak", "glacier", "summit", "axiom", "spectra", "zenith", "veil", "tower", "gate",
];

// ── Country Weights ─────────────────────────────────────────────────────────

const COUNTRY_WEIGHTS: [string, number][] = [
  ["US", 20], ["CA", 10], ["GB", 10], ["AU", 8], ["DE", 8], ["FR", 8],
  ["BR", 5], ["IN", 5], ["JP", 4], ["KR", 4],
  ["NL", 3], ["SE", 3], ["CH", 3], ["MX", 3], ["PH", 3], ["NO", 2],
];

const COUNTRY_TOTAL_WEIGHT = COUNTRY_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

function pickCountry(index: number): string {
  const r = seededFraction(`country:${index}`) * COUNTRY_TOTAL_WEIGHT;
  let cumulative = 0;
  for (const [code, weight] of COUNTRY_WEIGHTS) {
    cumulative += weight;
    if (r < cumulative) return code;
  }
  return COUNTRY_WEIGHTS[COUNTRY_WEIGHTS.length - 1][0];
}

// ── Tier Configuration ──────────────────────────────────────────────────────

const TIERS: TierConfig[] = [
  {
    tier: "bronze",
    count: 150,
    eloMin: 700,
    eloMax: 950,
    styleWeights: [15, 40, 30, 15],
    gamesBase: 50,
    gamesExtraRange: [10, 80],
    winRateRange: [0.32, 0.44],
    variation: 0.10,
  },
  {
    tier: "silver",
    count: 350,
    eloMin: 950,
    eloMax: 1200,
    styleWeights: [20, 25, 40, 15],
    gamesBase: 60,
    gamesExtraRange: [10, 80],
    winRateRange: [0.44, 0.51],
    variation: 0.08,
  },
  {
    tier: "gold",
    count: 300,
    eloMin: 1200,
    eloMax: 1450,
    styleWeights: [30, 15, 35, 20],
    gamesBase: 80,
    gamesExtraRange: [10, 80],
    winRateRange: [0.49, 0.56],
    variation: 0.06,
  },
  {
    tier: "platinum",
    count: 160,
    eloMin: 1450,
    eloMax: 1600,
    styleWeights: [35, 10, 35, 20],
    gamesBase: 100,
    gamesExtraRange: [15, 85],
    winRateRange: [0.53, 0.60],
    variation: 0.04,
  },
  {
    tier: "diamond",
    count: 40,
    eloMin: 1600,
    eloMax: 1700,
    styleWeights: [40, 5, 40, 15],
    gamesBase: 120,
    gamesExtraRange: [20, 90],
    winRateRange: [0.56, 0.64],
    variation: 0.02,
  },
];

// ── Seeded RNG Helpers ──────────────────────────────────────────────────────

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededFraction(seed: string): number {
  return hashString(seed) / 0xffffffff;
}

function seededInt(seed: string, min: number, max: number): number {
  const value = seededFraction(seed);
  return Math.floor(min + value * (max - min + 1));
}

function seededRange(seed: string, min: number, max: number): number {
  return min + seededFraction(seed) * (max - min);
}

function seededBellFraction(seed: string): number {
  const a = seededFraction(seed + ":a");
  const b = seededFraction(seed + ":b");
  const c = seededFraction(seed + ":c");
  return (a + b + c) / 3;
}

// ── Username Generator ──────────────────────────────────────────────────────

function generateUsername(
  index: number,
  tier: BotTier,
  usedSlugs: Set<string>,
): { slug: string; username: string } {
  const maxRetries = 10;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const seedBase = attempt === 0 ? `${index}` : `${index}:retry${attempt}`;
    const patternRoll = seededFraction(`pattern:${seedBase}`);

    let raw: string;

    if (tier === "diamond") {
      // Diamond tier: exclusively premium Pattern B/C
      if (patternRoll < 0.5) {
        const adj = PREMIUM_ADJECTIVES[seededInt(`dadj:${seedBase}`, 0, PREMIUM_ADJECTIVES.length - 1)];
        const noun = PREMIUM_NOUNS[seededInt(`dnoun:${seedBase}`, 0, PREMIUM_NOUNS.length - 1)];
        raw = adj + noun;
      } else {
        const adj = PREMIUM_ADJECTIVES[seededInt(`dhadj:${seedBase}`, 0, PREMIUM_ADJECTIVES.length - 1)];
        const noun = PREMIUM_NOUNS[seededInt(`dhnoun:${seedBase}`, 0, PREMIUM_NOUNS.length - 1)];
        const sep = seededFraction(`dsep:${seedBase}`) < 0.5 ? "_" : "";
        raw = adj + sep + noun;
      }
    } else if (patternRoll < 0.40) {
      // Pattern A: firstName + number
      const name = FIRST_NAMES[seededInt(`fname:${seedBase}`, 0, FIRST_NAMES.length - 1)];
      const num = seededInt(`fnum:${seedBase}`, 1, 99);
      raw = name + num;
    } else if (patternRoll < 0.75) {
      // Pattern B: adjective + noun
      const adj = ADJECTIVES[seededInt(`adj:${seedBase}`, 0, ADJECTIVES.length - 1)];
      const noun = NOUNS[seededInt(`noun:${seedBase}`, 0, NOUNS.length - 1)];
      raw = adj + noun;
    } else if (patternRoll < 0.95) {
      // Pattern C: handle style (name_suffix or adj+noun)
      const handleRoll = seededFraction(`handle:${seedBase}`);
      if (handleRoll < 0.5) {
        const name = FIRST_NAMES[seededInt(`hname:${seedBase}`, 0, FIRST_NAMES.length - 1)];
        const suffix = HANDLE_SUFFIXES[seededInt(`hsuf:${seedBase}`, 0, HANDLE_SUFFIXES.length - 1)];
        raw = name + "_" + suffix;
      } else {
        const adj = ADJECTIVES[seededInt(`hadj:${seedBase}`, 0, ADJECTIVES.length - 1)];
        const noun = NOUNS[seededInt(`hnoun:${seedBase}`, 0, NOUNS.length - 1)];
        raw = adj + noun;
      }
    } else {
      // Pattern D: poker-themed (~5%)
      const word = POKER_WORDS[seededInt(`pword:${seedBase}`, 0, POKER_WORDS.length - 1)];
      const mod = POKER_MODIFIERS[seededInt(`pmod:${seedBase}`, 0, POKER_MODIFIERS.length - 1)];
      raw = word + mod;
    }

    const slug = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!usedSlugs.has(slug)) {
      usedSlugs.add(slug);
      return { slug, username: raw };
    }
  }

  // Fallback: guaranteed unique
  const fallback = `bot${index}`;
  usedSlugs.add(fallback);
  return { slug: fallback, username: fallback };
}

// ── Style & Param Functions ─────────────────────────────────────────────────

const STYLES: BotStyle[] = ["tight", "loose", "balanced", "aggro"];

function pickStyle(index: number, styleWeights: [number, number, number, number]): BotStyle {
  const total = styleWeights[0] + styleWeights[1] + styleWeights[2] + styleWeights[3];
  const r = seededFraction(`style:${index}`) * total;
  let cumulative = 0;
  for (let i = 0; i < 4; i++) {
    cumulative += styleWeights[i];
    if (r < cumulative) return STYLES[i];
  }
  return STYLES[3];
}

function varyParam(base: number, seed: string, maxDelta: number): number {
  const delta = seededRange(seed, -maxDelta, maxDelta);
  return clamp01(base + delta);
}

function computeStyleParams(
  style: BotStyle,
  tier: BotTier,
  index: number,
  variation: number,
): { aggression: number; bluffFrequency: number; looseness: number } {
  let { aggression, bluffFrequency, looseness } = STYLE_PARAMS[style];

  // Tier-level shifts
  switch (tier) {
    case "bronze":
      looseness += 0.10;
      aggression -= 0.05;
      break;
    case "silver":
      break;
    case "gold":
      looseness -= 0.05;
      aggression += 0.03;
      break;
    case "platinum":
      looseness -= 0.08;
      aggression += 0.05;
      break;
    case "diamond":
      looseness -= 0.10;
      aggression += 0.08;
      bluffFrequency += 0.03;
      break;
  }

  // Per-bot jitter
  aggression = varyParam(aggression, `agg:${index}`, variation);
  bluffFrequency = varyParam(bluffFrequency, `bluff:${index}`, variation);
  looseness = varyParam(looseness, `loose:${index}`, variation);

  return { aggression, bluffFrequency, looseness };
}

// ── Win/Loss Generator ──────────────────────────────────────────────────────

function genWinLoss(
  slug: string,
  tierConfig: TierConfig,
): { wins: number; losses: number } {
  const gamesExtra = seededInt(
    `${slug}:games`,
    tierConfig.gamesExtraRange[0],
    tierConfig.gamesExtraRange[1],
  );
  const gamesPlayed = tierConfig.gamesBase + gamesExtra;

  const winRate = seededRange(
    `${slug}:winrate`,
    tierConfig.winRateRange[0],
    tierConfig.winRateRange[1],
  );
  const wins = Math.round(gamesPlayed * winRate);
  const losses = gamesPlayed - wins;

  return { wins, losses };
}

// ── Uniqueness Check ────────────────────────────────────────────────────────

function assertUniqueBots(bots: BotDef[]): void {
  const slugs = new Set<string>();
  const usernames = new Set<string>();

  for (const bot of bots) {
    if (slugs.has(bot.slug)) {
      throw new Error(`Duplicate bot slug: ${bot.slug}`);
    }
    if (usernames.has(bot.username.toLowerCase())) {
      throw new Error(`Duplicate bot username: ${bot.username}`);
    }
    slugs.add(bot.slug);
    usernames.add(bot.username.toLowerCase());
  }
}

// ── Build Bots ──────────────────────────────────────────────────────────────

function buildBots(): BotDef[] {
  const bots: BotDef[] = [];
  const usedSlugs = new Set<string>();
  let globalIndex = 0;

  for (const tierConfig of TIERS) {
    for (let i = 0; i < tierConfig.count; i++) {
      const { slug, username } = generateUsername(globalIndex, tierConfig.tier, usedSlugs);

      const bellFrac = seededBellFraction(`elo:${globalIndex}`);
      const rawElo = tierConfig.eloMin + bellFrac * (tierConfig.eloMax - tierConfig.eloMin);
      const elo = Math.min(1700, Math.round(rawElo));

      const style = pickStyle(globalIndex, tierConfig.styleWeights);
      const params = computeStyleParams(style, tierConfig.tier, globalIndex, tierConfig.variation);
      const country = pickCountry(globalIndex);
      const stats = genWinLoss(slug, tierConfig);

      bots.push({
        slug,
        username,
        elo,
        style,
        ...params,
        country,
        ...stats,
      });

      globalIndex++;
    }
  }

  assertUniqueBots(bots);
  return bots;
}

const BOTS = buildBots();

// ── Supabase Helpers ────────────────────────────────────────────────────────

async function listAllUsersByEmail(): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(`Failed to list auth users: ${error.message}`);
    }

    const users = data?.users ?? [];

    for (const user of users) {
      if (user.email) {
        result.set(user.email, user.id);
      }
    }

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return result;
}

async function createBotAuthUser(email: string, slug: string): Promise<string> {
  const passwordSeed = seededInt(`${slug}:pw`, 100000, 999999999);

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: `bot-${slug}-${passwordSeed}`,
    user_metadata: {
      is_bot: true,
      bot_slug: slug,
    },
    app_metadata: {
      is_bot: true,
      role: "bot",
    },
  });

  if (error || !data.user) {
    throw new Error(`Failed creating auth user for ${slug}: ${error?.message ?? "unknown error"}`);
  }

  return data.user.id;
}

async function waitForProfileRow(userId: string, username: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed checking profile row for ${username}: ${error.message}`);
    }

    if (data?.id) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Profile row not found for ${username} after auth creation`);
}

async function upsertProfile(bot: BotDef, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      username: bot.username,
      elo: bot.elo,
      wins: bot.wins,
      losses: bot.losses,
      country: bot.country,
      is_bot: true,
    })
    .eq("id", userId);

  if (error) {
    throw new Error(`Failed updating profile for ${bot.username}: ${error.message}`);
  }
}

async function upsertBotConfig(bot: BotDef, userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("bot_config").upsert({
    id: userId,
    style: bot.style,
    aggression: bot.aggression,
    bluff_frequency: bot.bluffFrequency,
    looseness: bot.looseness,
    avatar_seed: bot.slug,
    enabled: true,
    show_on_leaderboard: true,
    ranked_enabled: true,
    unranked_enabled: true,
  });

  if (error) {
    throw new Error(`Failed upserting bot_config for ${bot.username}: ${error.message}`);
  }
}

// ── Main Seed Function ──────────────────────────────────────────────────────

async function seed(): Promise<void> {
  console.log(`Seeding ${BOTS.length} bots...`);

  const existingUsersByEmail = await listAllUsersByEmail();

  let created = 0;
  let reused = 0;
  let updated = 0;
  const seededUserIds = new Set<string>();
  const failures: Array<{ bot: string; error: string }> = [];

  for (let idx = 0; idx < BOTS.length; idx++) {
    const bot = BOTS[idx];
    const email = `bot-${bot.slug}@riverrank.internal`;

    try {
      let userId = existingUsersByEmail.get(email);

      if (userId) {
        reused += 1;
      } else {
        userId = await createBotAuthUser(email, bot.slug);
        existingUsersByEmail.set(email, userId);
        created += 1;
        await waitForProfileRow(userId, bot.username);
      }

      await upsertProfile(bot, userId);
      await upsertBotConfig(bot, userId);

      seededUserIds.add(userId);
      updated += 1;

      if ((idx + 1) % 100 === 0) {
        console.log(`  Progress: ${idx + 1}/${BOTS.length} bots processed`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ bot: bot.username, error: message });
      console.error(`  [failed]   ${bot.username}: ${message}`);
    }
  }

  // Disable stale bots not in current seed set
  const { data: allBotConfigs } = await supabaseAdmin
    .from("bot_config")
    .select("id")
    .eq("enabled", true);

  // Fetch elite bot IDs so we don't disable them
  const { data: eliteBots } = await supabaseAdmin
    .from("bot_config")
    .select("id")
    .eq("is_elite", true);
  const eliteIds = new Set((eliteBots ?? []).map((r: any) => r.id as string));

  if (allBotConfigs) {
    const staleIds = allBotConfigs
      .map((row) => row.id as string)
      .filter((id) => !seededUserIds.has(id) && !eliteIds.has(id));

    if (staleIds.length > 0) {
      const { error: disableError } = await supabaseAdmin
        .from("bot_config")
        .update({ enabled: false })
        .in("id", staleIds);

      if (disableError) {
        console.error(`Failed disabling stale bots: ${disableError.message}`);
      } else {
        console.log(`Disabled ${staleIds.length} stale bot(s)`);
      }
    }
  }

  console.log("");
  console.log("Seed summary");
  console.log("------------");
  console.log(`Bots defined: ${BOTS.length}`);
  console.log(`Auth created: ${created}`);
  console.log(`Auth reused:  ${reused}`);
  console.log(`Updated:      ${updated}`);
  console.log(`Failures:     ${failures.length}`);

  if (failures.length > 0) {
    console.log("");
    console.log("Failures:");
    for (const failure of failures) {
      console.log(`- ${failure.bot}: ${failure.error}`);
    }
    process.exitCode = 1;
  } else {
    console.log("");
    console.log("Done.");
  }
}

void seed();
