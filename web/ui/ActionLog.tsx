"use client";

import { useState } from "react";
import type { LogEntry } from "./types";

function fmt(entry: LogEntry): string {
  if (!entry.username) return entry.action;
  return entry.amount != null ? `${entry.action} $${entry.amount}` : entry.action;
}

const ACTION_TEXT: Record<string, string> = {
  fold:  "var(--danger)",
  check: "var(--text3)",
  call:  "var(--text2)",
  raise: "var(--text)",
  wins:  "var(--success)",
  post:  "var(--text3)",
};

export function ActionLog({ entries }: { entries: LogEntry[] }) {
  const [open, setOpen] = useState(true);

  const recent = [...entries].reverse().slice(0, 12);

  return (
    <div
      style={{
        width:         open ? 172 : 36,
        flexShrink:    0,
        borderLeft:    "1px solid var(--border)",
        background:    "var(--bg)",
        display:       "flex",
        flexDirection: "column",
        transition:    "width 0.2s ease",
        overflow:      "hidden",
      }}
    >
      {/* Header / toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display:       "flex",
          alignItems:    "center",
          gap:           6,
          padding:       "10px 10px",
          background:    "none",
          border:        "none",
          borderBottom:  "1px solid var(--border)",
          cursor:        "pointer",
          width:         "100%",
          color:         "var(--text3)",
          fontFamily:    "monospace",
          fontSize:      9,
          fontWeight:    700,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          flexShrink:    0,
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? "›" : "‹"}</span>
        {open && <span>Activity</span>}
      </button>

      {/* Entries */}
      {open && (
        <div
          style={{
            flex:      1,
            overflowY: "auto",
            padding:   "6px 0",
          }}
        >
          {recent.length === 0 && (
            <div style={{ color: "var(--text3)", fontSize: 9, padding: "6px 10px" }}>
              —
            </div>
          )}

          {recent.map((entry, i) => {
            const opacity = i === 0 ? 1 : i < 4 ? 0.55 : 0.3;

            const isStreetLabel = !entry.username;
            if (isStreetLabel) {
              return (
                <div
                  key={i}
                  style={{
                    padding:       "5px 10px",
                    fontSize:      9,
                    fontWeight:    700,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    color:         "var(--text3)",
                    borderTop:     i > 0 ? "1px solid var(--border)" : "none",
                    marginTop:     i > 0 ? 4 : 0,
                    opacity,
                  }}
                >
                  — {entry.action} —
                </div>
              );
            }

            const textColor = ACTION_TEXT[entry.action] ?? "var(--text3)";

            return (
              <div
                key={i}
                style={{
                  padding:    "4px 10px",
                  borderLeft: i === 0 ? "2px solid var(--primaryBtn)" : "2px solid transparent",
                  background: i === 0 ? "var(--surface)" : "transparent",
                  opacity,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                  <span
                    style={{
                      color:        "var(--text2)",
                      fontSize:     9,
                      fontWeight:   500,
                      overflow:     "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace:   "nowrap",
                      maxWidth:     72,
                    }}
                  >
                    {entry.username}
                  </span>
                  <span
                    style={{
                      fontSize:   9,
                      color:      textColor,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      fontFamily: "monospace",
                    }}
                  >
                    {fmt(entry)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
