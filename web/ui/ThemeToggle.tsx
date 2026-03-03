"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = localStorage.getItem("theme") as "dark" | "light" | null;
    const initial = stored ?? "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
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
      {theme === "dark" ? "☀ Light" : "◗ Dark"}
    </button>
  );
}
