"use client";

import { useEffect, useState } from "react";
import { getVolume, setVolume as setSoundVolume } from "@/lib/sound";

/**
 * Inline volume slider for settings rows.
 * Displays as a range input + percentage label — no popover.
 */
export function VolumeSlider() {
  const [volume, setVolume] = useState(0.5);

  useEffect(() => {
    setVolume(getVolume());
  }, []);

  function handleChange(v: number) {
    setVolume(v);
    setSoundVolume(v);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(e) => handleChange(parseFloat(e.target.value))}
        style={{ width: 80, accentColor: "var(--primaryBtn)" }}
      />
      <span
        style={{
          fontSize:    11,
          color:       volume === 0 ? "var(--danger)" : "var(--text3)",
          fontFamily:  "monospace",
          minWidth:    28,
          textAlign:   "right",
        }}
      >
        {volume === 0 ? "OFF" : `${Math.round(volume * 100)}%`}
      </span>
    </div>
  );
}
