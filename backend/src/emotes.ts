import type { SupabaseClient } from "@supabase/supabase-js";

export interface EmoteRow {
  id: string;
  name: string;
  image_url: string;
  asset_type: "static" | "sprite";
  tier: "free" | "achievement" | "premium";
  sort_order: number;
  sound_url: string | null;
}

/** In-memory cache of all emotes, loaded from DB on startup. */
let emoteCache = new Map<string, EmoteRow>();

/** Fetch all emotes from DB into memory. Call once at server init. */
export async function loadEmotes(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase
    .from("emotes")
    .select("id, name, image_url, asset_type, tier, sort_order, sound_url")
    .order("sort_order");

  if (error) {
    console.error("[emotes] failed to load emotes from DB:", error.message, error.details, error.hint);
    return;
  }

  const fresh = new Map<string, EmoteRow>();
  for (const row of data ?? []) {
    fresh.set(row.id, row as EmoteRow);
  }
  emoteCache = fresh;
  console.log(`[emotes] loaded ${emoteCache.size} emotes`);
}

export function isValidEmoteId(id: string): boolean {
  return emoteCache.has(id);
}

export function getEmoteIds(): string[] {
  return Array.from(emoteCache.keys());
}

/** Fetch the set of emote IDs a user has unlocked. */
export async function fetchOwnedEmotes(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("user_emotes")
    .select("emote_id")
    .eq("user_id", userId);

  if (error) {
    console.error("[emotes] failed to fetch owned emotes:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.emote_id));
}

/** Fetch the set of emote IDs a user has equipped. */
export async function fetchEquippedEmotes(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("equipped_emotes")
    .select("emote_id")
    .eq("user_id", userId);

  if (error) {
    console.error("[emotes] failed to fetch equipped emotes:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.emote_id));
}
