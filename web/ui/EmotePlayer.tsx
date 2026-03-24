"use client";

import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import type { EmoteDefinition } from "@/lib/emotes";
import { getEmoteImageUrl } from "@/lib/emotes";

interface Props {
  emote: EmoteDefinition;
  /** Display size in CSS pixels. Defaults: 96 desktop, 72 mobile. */
  size?: number;
  /** Total animation duration in ms. Default 1200. Clamped to [1200, 5000]. */
  durationMs?: number;
  onComplete: () => void;
}

/**
 * Plays a static emote image with code-driven animation:
 *   0–100ms              pop-in   scale 0.3→1.1
 *   100–200ms            settle   scale 1.1→1.0
 *   200–(duration-300)ms hold     scale 1.0, opacity 1
 *   last 300ms           fade     opacity 1→0
 *
 * Default duration is 1200ms. When a sound is attached, the caller
 * can pass a longer durationMs so the visual matches the audio.
 */
export function EmotePlayer({ emote, size, durationMs, onComplete }: Props) {
  const isMobile = useIsMobile();
  const displaySize = size ?? (isMobile ? 72 : 96);
  const totalMs = Math.max(1200, Math.min(5000, durationMs ?? 1200));
  const fadeStart = totalMs - 300;
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const [style, setStyle] = useState<React.CSSProperties>({
    transform: "scale(0.3)",
    opacity: 1,
  });
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    startRef.current = performance.now();
    completedRef.current = false;

    function tick(now: number) {
      const elapsed = now - startRef.current;

      let scale: number;
      let opacity: number;

      if (elapsed < 100) {
        // Pop-in: 0.3 → 1.1
        const t = elapsed / 100;
        scale = 0.3 + t * 0.8;
      } else if (elapsed < 200) {
        // Settle: 1.1 → 1.0
        const t = (elapsed - 100) / 100;
        scale = 1.1 - t * 0.1;
      } else {
        scale = 1.0;
      }

      if (elapsed > fadeStart) {
        // Fade out over last 300ms
        const t = Math.min(1, (elapsed - fadeStart) / 300);
        opacity = 1 - t;
      } else {
        opacity = 1;
      }

      setStyle({ transform: `scale(${scale})`, opacity });

      if (elapsed >= totalMs) {
        if (!completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current();
        }
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        width: displaySize,
        height: displaySize,
        position: "relative",
        ...style,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getEmoteImageUrl(emote)}
        alt={emote.name}
        width={displaySize}
        height={displaySize}
        style={{ display: "block", borderRadius: 8 }}
        draggable={false}
      />
      {/* Burst ring */}
      <div
        style={{
          position: "absolute",
          inset: -8,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.35)",
          animation: "emote-burst 400ms ease-out forwards",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
