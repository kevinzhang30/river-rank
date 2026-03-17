"use client";

import type { PublicPlayer, HandResult } from "./types";
import { Card, FacedownCard } from "./Card";
import { useIsMobile } from "@/lib/useIsMobile";

function DealerChip() {
  return (
    <span
      style={{
        width:          20,
        height:         20,
        borderRadius:   2,
        background:     "var(--surface2)",
        border:         "1px solid var(--border)",
        color:          "var(--text3)",
        fontSize:       9,
        fontWeight:     800,
        display:        "inline-flex",
        alignItems:     "center",
        justifyContent: "center",
        flexShrink:     0,
        letterSpacing:  0,
      }}
    >
      D
    </span>
  );
}

interface Props {
  player:          PublicPlayer;
  isHero:          boolean;
  holeCards?:      [string, string] | null;
  handResult?:     HandResult | null;
  turnDeadlineMs?: number;
  revealedCards?:  string[] | null;
  handCategory?:   string | null;
}

export function PlayerPanel({ player, isHero, holeCards, handResult, turnDeadlineMs, revealedCards, handCategory }: Props) {
  const isMobile = useIsMobile();
  const active = player.isToAct && !player.folded;

  const isWinner = !!handResult && handResult.winnerUserId === player.userId;
  const isLoser  = !!handResult && handResult.winnerUserId !== null && handResult.winnerUserId !== player.userId;
  const isSplit  = !!handResult && handResult.winnerUserId === null;
  const delta    = handResult ? (handResult.deltas[player.userId] ?? 0) : 0;

  // Countdown (only for the active player, no handResult overlay)
  const showTimer   = active && !handResult && !!turnDeadlineMs && turnDeadlineMs > 0;
  const secondsLeft = showTimer ? Math.max(0, Math.ceil((turnDeadlineMs! - Date.now()) / 1000)) : 0;
  const isUrgent    = showTimer && secondsLeft < 5;

  let borderColor  = active ? "var(--primaryBtn)" : "var(--border)";
  let borderWidth  = active ? 2 : 1;
  let bgColor      = active ? "var(--surface2)" : "var(--surface)";
  let opacity      = 1;

  if (isUrgent) { borderColor = "var(--danger)"; }

  if (handResult) {
    if (isWinner)     { borderColor = "var(--success)"; borderWidth = 2; bgColor = "var(--surface)"; }
    else if (isSplit) { borderColor = "var(--border)"; borderWidth = 1; bgColor = "var(--surface2)"; }
    else if (isLoser) { opacity = 0.35; bgColor = "var(--surface)"; }
  }

  const badge = handResult
    ? isWinner ? (
        <span style={{ color: "var(--success)", fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>WIN</span>
      ) : isSplit ? (
        <span style={{ color: "var(--text2)", fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>SPLIT</span>
      ) : (
        <span style={{ color: "var(--danger)", fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>LOSE</span>
      )
    : null;

  const infoBox = (
    <div
      style={{
        background:    bgColor,
        borderRadius:  4,
        border:        `${borderWidth}px solid ${borderColor}`,
        padding:       isMobile ? "10px 14px" : "14px 22px",
        display:       "flex",
        flexDirection: "column",
        alignItems:    "center",
        gap:           isMobile ? 4 : 8,
        minWidth:      isMobile ? 0 : 220,
        opacity,
        boxShadow:     active && !handResult
          ? isUrgent
            ? "0 0 12px 2px rgba(239, 68, 68, 0.35)"
            : "0 0 12px 2px rgba(59, 91, 219, 0.35)"
          : "none",
        transition:    "border-color 0.15s, opacity 0.15s, background 0.15s, box-shadow 0.15s",
      }}
    >
      {/* Name row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {player.isDealer && <DealerChip />}
        <span
          style={{
            color:         !handResult && active ? "var(--text)" : "var(--text2)",
            fontWeight:    700,
            fontSize:      13,
            letterSpacing: 0.8,
            textTransform: "uppercase",
          }}
        >
          {player.username}
        </span>
        {player.elo != null && (
          <span style={{ color: "var(--text3)", fontSize: 11, fontWeight: 500 }}>
            ({player.elo})
          </span>
        )}
        {player.folded && !handResult && (
          <span style={{ color: "var(--text3)", fontSize: 10, letterSpacing: 0.5 }}>FOLDED</span>
        )}
        {badge}
      </div>

      {/* Hand category (shown at showdown, during live play for hero, or during all-in runout) */}
      {handCategory && (
        <div style={{ color: "var(--text3)", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase" }}>
          {handCategory.replace(/_/g, " ")}
        </div>
      )}

      {/* Stack + bet + delta */}
      <div style={{ display: "flex", gap: 16, fontFamily: "monospace", alignItems: "baseline" }}>
        <span>
          <span style={{ color: "var(--text3)", fontSize: 11 }}>STACK  </span>
          <span style={{ color: !handResult && active ? "var(--text)" : "var(--text2)", fontWeight: 800, fontSize: 16 }}>
            ${player.stack}
          </span>
        </span>
        {player.bet > 0 && !handResult && (
          <span>
            <span style={{ color: "var(--text3)", fontSize: 11 }}>BET  </span>
            <span style={{ color: "var(--primaryBtn)", fontWeight: 700, fontSize: 14 }}>${player.bet}</span>
          </span>
        )}
        {handResult && delta !== 0 && (
          <span style={{ color: delta > 0 ? "var(--success)" : "var(--danger)", fontWeight: 800, fontSize: 15 }}>
            {delta > 0 ? "+" : ""}{delta}
          </span>
        )}
      </div>

      {/* Timer — shown below stack row for legibility */}
      {showTimer && (
        <div
          style={{
            display:       "flex",
            alignItems:    "center",
            justifyContent: "center",
            gap:           6,
          }}
        >
          <div
            style={{
              width:       `${(secondsLeft / 15) * 100}%`,
              maxWidth:    140,
              minWidth:    4,
              height:      3,
              background:  isUrgent ? "var(--danger)" : "var(--primaryBtn)",
              borderRadius: 2,
              transition:  "width 0.25s linear, background 0.15s",
            }}
          />
          <span
            style={{
              color:              isUrgent ? "var(--danger)" : "var(--text2)",
              fontSize:           13,
              fontWeight:         700,
              fontFamily:         "monospace",
              fontVariantNumeric: "tabular-nums",
              letterSpacing:      0,
              minWidth:           28,
            }}
          >
            {secondsLeft}s
          </span>
        </div>
      )}
    </div>
  );

  const cards = isHero ? (
    <div style={{ display: "flex", gap: 6 }}>
      {holeCards ? (
        <>
          <Card card={holeCards[0]} size="lg" />
          <Card card={holeCards[1]} size="lg" />
        </>
      ) : (
        <>
          <FacedownCard size="lg" />
          <FacedownCard size="lg" />
        </>
      )}
    </div>
  ) : (
    <div style={{ display: "flex", gap: 5 }}>
      {revealedCards && revealedCards.length > 0 ? (
        <>
          {revealedCards[0] ? <Card card={revealedCards[0]} size="sm" /> : <FacedownCard size="sm" />}
          {revealedCards[1] ? <Card card={revealedCards[1]} size="sm" /> : <FacedownCard size="sm" />}
        </>
      ) : (
        <>
          <FacedownCard size="sm" />
          <FacedownCard size="sm" />
        </>
      )}
    </div>
  );

  return (
    <div
      style={{
        display:       "flex",
        flexDirection: "column",
        alignItems:    "center",
        gap:           isMobile ? 6 : 10,
      }}
    >
      {!isHero && cards}
      {isHero && !handResult && active && (
        <span style={{ color: "var(--primaryBtn)", fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>YOUR TURN</span>
      )}
      {isHero && !handResult && !active && !player.folded && (
        <span style={{ color: "var(--text3)", fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>WAITING</span>
      )}
      {infoBox}
      {isHero && cards}
    </div>
  );
}
