/**
 * Bot Seed Script
 *
 * Creates 50 persistent bot accounts for RiverRank.
 *
 * Design notes:
 * - Bots are created as real Supabase auth users so the existing
 *   profiles/auth foreign key integrity remains intact.
 * - Bots are never meant to log in.
 * - Script is idempotent:
 *   - deterministic bot emails
 *   - safe to re-run
 *   - updates profile + bot_config for existing bots
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
type BotTier = "low" | "mid" | "high" | "elite";

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

interface BotTemplate {
  slug: string;
  username: string;
  style: BotStyle;
}

const COUNTRIES = [
  "US",
  "CA",
  "BR",
  "JP",
  "KR",
  "SE",
  "CH",
  "IN",
  "MX",
  "PH",
  "NL",
  "NO",
  "DE",
  "FR",
  "AU",
] as const;

const STYLE_PARAMS: Record<
  BotStyle,
  { aggression: number; bluffFrequency: number; looseness: number }
> = {
  tight: {
    aggression: 0.30,
    bluffFrequency: 0.05,
    looseness: 0.20,
  },
  loose: {
    aggression: 0.40,
    bluffFrequency: 0.12,
    looseness: 0.70,
  },
  balanced: {
    aggression: 0.50,
    bluffFrequency: 0.10,
    looseness: 0.45,
  },
  aggro: {
    aggression: 0.80,
    bluffFrequency: 0.20,
    looseness: 0.40,
  },
};

const lowBots: BotTemplate[] = [
  { slug: "mike88", username: "mike88", style: "loose" },
  { slug: "jaylen7", username: "jaylen7", style: "balanced" },
  { slug: "coldfront", username: "coldfront", style: "loose" },
  { slug: "sarah-h", username: "sarah_h", style: "balanced" },
  { slug: "ember41", username: "ember41", style: "loose" },
  { slug: "tommyd", username: "tommyD", style: "balanced" },
  { slug: "riverrat42", username: "RiverRat42", style: "loose" },
  { slug: "kaylah", username: "kaylah", style: "balanced" },
  { slug: "duskfall", username: "duskfall", style: "loose" },
  { slug: "brianw", username: "brianW", style: "balanced" },
];

const midBots: BotTemplate[] = [
  { slug: "nina-k", username: "nina_k", style: "tight" },
  { slug: "devr", username: "devR", style: "balanced" },
  { slug: "marcus21", username: "marcus21", style: "loose" },
  { slug: "bluemesa", username: "BlueMesa", style: "balanced" },
  { slug: "northline", username: "northline", style: "tight" },
  { slug: "elena99", username: "elena99", style: "aggro" },
  { slug: "vortex", username: "vortex_", style: "loose" },
  { slug: "frostbyte", username: "frostbyte", style: "balanced" },
  { slug: "ridgeline", username: "ridgeline", style: "tight" },
  { slug: "snapcall99", username: "SnapCall99", style: "aggro" },
  { slug: "alex-j", username: "alex_j", style: "balanced" },
  { slug: "ironside", username: "ironside", style: "tight" },
  { slug: "sablewing", username: "sablewing", style: "loose" },
  { slug: "cassidy", username: "cassidy", style: "balanced" },
  { slug: "valuetown", username: "ValueTown", style: "aggro" },
  { slug: "maxp", username: "maxp", style: "balanced" },
  { slug: "stillwater", username: "stillwater", style: "tight" },
  { slug: "jordanlee", username: "jordanlee", style: "loose" },
  { slug: "redfern", username: "redfern", style: "balanced" },
  { slug: "harper42", username: "harper42", style: "aggro" },
];

const highBots: BotTemplate[] = [
  { slug: "summit", username: "summit", style: "tight" },
  { slug: "zara-m", username: "zara_m", style: "balanced" },
  { slug: "foldequity", username: "FoldEquity", style: "tight" },
  { slug: "crux", username: "crux", style: "aggro" },
  { slug: "oakhurst", username: "oakhurst", style: "balanced" },
  { slug: "nitnate", username: "NitNate", style: "tight" },
  { slug: "dani77", username: "dani77", style: "balanced" },
  { slug: "stoneridge", username: "stoneridge", style: "tight" },
  { slug: "kira-v", username: "kira_v", style: "aggro" },
  { slug: "quartzline", username: "quartzline", style: "balanced" },
  { slug: "ryanc", username: "ryanc", style: "tight" },
  { slug: "ashgrove", username: "ashgrove", style: "balanced" },
  { slug: "celeste", username: "celeste", style: "tight" },
  { slug: "tundra", username: "tundra", style: "aggro" },
  { slug: "liwei", username: "liwei", style: "balanced" },
];

const eliteBots: BotTemplate[] = [
  { slug: "glacier", username: "glacier", style: "tight" },
  { slug: "spectra", username: "spectra", style: "balanced" },
  { slug: "axiom", username: "axiom", style: "tight" },
  { slug: "neonveil", username: "neonveil", style: "balanced" },
  { slug: "zenith", username: "zenith", style: "tight" },
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pickCountry(index: number): string {
  return COUNTRIES[index % COUNTRIES.length];
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function seededFraction(seed: string): number {
  return hashString(seed) / 4294967295;
}

function seededRange(seed: string, min: number, max: number): number {
  return min + seededFraction(seed) * (max - min);
}

function seededInt(seed: string, min: number, max: number): number {
  return Math.floor(seededRange(seed, min, max + 1));
}

function genWinLoss(slug: string, tier: BotTier): {
  wins: number;
  losses: number;
} {
  const gamesBase =
    tier === "elite" ? 120 : tier === "high" ? 80 : tier === "mid" ? 60 : 50;

  const gamesExtra =
    tier === "elite"
      ? seededInt(`${slug}:games`, 20, 90)
      : seededInt(`${slug}:games`, 10, 80);

  const gamesPlayed = gamesBase + gamesExtra;

  let minRate = 0.35;
  let maxRate = 0.45;

  if (tier === "mid") {
    minRate = 0.45;
    maxRate = 0.52;
  } else if (tier === "high") {
    minRate = 0.50;
    maxRate = 0.58;
  } else if (tier === "elite") {
    minRate = 0.55;
    maxRate = 0.65;
  }

  const winRate = seededRange(`${slug}:winrate`, minRate, maxRate);
  const wins = Math.round(gamesPlayed * winRate);
  const losses = gamesPlayed - wins;

  return { wins, losses };
}

function assertUniqueBots(bots: BotDef[]): void {
  const slugs = new Set<string>();
  const usernames = new Set<string>();

  for (const bot of bots) {
    if (slugs.has(bot.slug)) {
      throw new Error(`Duplicate bot slug found: ${bot.slug}`);
    }

    const usernameKey = bot.username.toLowerCase();
    if (usernames.has(usernameKey)) {
      throw new Error(`Duplicate bot username found: ${bot.username}`);
    }

    slugs.add(bot.slug);
    usernames.add(usernameKey);
  }
}

function buildBots(): BotDef[] {
  const bots: BotDef[] = [];

  for (let i = 0; i < lowBots.length; i++) {
    const bot = lowBots[i];
    const elo = 700 + Math.round((i / (lowBots.length - 1)) * 250);
    const stats = genWinLoss(bot.slug, "low");
    const params = STYLE_PARAMS[bot.style];

    bots.push({
      slug: bot.slug,
      username: bot.username,
      elo,
      style: bot.style,
      aggression: params.aggression,
      bluffFrequency: params.bluffFrequency,
      looseness: params.looseness,
      country: pickCountry(i),
      ...stats,
    });
  }

  for (let i = 0; i < midBots.length; i++) {
    const bot = midBots[i];
    const elo = 1000 + Math.round((i / (midBots.length - 1)) * 300);
    const stats = genWinLoss(bot.slug, "mid");
    const params = STYLE_PARAMS[bot.style];

    bots.push({
      slug: bot.slug,
      username: bot.username,
      elo,
      style: bot.style,
      aggression: params.aggression,
      bluffFrequency: params.bluffFrequency,
      looseness: params.looseness,
      country: pickCountry(i + 10),
      ...stats,
    });
  }

  for (let i = 0; i < highBots.length; i++) {
    const bot = highBots[i];
    const elo = 1350 + Math.round((i / (highBots.length - 1)) * 250);
    const stats = genWinLoss(bot.slug, "high");
    const params = STYLE_PARAMS[bot.style];

    bots.push({
      slug: bot.slug,
      username: bot.username,
      elo,
      style: bot.style,
      aggression: params.aggression,
      bluffFrequency: params.bluffFrequency,
      looseness: params.looseness,
      country: pickCountry(i + 30),
      ...stats,
    });
  }

  for (let i = 0; i < eliteBots.length; i++) {
    const bot = eliteBots[i];
    const elo = 1650 + Math.round((i / (eliteBots.length - 1)) * 250);
    const stats = genWinLoss(bot.slug, "elite");
    const params = STYLE_PARAMS[bot.style];

    bots.push({
      slug: bot.slug,
      username: bot.username,
      elo,
      style: bot.style,
      aggression: clamp01(params.aggression + 0.15),
      bluffFrequency: clamp01(params.bluffFrequency + 0.05),
      looseness: params.looseness,
      country: pickCountry(i + 45),
      ...stats,
    });
  }

  assertUniqueBots(bots);
  return bots;
}

const BOTS = buildBots();

async function listAllAuthUsersByEmail(): Promise<
  Map<string, { id: string; email: string }>
> {
  const usersByEmail = new Map<string, { id: string; email: string }>();

  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(`Failed listing auth users: ${error.message}`);
    }

    const users = data?.users ?? [];

    for (const user of users) {
      if (user.email) {
        usersByEmail.set(user.email, {
          id: user.id,
          email: user.email,
        });
      }
    }

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return usersByEmail;
}

async function createBotAuthUser(email: string, slug: string): Promise<string> {
  const passwordSeed = seededInt(`${slug}:password`, 100000, 999999999);

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: `bot-${slug}-${passwordSeed}`,
    user_metadata: {
      is_bot: true,
      bot_slug: slug,
      source: "bot_seed_script",
    },
    app_metadata: {
      is_bot: true,
      role: "bot",
    },
  });

  if (error || !data.user) {
    throw new Error(
      `Failed creating auth user for ${slug}: ${error?.message ?? "unknown error"}`,
    );
  }

  return data.user.id;
}

async function updateProfile(bot: BotDef, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      username: bot.username,
      elo: bot.elo,
      wins: bot.wins,
      losses: bot.losses,
      is_bot: true,
      country: bot.country,
    })
    .eq("id", userId);

  if (error) {
    throw new Error(
      `Failed updating profile for ${bot.username}: ${error.message}`,
    );
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
    throw new Error(
      `Failed upserting bot_config for ${bot.username}: ${error.message}`,
    );
  }
}

async function seed(): Promise<void> {
  console.log(`Seeding ${BOTS.length} bots...`);

  const existingUsersByEmail = await listAllAuthUsersByEmail();

  let createdCount = 0;
  let existingCount = 0;
  let updatedCount = 0;
  const failures: Array<{ bot: string; error: string }> = [];

  for (const bot of BOTS) {
    const email = `bot-${bot.slug}@riverrank.internal`;

    try {
      let userId: string;
      const existing = existingUsersByEmail.get(email);

      if (existing) {
        userId = existing.id;
        existingCount += 1;
        console.log(`  [exists]   ${bot.username} (${userId.slice(0, 8)})`);
      } else {
        userId = await createBotAuthUser(email, bot.slug);
        existingUsersByEmail.set(email, { id: userId, email });
        createdCount += 1;
        console.log(`  [created]  ${bot.username} (${userId.slice(0, 8)})`);
      }

      await updateProfile(bot, userId);
      await upsertBotConfig(bot, userId);

      updatedCount += 1;
      console.log(
        `  [upserted] ${bot.username} elo=${bot.elo} w=${bot.wins} l=${bot.losses} country=${bot.country}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      failures.push({ bot: bot.username, error: message });
      console.error(`  [failed]   ${bot.username}: ${message}`);
    }
  }

  console.log("");
  console.log("Seed summary");
  console.log("------------");
  console.log(`Bots defined:   ${BOTS.length}`);
  console.log(`Auth created:   ${createdCount}`);
  console.log(`Auth existing:  ${existingCount}`);
  console.log(`Profiles/config upserted: ${updatedCount}`);
  console.log(`Failures:       ${failures.length}`);

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
