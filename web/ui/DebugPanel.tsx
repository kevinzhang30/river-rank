"use client";

import { useState } from "react";

interface Props {
  state: unknown;
}

export function DebugPanel({ state }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Toggle button — sits above the action bar */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? "Close debug panel" : "Open debug panel"}
        style={{
          position: "fixed",
          bottom: 90,
          right: 16,
          zIndex: 300,
          background: open ? "#0d1f3c" : "#0a0e1a",
          border: `1px solid ${open ? "#1e3a6e" : "#1a2030"}`,
          borderRadius: 6,
          color: open ? "#64b5f6" : "#37474f",
          fontSize: 12,
          fontFamily: "monospace",
          fontWeight: 700,
          padding: "5px 11px",
          cursor: "pointer",
          letterSpacing: 0.5,
          transition: "color 0.15s, background 0.15s",
        }}
      >
        {"{ }"}
      </button>

      {/* Slide-in panel */}
      {open && (
        <>
          {/* Backdrop (click to close) */}
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 298,
              background: "rgba(0,0,0,0.25)",
            }}
          />

          {/* Panel */}
          <div
            style={{
              position: "fixed",
              top: 52,          // below header
              right: 0,
              bottom: 80,       // above action bar
              width: "min(460px, 90vw)",
              zIndex: 299,
              background: "rgba(5, 8, 18, 0.98)",
              borderLeft: "1px solid #1a2030",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Panel header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 16px",
                borderBottom: "1px solid #141928",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  color: "#37474f",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                }}
              >
                Debug · publicState
              </span>
              <span style={{ color: "#263238", fontSize: 11 }}>
                {state ? "live" : "null"}
              </span>
            </div>

            {/* JSON body */}
            <pre
              style={{
                margin: 0,
                padding: "14px 16px",
                fontSize: 11,
                lineHeight: 1.65,
                color: "#546e7a",
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                flex: 1,
              }}
            >
              {state === null || state === undefined
                ? "null"
                : JSON.stringify(state, null, 2)}
            </pre>
          </div>
        </>
      )}
    </>
  );
}
