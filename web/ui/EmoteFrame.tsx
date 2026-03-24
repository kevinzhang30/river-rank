"use client";

import type { CSSProperties, ReactNode } from "react";
import type { EmoteTier } from "@/lib/emotes";

interface Props {
  tier?: EmoteTier | null;
  selected?: boolean;
  radius?: number;
  background?: string;
  contentPadding?: number;
  style?: CSSProperties;
  contentStyle?: CSSProperties;
  children: ReactNode;
}

export function EmoteFrame({
  tier = "free",
  selected = false,
  radius = 8,
  background = "var(--surface2)",
  contentPadding = 0,
  style,
  contentStyle,
  children,
}: Props) {
  const hasAccent = tier === "premium" || tier === "achievement";
  const outerPadding = hasAccent ? 2 : 0;

  let outerStyle: CSSProperties = {
    borderRadius: radius,
  };

  if (tier === "premium") {
    outerStyle = {
      ...outerStyle,
      background: "linear-gradient(120deg, #ff5f6d, #ffc371, #35d6ed, #6d5efc, #ff5f6d)",
      backgroundSize: "250% 250%",
      animation: "premium-emote-gradient 4s linear infinite",
      boxShadow: "0 0 16px rgba(109, 94, 252, 0.28), 0 0 24px rgba(255, 95, 109, 0.16)",
      padding: outerPadding,
    };
  } else if (tier === "achievement") {
    outerStyle = {
      ...outerStyle,
      background: "linear-gradient(135deg, rgba(245, 158, 11, 0.95), rgba(250, 204, 21, 0.72))",
      boxShadow: "0 0 12px rgba(245, 158, 11, 0.2)",
      padding: outerPadding,
    };
  }

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        ...outerStyle,
        ...style,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: Math.max(0, radius - outerPadding),
          background,
          border: selected
            ? "2px solid var(--primaryBtn)"
            : hasAccent
            ? "1px solid rgba(255,255,255,0.06)"
            : "1px solid var(--border)",
          padding: contentPadding,
          ...contentStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}
