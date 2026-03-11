"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicGameState, HandResult } from "./types";
import { Card, EmptyCardSlot } from "./Card";
import { PlayerPanel } from "./PlayerPanel";
import { ActionBar } from "./ActionBar";
import { ActionLog } from "./ActionLog";
import { ThemeToggle } from "./ThemeToggle";
import { DeckToggle } from "./DeckToggle";
import { HandCheatSheet } from "./HandCheatSheet";

const STREET_LABEL: Record<string, string> = {
  preflop:  "PREFLOP",
  flop:     "FLOP",
  turn:     "TURN",
  river:    "RIVER",
  showdown: "SHOWDOWN",
};

interface Props {
  state:         PublicGameState;
  heroUserId:    string;
  heroHoleCards: [string, string] | null;
  onFold?:       () => void;
  onCheck?:      () => void;
  onCall?:       () => void;
  onRaise?:      (amount: number) => void;
  onReveal?:     (cards: string[]) => void;
  onForfeit?:              () => void;
  opponentDisconnectedAt?: number | null;
}

export function PokerTable({
  state,
  heroUserId,
  heroHoleCards,
  onFold,
  onCheck,
  onCall,
  onRaise,
  onReveal,
  onForfeit,
  opponentDisconnectedAt,
}: Props) {
  const [, setTick] = useState(0);
  const handResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [pickingCard, setPickingCard] = useState(false);
  const [forfeitConfirm, setForfeitConfirm] = useState(false);
  const forfeitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 250ms interval: keeps the turn countdown ticking smoothly
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(interval);
  }, []);

  // One-shot timeout to clear the handResult overlay exactly when it expires
  useEffect(() => {
    if (handResultTimerRef.current) clearTimeout(handResultTimerRef.current);
    if (state.handResult) {
      const remaining = state.handResult.showUntilMs - Date.now();
      if (remaining > 0) {
        handResultTimerRef.current = setTimeout(() => setTick((t) => t + 1), remaining + 50);
      }
    }
    return () => { if (handResultTimerRef.current) clearTimeout(handResultTimerRef.current); };
  }, [state.handResult?.handId]);

  // Reset pick-card mode when hand changes
  useEffect(() => {
    setPickingCard(false);
  }, [state.handResult?.handId]);

  const activeHandResult: HandResult | null =
    state.handResult && Date.now() < state.handResult.showUntilMs
      ? state.handResult
      : null;

  const hero     = state.players.find((p) => p.userId === heroUserId) ?? state.players[1];
  const opponent = state.players.find((p) => p.userId !== heroUserId) ?? state.players[0];

  // Derive per-player showdown / reveal data
  const opponentRevealedCards: string[] | null =
    activeHandResult?.showdown?.holeCards?.[opponent.userId]
      ? [...activeHandResult.showdown.holeCards[opponent.userId]]
      : activeHandResult?.reveals?.[opponent.userId] ?? null;

  const opponentCategory = activeHandResult?.showdown?.hands?.[opponent.userId]?.category ?? null;
  const heroCategory     = activeHandResult?.showdown?.hands?.[heroUserId]?.category ?? null;

  // Show reveal buttons only after a fold, before hero has revealed
  const showRevealButtons =
    activeHandResult !== null &&
    activeHandResult.reason === "FOLD" &&
    !activeHandResult.reveals?.[heroUserId] &&
    heroHoleCards !== null;

  const legal = state.legalActions ?? (
    hero.isToAct && !hero.folded
      ? {
          canFold:    true,
          canCheck:   opponent.bet === hero.bet,
          canCall:    opponent.bet > hero.bet,
          callAmount: Math.max(0, opponent.bet - hero.bet),
        }
      : undefined
  );

  return (
    <div
      style={{
        height:        "100vh",
        display:       "flex",
        flexDirection: "column",
        background:    "var(--bg)",
        color:         "var(--text)",
        fontFamily:    "monospace",
        overflow:      "hidden",
      }}
    >
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div
        style={{
          height:         44,
          background:     "var(--surface)",
          borderBottom:   "1px solid var(--border)",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "0 18px",
          flexShrink:     0,
        }}
      >
        <span className="wordmark" style={{ fontWeight: 800, fontSize: 12, color: "var(--text)" }}>
          RiverRank ♠
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 10 }}>
          <span>
            <span style={{ color: "var(--text3)" }}>HAND </span>
            <span style={{ color: "var(--text2)" }}>#{state.handNumber}</span>
          </span>
          <span style={{ color: "var(--border)" }}>|</span>
          <span style={{ color: "var(--text2)", letterSpacing: 1 }}>
            {STREET_LABEL[state.street] ?? state.street.toUpperCase()}
          </span>
          <span style={{ color: "var(--border)" }}>|</span>
          <span>
            <span style={{ color: "var(--text3)" }}>BLINDS </span>
            <span style={{ color: "var(--text2)" }}>{state.smallBlind}/{state.bigBlind}</span>
          </span>
          {state.handsUntilBlindIncrease !== undefined && state.nextBigBlind !== undefined && (
            <>
              <span style={{ color: "var(--border)" }}>|</span>
              <span>
                <span style={{ color: "var(--text3)" }}>UP IN </span>
                <span
                  style={{
                    color:      state.handsUntilBlindIncrease <= 1 ? "var(--danger)" : "var(--text2)",
                    fontWeight: state.handsUntilBlindIncrease <= 1 ? 800 : undefined,
                  }}
                >
                  {state.handsUntilBlindIncrease}
                </span>
                <span style={{ color: "var(--text3)" }}> → </span>
                <span style={{ color: "var(--text2)" }}>
                  {state.nextSmallBlind}/{state.nextBigBlind}
                </span>
              </span>
            </>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              background:    "transparent",
              color:         state.mode === "ranked" ? "var(--primaryBtn)" : "var(--text3)",
              border:        state.mode === "ranked"
                ? "1px solid var(--primaryBtn)"
                : "1px solid var(--border)",
              borderRadius:  2,
              padding:       "2px 8px",
              fontSize:      9,
              fontWeight:    700,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            {state.mode}
          </span>
          <button
            onClick={() => {
              if (forfeitConfirm) {
                onForfeit?.();
                setForfeitConfirm(false);
                if (forfeitTimerRef.current) clearTimeout(forfeitTimerRef.current);
              } else {
                setForfeitConfirm(true);
                forfeitTimerRef.current = setTimeout(() => setForfeitConfirm(false), 3000);
              }
            }}
            style={{
              background:    "transparent",
              color:         forfeitConfirm ? "var(--danger)" : "var(--text3)",
              border:        forfeitConfirm
                ? "1px solid var(--danger)"
                : "1px solid var(--border)",
              borderRadius:  2,
              padding:       "2px 8px",
              fontSize:      9,
              fontWeight:    700,
              cursor:        "pointer",
              fontFamily:    "monospace",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {forfeitConfirm ? "Confirm?" : "Forfeit"}
          </button>
          <button
            onClick={() => setShowCheatSheet(true)}
            title="Hand rankings"
            style={{
              background:    "transparent",
              color:         "var(--text3)",
              border:        "1px solid var(--border)",
              borderRadius:  2,
              width:         22,
              height:        22,
              display:       "flex",
              alignItems:    "center",
              justifyContent: "center",
              fontSize:      11,
              fontWeight:    700,
              cursor:        "pointer",
              padding:       0,
              flexShrink:    0,
            }}
          >
            ?
          </button>
          <DeckToggle />
          <ThemeToggle />
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Table column */}
        <div
          style={{
            flex:           1,
            display:        "flex",
            flexDirection:  "column",
            alignItems:     "center",
            justifyContent: "space-between",
            padding:        "28px 32px",
            overflow:       "hidden",
            background:     "var(--bg)",
          }}
        >
          {/* Opponent */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <PlayerPanel
              player={opponent}
              isHero={false}
              handResult={activeHandResult}
              turnDeadlineMs={state.turnDeadlineMs}
              revealedCards={opponentRevealedCards}
              handCategory={opponentCategory}
            />
            {opponentDisconnectedAt != null && (() => {
              const remaining = Math.max(0, Math.ceil((opponentDisconnectedAt + 30_000 - Date.now()) / 1000));
              return (
                <div
                  style={{
                    background:       "var(--surface2)",
                    border:           "1px solid var(--danger)",
                    borderRadius:     3,
                    padding:          "3px 10px",
                    fontSize:         10,
                    fontWeight:       700,
                    color:            "var(--danger)",
                    letterSpacing:    0.5,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  Disconnected — {remaining}s to reconnect
                </div>
              );
            })()}
          </div>

          {/* Board */}
          <div
            style={{
              display:       "flex",
              flexDirection: "column",
              alignItems:    "center",
              gap:           16,
            }}
          >
            {/* Pot / Hand-complete */}
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, textAlign: "center" }}>
              {activeHandResult ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "var(--text3)", fontSize: 9, letterSpacing: 2 }}>
                    HAND COMPLETE
                  </span>
                  <span style={{ color: "var(--success)", fontWeight: 800, fontSize: 15 }}>
                    {activeHandResult.winnerUserId === null
                      ? "SPLIT POT"
                      : `${state.players.find(p => p.userId === activeHandResult.winnerUserId)?.username ?? "?"} WINS $${activeHandResult.pot}`
                    }
                  </span>
                  <span style={{ color: "var(--text3)", fontSize: 9, letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>
                    NEXT HAND IN {Math.max(0, Math.ceil((activeHandResult.showUntilMs - Date.now()) / 1000))}s
                  </span>
                </div>
              ) : state.pot > 0 ? (
                <span>
                  <span style={{ color: "var(--text3)" }}>POT  </span>
                  <span style={{ color: "var(--primaryBtn)", fontSize: 15, fontWeight: 800 }}>
                    ${state.pot}
                  </span>
                </span>
              ) : (
                <span style={{ color: "var(--text3)" }}>POT  $0</span>
              )}
            </div>

            {/* Community cards */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {Array.from({ length: 5 }).map((_, i) =>
                state.board[i] ? (
                  <Card key={i} card={state.board[i]} size="sm" />
                ) : (
                  <EmptyCardSlot key={i} size="sm" />
                )
              )}
            </div>
          </div>

          {/* Hero */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <PlayerPanel
              player={hero}
              isHero={true}
              holeCards={heroHoleCards}
              handResult={activeHandResult}
              turnDeadlineMs={state.turnDeadlineMs}
              handCategory={heroCategory}
            />

            {/* Reveal buttons (fold only, before hero reveals) */}
            {showRevealButtons && !pickingCard && (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => { onReveal?.(heroHoleCards!); }}
                  style={{
                    background:    "transparent",
                    color:         "var(--text2)",
                    border:        "1px solid var(--border)",
                    borderRadius:  3,
                    padding:       "4px 12px",
                    fontSize:      10,
                    fontWeight:    700,
                    cursor:        "pointer",
                    fontFamily:    "monospace",
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  Show Hand
                </button>
                <button
                  onClick={() => setPickingCard(true)}
                  style={{
                    background:    "transparent",
                    color:         "var(--text3)",
                    border:        "1px solid var(--border)",
                    borderRadius:  3,
                    padding:       "4px 12px",
                    fontSize:      10,
                    fontWeight:    700,
                    cursor:        "pointer",
                    fontFamily:    "monospace",
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  Show Card
                </button>
              </div>
            )}

            {/* Pick-a-card mode */}
            {showRevealButtons && pickingCard && heroHoleCards && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--text3)", fontSize: 10, letterSpacing: 1 }}>PICK ONE:</span>
                {heroHoleCards.map((card, i) => (
                  <button
                    key={i}
                    onClick={() => { onReveal?.([card]); setPickingCard(false); }}
                    style={{
                      background:    "var(--surface2)",
                      color:         "var(--text)",
                      border:        "1px solid var(--border)",
                      borderRadius:  3,
                      padding:       "4px 14px",
                      fontSize:      13,
                      fontWeight:    700,
                      cursor:        "pointer",
                      fontFamily:    "monospace",
                      letterSpacing: 0.5,
                    }}
                  >
                    {card}
                  </button>
                ))}
                <button
                  onClick={() => setPickingCard(false)}
                  style={{
                    background: "none",
                    border:     "none",
                    color:      "var(--text3)",
                    fontSize:   13,
                    cursor:     "pointer",
                    padding:    "0 4px",
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Activity log */}
        <ActionLog entries={state.log} />
      </div>

      {/* ── Action bar ───────────────────────────────────────────────── */}
      <ActionBar
        legal={legal}
        pot={state.pot}
        bigBlind={state.bigBlind}
        onFold={onFold}
        onCheck={onCheck}
        onCall={onCall}
        onRaise={onRaise}
      />

      {showCheatSheet && <HandCheatSheet onClose={() => setShowCheatSheet(false)} />}
    </div>
  );
}
