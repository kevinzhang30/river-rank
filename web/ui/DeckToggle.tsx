"use client";

import { useEffect, useState } from "react";

export function DeckToggle() {
  const [deck, setDeck] = useState<"2color" | "4color">("2color");

  useEffect(() => {
    const stored = localStorage.getItem("deck") as "2color" | "4color" | null;
    const initial = stored ?? "2color";
    setDeck(initial);
    document.documentElement.dataset.deck = initial;
  }, []);

  function toggle() {
    const next = deck === "2color" ? "4color" : "2color";
    setDeck(next);
    document.documentElement.dataset.deck = next;
    localStorage.setItem("deck", next);
  }

  return (
    <button
      onClick={toggle}
      style={{
        background:    "transparent",
        border:        "1px solid var(--border)",
        borderRadius:  3,
        color:         "var(--text3)",
        fontSize:      10,
        fontFamily:    "monospace",
        fontWeight:    700,
        letterSpacing: 1,
        padding:       "3px 8px",
        cursor:        "pointer",
        textTransform: "uppercase",
        flexShrink:    0,
      }}
    >
      {deck === "2color" ? "4C" : "2C"}
    </button>
  );
}
