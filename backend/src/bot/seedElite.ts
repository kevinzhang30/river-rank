/**
 * Elite Bot Seed Script — creates 10 hand-crafted elite bot accounts.
 *
 * These are high-Elo heads-up specialists with distinct personalities,
 * using the shared strategy engine with elite-specific config fields.
 *
 * Safe to re-run: reuses existing auth users, upserts config.
 *
 * Usage:
 *   npx tsx backend/src/bot/seedElite.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Elite Bot Definitions ─────────────────────────────────────────────────────

interface EliteBotDef {
  slug: string;
  username: string;
  country: string;
  elo: number;
  style: "tight" | "loose" | "balanced" | "aggro";
  wins: number;
  losses: number;
  // Core behavior
  aggression: number;
  bluffFrequency: number;
  looseness: number;
  // Elite-specific
  threeBetFreq: number;
  blindDefenseBonus: number;
  shortStackAggression: number;
  trapFrequency: number;
  doubleBarrelFreq: number;
}

const ELITE_BOTS: EliteBotDef[] = [
  {
    // Balanced Crusher — solid fundamentals, moderate aggression, well-rounded
    slug: "poison_ivy",
    username: "poison_ivy",
    country: "US",
    elo: 2350,
    style: "balanced",
    wins: 245,
    losses: 130,
    aggression: 0.65,
    bluffFrequency: 0.15,
    looseness: 0.45,
    threeBetFreq: 0.4,
    blindDefenseBonus: 0.6,
    shortStackAggression: 0.5,
    trapFrequency: 0.3,
    doubleBarrelFreq: 0.5,
  },
  {
    // Aggressive Punisher — relentless pressure, high 3-bet and barrel frequency
    slug: "toni_grande",
    username: "toni_grande",
    country: "LT",
    elo: 2500,
    style: "aggro",
    wins: 280,
    losses: 140,
    aggression: 0.85,
    bluffFrequency: 0.25,
    looseness: 0.50,
    threeBetFreq: 0.7,
    blindDefenseBonus: 0.4,
    shortStackAggression: 0.6,
    trapFrequency: 0.1,
    doubleBarrelFreq: 0.7,
  },
  {
    // Disciplined Trapper — tight range, heavy slow-play, springs the trap
    slug: "texas_dolly",
    username: "texas_dolly",
    country: "US",
    elo: 2050,
    style: "tight",
    wins: 210,
    losses: 120,
    aggression: 0.40,
    bluffFrequency: 0.08,
    looseness: 0.25,
    threeBetFreq: 0.2,
    blindDefenseBonus: 0.5,
    shortStackAggression: 0.3,
    trapFrequency: 0.7,
    doubleBarrelFreq: 0.3,
  },
  {
    // Short-Stack Killer — dominates when stacks get shallow, relentless shover
    slug: "greatdane",
    username: "greatdane",
    country: "DK",
    elo: 2300,
    style: "aggro",
    wins: 260,
    losses: 135,
    aggression: 0.75,
    bluffFrequency: 0.20,
    looseness: 0.40,
    threeBetFreq: 0.5,
    blindDefenseBonus: 0.3,
    shortStackAggression: 0.9,
    trapFrequency: 0.15,
    doubleBarrelFreq: 0.6,
  },
  {
    // Blind Defense Specialist — almost never gives up blinds, wide BB defense
    slug: "fedorholtz",
    username: "fedorholtz",
    country: "DE",
    elo: 2000,
    style: "balanced",
    wins: 200,
    losses: 115,
    aggression: 0.50,
    bluffFrequency: 0.10,
    looseness: 0.50,
    threeBetFreq: 0.3,
    blindDefenseBonus: 0.9,
    shortStackAggression: 0.4,
    trapFrequency: 0.2,
    doubleBarrelFreq: 0.4,
  },
  {
    // Patient Positional — waits for spots, reads opponents, exploits position
    slug: "deeznuts99",
    username: "deeznuts99",
    country: "CA",
    elo: 2100,
    style: "balanced",
    wins: 215,
    losses: 125,
    aggression: 0.45,
    bluffFrequency: 0.12,
    looseness: 0.40,
    threeBetFreq: 0.35,
    blindDefenseBonus: 0.6,
    shortStackAggression: 0.3,
    trapFrequency: 0.6,
    doubleBarrelFreq: 0.35,
  },
  {
    // TAG Grinder — narrow range but punishes mistakes mercilessly
    slug: "antonio",
    username: "antonio",
    country: "FI",
    elo: 2200,
    style: "tight",
    wins: 230,
    losses: 120,
    aggression: 0.55,
    bluffFrequency: 0.05,
    looseness: 0.20,
    threeBetFreq: 0.3,
    blindDefenseBonus: 0.7,
    shortStackAggression: 0.4,
    trapFrequency: 0.5,
    doubleBarrelFreq: 0.3,
  },
  {
    // Barrel Machine — fires on every street, enormous double-barrel frequency
    slug: "durrrn",
    username: "durrrn",
    country: "US",
    elo: 2250,
    style: "aggro",
    wins: 240,
    losses: 130,
    aggression: 0.80,
    bluffFrequency: 0.18,
    looseness: 0.55,
    threeBetFreq: 0.6,
    blindDefenseBonus: 0.5,
    shortStackAggression: 0.7,
    trapFrequency: 0.2,
    doubleBarrelFreq: 0.8,
  },
  {
    // Unpredictable LAG — wide range, frequent bluffs, hard to read
    slug: "hellmouth",
    username: "hellmouth",
    country: "US",
    elo: 2150,
    style: "loose",
    wins: 220,
    losses: 130,
    aggression: 0.60,
    bluffFrequency: 0.22,
    looseness: 0.65,
    threeBetFreq: 0.6,
    blindDefenseBonus: 0.5,
    shortStackAggression: 0.5,
    trapFrequency: 0.4,
    doubleBarrelFreq: 0.5,
  },
  {
    // All-Around Elite — no weaknesses, slightly aggressive, the "final boss"
    slug: "isildur",
    username: "isildur",
    country: "SE",
    elo: 2400,
    style: "balanced",
    wins: 270,
    losses: 135,
    aggression: 0.70,
    bluffFrequency: 0.15,
    looseness: 0.45,
    threeBetFreq: 0.55,
    blindDefenseBonus: 0.65,
    shortStackAggression: 0.6,
    trapFrequency: 0.35,
    doubleBarrelFreq: 0.55,
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

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

    if (users.length < perPage) break;
    page += 1;
  }

  return result;
}

async function createEliteAuthUser(email: string, slug: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: `elite-${slug}-${Date.now()}`,
    user_metadata: {
      is_bot: true,
      is_elite: true,
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

    if (data?.id) return;

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Profile row not found for ${username} after auth creation`);
}

// ── Main Seed Function ──────────────────────────────────────────────────────

async function seedElite(): Promise<void> {
  console.log(`Seeding ${ELITE_BOTS.length} elite bots...`);

  const existingUsersByEmail = await listAllUsersByEmail();

  let created = 0;
  let reused = 0;
  let updated = 0;
  const failures: Array<{ bot: string; error: string }> = [];

  for (const bot of ELITE_BOTS) {
    const email = `elite-${bot.slug}@riverrank.internal`;

    try {
      let userId = existingUsersByEmail.get(email);

      if (userId) {
        reused += 1;
      } else {
        userId = await createEliteAuthUser(email, bot.slug);
        existingUsersByEmail.set(email, userId);
        created += 1;
        await waitForProfileRow(userId, bot.username);
      }

      // Update profile
      const { error: profileError } = await supabaseAdmin
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

      if (profileError) {
        throw new Error(`Failed updating profile for ${bot.username}: ${profileError.message}`);
      }

      // Upsert bot_config with elite fields
      const { error: configError } = await supabaseAdmin.from("bot_config").upsert({
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
        is_elite: true,
        three_bet_freq: bot.threeBetFreq,
        blind_defense_bonus: bot.blindDefenseBonus,
        short_stack_aggression: bot.shortStackAggression,
        trap_frequency: bot.trapFrequency,
        double_barrel_freq: bot.doubleBarrelFreq,
      });

      if (configError) {
        throw new Error(`Failed upserting bot_config for ${bot.username}: ${configError.message}`);
      }

      updated += 1;
      console.log(`  [ok] ${bot.username} (${bot.country}, Elo ${bot.elo})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ bot: bot.username, error: message });
      console.error(`  [failed] ${bot.username}: ${message}`);
    }
  }

  console.log("");
  console.log("Elite seed summary");
  console.log("------------------");
  console.log(`Bots defined: ${ELITE_BOTS.length}`);
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

void seedElite();
