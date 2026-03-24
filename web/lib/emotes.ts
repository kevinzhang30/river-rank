export type EmoteTier = "free" | "achievement" | "premium";

type EmoteBase = {
  id: string;
  name: string;
  tier: EmoteTier;
  soundUrl: string | null;
};

/** Discriminated union — V1 only uses "static", but "sprite" is ready for future use. */
export type EmoteDefinition =
  | (EmoteBase & { assetType: "static"; imageUrl: string })
  | {
      id: string;
      name: string;
      tier: EmoteTier;
      assetType: "sprite";
      spriteSheetUrl: string;
      frameWidth: number;
      frameHeight: number;
      cols: number;
      rows: number;
      frameCount: number;
      fps: number;
      soundUrl: string | null;
    };

/** Extract the display image URL regardless of asset type. */
export function getEmoteImageUrl(emote: EmoteDefinition): string {
  return emote.assetType === "static" ? emote.imageUrl : emote.spriteSheetUrl;
}

/** Convert a DB emote row (from Supabase) into an EmoteDefinition. */
export function rowToEmoteDefinition(row: {
  id: string;
  name: string;
  image_url: string;
  asset_type: string;
  tier?: EmoteTier | null;
  sound_url?: string | null;
}): EmoteDefinition {
  return {
    id: row.id,
    name: row.name,
    tier: row.tier ?? "free",
    assetType: "static",
    imageUrl: row.image_url,
    soundUrl: row.sound_url ?? null,
  };
}
