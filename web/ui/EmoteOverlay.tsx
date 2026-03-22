"use client";

import type { EmoteEvent } from "./types";
import type { EmoteDefinition } from "@/lib/emotes";
import { EmotePlayer } from "./EmotePlayer";

interface Props {
  emote: EmoteEvent;
  emoteRegistry: Record<string, EmoteDefinition>;
  onComplete: (id: string) => void;
}

export function EmoteBubble({ emote, emoteRegistry, onComplete }: Props) {
  const emoteDef = emoteRegistry[emote.emoteId];
  if (!emoteDef) return null;

  return (
    <div style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "relative",
          background: "var(--surface2)",
          borderRadius: 12,
          padding: 8,
          border: "1px solid var(--border)",
          backdropFilter: "blur(6px)",
        }}
      >
        <EmotePlayer
          emote={emoteDef}
          onComplete={() => onComplete(emote.id)}
        />
        {/* Speech bubble tail */}
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
