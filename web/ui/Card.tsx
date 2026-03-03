"use client";

const SUIT_SYMBOL: Record<string, string> = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣",
};

/** Maps suit letter → CSS variable holding the current deck-mode color. */
const SUIT_VAR: Record<string, string> = {
  s: "var(--suit-s)",
  h: "var(--suit-h)",
  d: "var(--suit-d)",
  c: "var(--suit-c)",
};

const SIZES = {
  sm: { width: 40, height: 56, rankSize: 15, suitSize: 13 },
  lg: { width: 56, height: 78, rankSize: 21, suitSize: 17 },
};

interface CardProps {
  card: string;
  size?: "sm" | "lg";
}

export function Card({ card, size = "sm" }: CardProps) {
  const rank   = card.slice(0, -1);
  const suit   = card.slice(-1).toLowerCase();
  const color  = SUIT_VAR[suit] ?? "var(--suit-s)";
  const symbol = SUIT_SYMBOL[suit] ?? suit.toUpperCase();
  const { width, height, rankSize, suitSize } = SIZES[size];

  return (
    <div
      style={{
        width,
        height,
        background:     "#FAFAFA",
        borderRadius:   4,
        border:         "1px solid rgba(0,0,0,0.1)",
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        color,
        fontFamily:     "monospace",
        fontWeight:     700,
        userSelect:     "none",
        flexShrink:     0,
        lineHeight:     1,
        gap:            2,
      }}
    >
      <span style={{ fontSize: rankSize }}>{rank}</span>
      <span style={{ fontSize: suitSize }}>{symbol}</span>
    </div>
  );
}

export function FacedownCard({ size = "sm" }: { size?: "sm" | "lg" }) {
  const { width, height } = SIZES[size];
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 4,
        border:       "1px solid var(--border)",
        background:   "var(--surface2)",
        flexShrink:   0,
      }}
    />
  );
}

export function EmptyCardSlot({ size = "sm" }: { size?: "sm" | "lg" }) {
  const { width, height } = SIZES[size];
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 4,
        border:       "1px solid var(--border)",
        background:   "transparent",
        flexShrink:   0,
      }}
    />
  );
}
