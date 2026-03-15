"use client";

import { useState, useEffect } from "react";
import type { LegalActions } from "./types";
import { useIsMobile } from "@/lib/useIsMobile";

// ── Primitive button ──────────────────────────────────────────────────────────

type BtnVariant = "fold" | "call" | "check" | "raise" | "allin" | "preset";

interface BtnProps {
  label:     string;
  variant:   BtnVariant;
  disabled?: boolean;
  onClick?:  () => void;
  small?:    boolean;
  flex?:     number;
  active?:   boolean;
}

function ActionButton({ label, variant, disabled = false, onClick, small = false, flex, active = false }: BtnProps) {
  const h = small ? 34 : 44;

  const activeStyle: Partial<Record<BtnVariant, React.CSSProperties>> = {
    fold: {
      background: "rgba(239, 68, 68, 0.15)",
      color:      "var(--danger)",
      border:     "2px solid var(--danger)",
    },
    call: {
      background: "rgba(59, 130, 246, 0.15)",
      color:      "var(--primaryBtn)",
      border:     "2px solid var(--primaryBtn)",
    },
    raise: {
      background: "rgba(34, 197, 94, 0.15)",
      color:      "var(--success)",
      border:     "2px solid var(--success)",
    },
  };

  const variantStyle: Record<BtnVariant, React.CSSProperties> = {
    fold:  {
      background: "transparent",
      color:      disabled ? "var(--text3)" : "var(--danger)",
      border:     disabled ? "1px solid var(--border)" : "1px solid var(--danger)",
    },
    check: {
      background: "transparent",
      color:      disabled ? "var(--text3)" : "var(--success)",
      border:     disabled ? "1px solid var(--border)" : "1px solid var(--success)",
    },
    call:  {
      background: "transparent",
      color:      disabled ? "var(--text3)" : "var(--primaryBtn)",
      border:     disabled ? "1px solid var(--border)" : "1px solid var(--primaryBtn)",
    },
    raise: {
      background: "transparent",
      color:      disabled ? "var(--text3)" : "var(--success)",
      border:     disabled ? "1px solid var(--border)" : "1px solid var(--success)",
    },
    allin: {
      background: "transparent",
      color:      disabled ? "var(--text3)" : "#F97316",
      border:     disabled ? "1px solid var(--border)" : "1px solid #F97316",
    },
    preset: {
      background: "transparent",
      color:      disabled ? "var(--text3)" : "var(--text2)",
      border:     "1px solid var(--border)",
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        height:        h,
        padding:       small ? "0 10px" : "0 16px",
        borderRadius:  3,
        fontSize:      small ? 10 : 12,
        fontWeight:    700,
        fontFamily:    "monospace",
        letterSpacing: 1,
        cursor:        disabled ? "not-allowed" : "pointer",
        whiteSpace:    "nowrap",
        flexShrink:    0,
        textTransform: "uppercase",
        ...(flex !== undefined ? { flex } : {}),
        ...(active && activeStyle[variant]
          ? activeStyle[variant]
          : variantStyle[variant]),
      }}
    >
      {label}
    </button>
  );
}

// ── ActionBar ─────────────────────────────────────────────────────────────────

interface Props {
  legal:    LegalActions | undefined;
  pot:      number;
  bigBlind: number;
  onFold?:  () => void;
  onCheck?: () => void;
  onCall?:  () => void;
  onRaise?: (amount: number) => void;
  preAction?:      "fold-check" | { type: "raise"; amount: number } | null;
  onPreAction?:    (action: "fold-check" | { type: "raise"; amount: number } | null) => void;
  showPreActions?: boolean;
  preBetInvalid?:  boolean;
}

export function ActionBar({ legal, pot, bigBlind, onFold, onCheck, onCall, onRaise, preAction, onPreAction, showPreActions, preBetInvalid }: Props) {
  const isMobile = useIsMobile();
  const [rawInput, setRawInput] = useState("");

  useEffect(() => {
    setRawInput(legal?.minRaiseTo !== undefined ? String(legal.minRaiseTo) : "");
  }, [legal?.minRaiseTo]);

  const isActive = !!legal?.canFold;
  const canRaise = isActive && legal!.minRaiseTo !== undefined;
  const min      = legal?.minRaiseTo ?? 0;
  const max      = legal?.maxRaiseTo ?? 0;

  const parsedInput = parseInt(rawInput, 10);
  const inputValid  = canRaise && !isNaN(parsedInput) && parsedInput >= min && parsedInput <= max;

  function clampInput() {
    if (!canRaise) return;
    const n = parseInt(rawInput, 10);
    if (isNaN(n)) { setRawInput(String(min)); return; }
    if (n < min)  { setRawInput(String(min)); return; }
    if (n > max)  { setRawInput(String(max)); return; }
  }

  function handleRaiseSubmit() {
    if (!inputValid) return;
    onRaise?.(parsedInput);
  }

  function firePreset(amount: number) {
    setRawInput(String(amount));
    onRaise?.(amount);
  }

  const amt2x   = 2 * bigBlind;
  const show2x  = canRaise && amt2x >= min && amt2x <= max;

  const amtPot  = pot > 0 ? pot : bigBlind;
  const showPot = canRaise && amtPot >= min && amtPot <= max && amtPot !== max;

  const amtAllIn = max;

  const DIVIDER = (
    <div style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 2px" }} />
  );

  // Pre-bet input state (local to pre-action mode)
  const [preBetInput, setPreBetInput] = useState("");
  const preBetParsed = parseInt(preBetInput, 10);
  const preBetValid  = !isNaN(preBetParsed) && preBetParsed > 0;
  const hasPreBet    = typeof preAction === "object" && preAction !== null && preAction.type === "raise";

  if (showPreActions && !isActive) {
    return (
      <div
        style={{
          background:    "var(--surface)",
          borderTop:     "1px solid var(--border)",
          flexShrink:    0,
          padding:       isMobile ? "8px 10px 10px" : "10px 20px 12px",
          display:       "flex",
          flexDirection: "row",
          gap:           6,
          alignItems:    "center",
        }}
      >
        {/* Fold / Check toggle */}
        <ActionButton
          label="Fold / Check"
          variant="fold"
          active={preAction === "fold-check"}
          onClick={() => {
            setPreBetInput("");
            onPreAction?.(preAction === "fold-check" ? null : "fold-check");
          }}
          flex={1}
        />

        {/* Pre-bet input + button, or invalidation notice */}
        {preBetInvalid ? (
          <div
            style={{
              flex:          1,
              height:        34,
              display:       "flex",
              alignItems:    "center",
              justifyContent: "center",
              fontSize:      10,
              fontWeight:    700,
              letterSpacing: 1.5,
              color:         "var(--danger)",
              textTransform: "uppercase",
            }}
          >
            PRE-BET INVALIDATED
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="number"
              placeholder="Amount"
              value={hasPreBet ? "" : preBetInput}
              disabled={hasPreBet}
              onChange={(e) => setPreBetInput(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter" && preBetValid) {
                  onPreAction?.({ type: "raise", amount: preBetParsed });
                  setPreBetInput("");
                }
              }}
              id="pre-raise-input"
              style={{
                width:        isMobile ? 64 : 80,
                height:       34,
                background:   hasPreBet ? "var(--surface)" : "var(--surface2)",
                border:       "1px solid var(--border)",
                borderRadius: 3,
                color:        hasPreBet ? "var(--text3)" : "var(--text)",
                fontSize:     13,
                fontFamily:   "monospace",
                fontWeight:   600,
                padding:      "0 8px",
                outline:      "none",
                textAlign:    "right",
              }}
            />
            <ActionButton
              label={hasPreBet ? `Pre-Raise $${(preAction as { type: "raise"; amount: number }).amount}` : preBetValid ? `Pre-Raise $${preBetParsed}` : "Pre-Raise"}
              variant="raise"
              active={hasPreBet}
              disabled={!hasPreBet && !preBetValid}
              onClick={() => {
                if (hasPreBet) {
                  // Cancel pre-bet
                  onPreAction?.(null);
                } else if (preBetValid) {
                  onPreAction?.({ type: "raise", amount: preBetParsed });
                  setPreBetInput("");
                }
              }}
              flex={1}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        background:    "var(--surface)",
        borderTop:     "1px solid var(--border)",
        flexShrink:    0,
        padding:       canRaise
          ? (isMobile ? "8px 10px 10px" : "10px 20px 12px")
          : (isMobile ? "10px 10px" : "14px 20px"),
        display:       "flex",
        flexDirection: "column",
        gap:           8,
      }}
    >
      {/* ── Row 1: Fold | Check/Call | Raise ──────────────────────────── */}
      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton label="Fold" variant="fold" disabled={!isActive} onClick={onFold} flex={1} />

        {legal?.canCheck ? (
          <ActionButton label="Check" variant="check" disabled={!isActive} onClick={onCheck} flex={2} />
        ) : (
          <ActionButton
            label={legal?.callAmount ? `Call  $${legal.callAmount}` : "Call"}
            variant="call"
            disabled={!isActive || !legal?.canCall}
            onClick={onCall}
            flex={2}
          />
        )}

        {canRaise && (
          <ActionButton
            label={inputValid ? `Raise  $${parsedInput}` : "Raise"}
            variant="raise"
            disabled={!inputValid}
            onClick={handleRaiseSubmit}
            flex={2}
          />
        )}
      </div>

      {/* ── Row 2: Presets + All-in + input ───────────────────────────── */}
      {canRaise && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: isMobile ? "wrap" : undefined }}>
          {show2x && (
            <ActionButton label={`2×  $${amt2x}`} variant="preset" small onClick={() => firePreset(amt2x)} />
          )}
          {showPot && (
            <ActionButton label={`Pot  $${amtPot}`} variant="preset" small onClick={() => firePreset(amtPot)} />
          )}

          {DIVIDER}

          <ActionButton label={`All-in  $${amtAllIn}`} variant="allin" small onClick={() => firePreset(amtAllIn)} />

          <div style={{ flex: 1 }} />

          <span style={{ color: "var(--text3)", fontSize: 10, fontFamily: "monospace", whiteSpace: "nowrap" }}>
            ${min}–${max}
          </span>

          <input
            type="number"
            value={rawInput}
            min={min}
            max={max}
            onChange={(e) => setRawInput(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={clampInput}
            onKeyDown={(e) => e.key === "Enter" && handleRaiseSubmit()}
            id="raise-input"
            style={{
              width:        isMobile ? 64 : 80,
              height:       34,
              background:   "var(--surface2)",
              border:       `1px solid ${inputValid ? "var(--border)" : "var(--danger)"}`,
              borderRadius: 3,
              color:        inputValid ? "var(--text)" : "var(--danger)",
              fontSize:     13,
              fontFamily:   "monospace",
              fontWeight:   600,
              padding:      "0 8px",
              outline:      "none",
              textAlign:    "right",
            }}
          />
        </div>
      )}
    </div>
  );
}
