"use client";

const HANDS = [
  { name: "Straight Flush",  desc: "Five same-suit cards in sequence" },
  { name: "Four of a Kind",  desc: "Four cards of the same rank" },
  { name: "Full House",      desc: "Three of a kind plus a pair" },
  { name: "Flush",           desc: "Five cards of the same suit" },
  { name: "Straight",        desc: "Five cards in sequence" },
  { name: "Three of a Kind", desc: "Three cards of the same rank" },
  { name: "Two Pair",        desc: "Two different pairs" },
  { name: "One Pair",        desc: "Two cards of the same rank" },
  { name: "High Card",       desc: "Highest card plays" },
];

export function HandCheatSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position:       "fixed",
        inset:          0,
        background:     "rgba(0,0,0,0.72)",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        zIndex:         200,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background:    "var(--surface)",
          border:        "1px solid var(--border)",
          borderRadius:  8,
          padding:       "24px 32px",
          minWidth:      360,
          position:      "relative",
          fontFamily:    "monospace",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{
            position:   "absolute",
            top:        10,
            right:      14,
            background: "none",
            border:     "none",
            color:      "var(--text3)",
            fontSize:   20,
            cursor:     "pointer",
            lineHeight: 1,
            padding:    0,
          }}
        >
          ×
        </button>

        <div
          style={{
            fontWeight:    800,
            fontSize:      11,
            letterSpacing: 2,
            marginBottom:  18,
            color:         "var(--text)",
            textTransform: "uppercase",
          }}
        >
          Hand Rankings
        </div>

        {HANDS.map((h, i) => (
          <div
            key={h.name}
            style={{
              display:       "flex",
              gap:           14,
              alignItems:    "baseline",
              marginBottom:  10,
            }}
          >
            <span
              style={{
                color:     "var(--text3)",
                fontSize:  10,
                minWidth:  14,
                textAlign: "right",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <div>
              <span
                style={{
                  color:         "var(--text)",
                  fontWeight:    700,
                  fontSize:      12,
                  letterSpacing: 0.5,
                }}
              >
                {h.name}
              </span>
              <span
                style={{
                  color:     "var(--text3)",
                  fontSize:  10,
                  marginLeft: 10,
                }}
              >
                {h.desc}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
