import { describe, it, expect } from "vitest";
import { rowToEmoteDefinition, getEmoteImageUrl } from "../emotes";

describe("rowToEmoteDefinition", () => {
  it("maps a full row with sound_url", () => {
    const def = rowToEmoteDefinition({
      id: "mewing",
      name: "Mewing",
      image_url: "/emotes/mewing-emote.png",
      asset_type: "static",
      sound_url: "/sfx/emotes/mewing.mp3",
    });
    expect(def.id).toBe("mewing");
    expect(def.soundUrl).toBe("/sfx/emotes/mewing.mp3");
    expect(def.assetType).toBe("static");
    expect(def.imageUrl).toBe("/emotes/mewing-emote.png");
  });

  it("handles missing sound_url gracefully (null)", () => {
    const def = rowToEmoteDefinition({
      id: "elipses",
      name: "Elipses",
      image_url: "/emotes/elipses-emote.png",
      asset_type: "static",
      sound_url: null,
    });
    expect(def.soundUrl).toBeNull();
  });

  it("handles undefined sound_url gracefully", () => {
    const def = rowToEmoteDefinition({
      id: "thanks",
      name: "Thanks",
      image_url: "/emotes/thanks-emote.png",
      asset_type: "static",
    });
    expect(def.soundUrl).toBeNull();
  });

  it("getEmoteImageUrl works with soundUrl-aware definitions", () => {
    const def = rowToEmoteDefinition({
      id: "speed",
      name: "Speed",
      image_url: "/emotes/speed-emote.png",
      asset_type: "static",
      sound_url: "/sfx/emotes/speed.mp3",
    });
    expect(getEmoteImageUrl(def)).toBe("/emotes/speed-emote.png");
  });
});
