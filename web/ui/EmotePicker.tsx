"use client";

import { useEffect, useRef } from "react";
import type { EmoteDefinition } from "@/lib/emotes";
import { getEmoteImageUrl } from "@/lib/emotes";
import { EmoteFrame } from "./EmoteFrame";

interface Props {
  equippedEmotes: EmoteDefinition[];
  onSelect: (emoteId: string) => void;
  onClose: () => void;
  cooldownActive: boolean;
}

export function EmotePicker({ equippedEmotes, onSelect, onClose, cooldownActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Use a small delay so the opening click doesn't immediately close
    const id = setTimeout(() => document.addEventListener("mousedown", handleClick), 50);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        bottom: "100%",
        left: "50%",
        transform: "translateX(-50%)",
        marginBottom: 8,
        background: "var(--surface2)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 6,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 6,
        zIndex: 60,
        opacity: cooldownActive ? 0.4 : 1,
        pointerEvents: cooldownActive ? "none" : "auto",
      }}
    >
      {equippedEmotes.length === 0 && (
        <div
          style={{
            gridColumn: "1 / -1",
            padding: "12px 8px",
            fontSize: 10,
            color: "var(--text3)",
            textAlign: "center",
            fontFamily: "monospace",
            whiteSpace: "nowrap",
          }}
        >
          No emotes equipped
        </div>
      )}
      {equippedEmotes.map((emote) => (
        <button
          key={emote.id}
          onClick={() => onSelect(emote.id)}
          title={emote.name}
          style={{
            background: "transparent",
            border: "none",
            borderRadius: 6,
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform 0.1s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          <EmoteFrame tier={emote.tier} radius={6} style={{ width: 60, height: 60 }} contentPadding={4}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getEmoteImageUrl(emote)}
              alt={emote.name}
              width={48}
              height={48}
              style={{ borderRadius: 4 }}
              draggable={false}
            />
          </EmoteFrame>
        </button>
      ))}
    </div>
  );
}
