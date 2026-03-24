"use client";

import type { EmoteEvent } from "./types";
import type { EmoteDefinition } from "@/lib/emotes";
import { EmotePlayer } from "./EmotePlayer";
import { getSoundDuration } from "@/lib/sound";
import { EmoteFrame } from "./EmoteFrame";

interface Props {
  emote: EmoteEvent;
  emoteRegistry: Record<string, EmoteDefinition>;
  onComplete: (id: string) => void;
}

export function EmoteBubble({ emote, emoteRegistry, onComplete }: Props) {
  const emoteDef = emoteRegistry[emote.emoteId];
  if (!emoteDef) return null;

  // Visual duration: emotes with sound get at least 2s, clamped [2000, 5000]ms
  const soundMs = emoteDef.soundUrl ? getSoundDuration(emoteDef.soundUrl) : null;
  const durationMs = emoteDef.soundUrl
    ? Math.min(5000, Math.max(2000, soundMs ?? 2000))
    : 1200;

  return (
    <div style={{ pointerEvents: "none" }}>
      <div style={{ position: "relative" }}>
        <EmoteFrame
          tier={emoteDef.tier}
          radius={12}
          background="var(--surface2)"
          contentPadding={8}
          contentStyle={{ backdropFilter: "blur(6px)" }}
        >
          <EmotePlayer
            emote={emoteDef}
            durationMs={durationMs}
            onComplete={() => onComplete(emote.id)}
          />
        </EmoteFrame>
        <div
          style={{
            position: "absolute",
            bottom: -6,
            left: "50%",
            marginLeft: -6,
            width: 0,
            height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderTop: "6px solid var(--surface2)",
          }}
        />
      </div>
    </div>
  );
}
