"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { io, Socket } from "socket.io-client";
import { supabase } from "@/lib/supabaseClient";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { DeckToggle } from "@/ui/DeckToggle";
import { useIsMobile } from "@/lib/useIsMobile";
import type { LeaderboardEntry, Mode } from "@/ui/types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Profile {
  username: string | null;
  elo:      number;
  wins:     number;
  losses:   number;
  country:  string | null;
}

interface RecentMatch {
  id:          string;
  timeAgo:     string;
  opponent:    string;
  result:      "WIN" | "LOSS" | "DRAW";
  mode:        "ranked" | "unranked";
  ratingDelta: number | null; // null for unranked
}

interface Friend {
  id:       string;
  username: string;
  country:  string | null;
  elo:      number;
  wins:     number;
  losses:   number;
}

interface IncomingChallenge {
  challengeId:  string;
  fromUsername:  string;
  fromUserId:   string;
  mode:         Mode;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const m    = Math.floor(diff / 60_000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Card shell ────────────────────────────────────────────────────────────────

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?:   React.CSSProperties;
}) {
  return (
    <div
      style={{
        background:    "var(--surface)",
        border:        "1px solid var(--border)",
        borderRadius:  8,
        padding:       "1.5rem",
        fontFamily:    "monospace",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: 2,
        color:         "var(--text3)",
        textTransform: "uppercase",
        marginBottom:  "1rem",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Profile card ──────────────────────────────────────────────────────────────

function ProfileCard({ profile }: { profile: Profile }) {
  return (
    <Card>
      <CardLabel>Profile</CardLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", letterSpacing: 0.5 }}>
          {profile.username ?? "—"}{profile.country && COUNTRY_MAP[profile.country] ? ` ${COUNTRY_MAP[profile.country].flag}` : ""}
        </div>
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "baseline" }}>
          <span>
            <span style={{ fontSize: 26, fontWeight: 800, color: "#F59E0B" }}>{profile.elo}</span>
            <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4, letterSpacing: 1 }}>ELO</span>
          </span>
          <span style={{ color: "var(--text3)", fontSize: 12 }}>
            <span style={{ color: "var(--success)", fontWeight: 700 }}>{profile.wins}W</span>
            {" / "}
            <span style={{ color: "var(--danger)", fontWeight: 700 }}>{profile.losses}L</span>
          </span>
        </div>
        <div
          style={{
            display:      "flex",
            alignItems:   "center",
            gap:          6,
            paddingTop:   "0.25rem",
            borderTop:    "1px solid var(--border)",
          }}
        >
          <span
            style={{
              width:        6,
              height:       6,
              borderRadius: "50%",
              background:   "var(--success)",
              display:      "inline-block",
              flexShrink:   0,
            }}
          />
          <span style={{ fontSize: 11, color: "var(--text3)" }}>Online</span>
        </div>
      </div>
    </Card>
  );
}

// ── Play card ─────────────────────────────────────────────────────────────────

function PlayCard({ onPlay }: { onPlay: (mode: Mode) => void }) {
  return (
    <Card>
      <CardLabel>Play</CardLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        <button
          onClick={() => onPlay("ranked")}
          style={{
            background:    "var(--primaryBtn)",
            color:         "var(--primaryBtnText)",
            border:        "1px solid transparent",
            borderRadius:  4,
            padding:       "0.8rem 1.25rem",
            fontSize:      "0.95rem",
            fontFamily:    "monospace",
            fontWeight:    700,
            cursor:        "pointer",
            letterSpacing: 0.5,
            width:         "100%",
            textAlign:     "left",
          }}
        >
          Play Ranked
          <span style={{ float: "right", fontWeight: 400, fontSize: 11, opacity: 0.75 }}>
            Elo on the line
          </span>
        </button>
        <button
          onClick={() => onPlay("unranked")}
          style={{
            background:    "transparent",
            color:         "var(--primaryBtn)",
            border:        "1px solid var(--primaryBtn)",
            borderRadius:  4,
            padding:       "0.8rem 1.25rem",
            fontSize:      "0.95rem",
            fontFamily:    "monospace",
            fontWeight:    700,
            cursor:        "pointer",
            letterSpacing: 0.5,
            width:         "100%",
            textAlign:     "left",
          }}
        >
          Play Unranked
          <span style={{ float: "right", fontWeight: 400, fontSize: 11, opacity: 0.75 }}>
            Just for fun
          </span>
        </button>
        <p style={{ margin: 0, color: "var(--text3)", fontSize: 11, paddingTop: "0.25rem" }}>
          Heads-up No-Limit Hold'em · 20s turns · Blinds ↑ every  3 hands
        </p>
      </div>
    </Card>
  );
}

// ── Bullet play card ─────────────────────────────────────────────────────────

function BulletPlayCard({ onPlay }: { onPlay: (mode: Mode) => void }) {
  return (
    <Card>
      <CardLabel>Bullet</CardLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        <button
          onClick={() => onPlay("bullet")}
          style={{
            background:    "transparent",
            color:         "#14B8A6",
            border:        "1px solid #14B8A6",
            borderRadius:  4,
            padding:       "0.8rem 1.25rem",
            fontSize:      "0.95rem",
            fontFamily:    "monospace",
            fontWeight:    700,
            cursor:        "pointer",
            letterSpacing: 0.5,
            width:         "100%",
            textAlign:     "left",
          }}
        >
          Play Bullet
          <span style={{ float: "right", fontWeight: 400, fontSize: 11, opacity: 0.75 }}>
            Just for fun
          </span>
        </button>
        <p style={{ margin: 0, color: "var(--text3)", fontSize: 11, paddingTop: "0.25rem" }}>
          Heads-up No-Limit Hold'em · 10s turns · Blinds ↑ every 2 hands
        </p>
      </div>
    </Card>
  );
}

// ── Tournament card ──────────────────────────────────────────────────────────

function TournamentCard({
  dashboardSocket,
  onNavigate,
}: {
  dashboardSocket: Socket | null;
  onNavigate: (path: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleCreate(size: 4 | 8) {
    if (!dashboardSocket?.connected) return;
    setLoading(true);
    setError(null);
    dashboardSocket.emit(
      "tournament.create",
      { size },
      (res: { tournamentId?: string; joinCode?: string; error?: string }) => {
        setLoading(false);
        if (res.error) {
          setError(res.error);
        } else if (res.tournamentId) {
          onNavigate(`/tournament/${res.tournamentId}`);
        }
      },
    );
  }

  function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (!code || !dashboardSocket?.connected) return;
    setLoading(true);
    setError(null);
    dashboardSocket.emit(
      "tournament.join",
      { joinCode: code },
      (res: { tournamentId?: string; error?: string }) => {
        setLoading(false);
        if (res.error) {
          setError(res.error);
        } else if (res.tournamentId) {
          onNavigate(`/tournament/${res.tournamentId}`);
        }
      },
    );
  }

  return (
    <Card>
      <CardLabel>Tournament</CardLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        {!showCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            style={{
              background:    "#8B5CF6",
              color:         "#fff",
              border:        "1px solid transparent",
              borderRadius:  4,
              padding:       "0.8rem 1.25rem",
              fontSize:      "0.95rem",
              fontFamily:    "monospace",
              fontWeight:    700,
              cursor:        "pointer",
              letterSpacing: 0.5,
              width:         "100%",
              textAlign:     "left",
            }}
          >
            Create Tournament
            <span style={{ float: "right", fontWeight: 400, fontSize: 11, opacity: 0.75 }}>
              Host a bracket
            </span>
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            {([4, 8] as const).map((size) => (
              <button
                key={size}
                onClick={() => handleCreate(size)}
                disabled={loading}
                style={{
                  flex:          1,
                  background:    "#8B5CF6",
                  color:         "#fff",
                  border:        "1px solid transparent",
                  borderRadius:  4,
                  padding:       "0.7rem",
                  fontSize:      "0.9rem",
                  fontFamily:    "monospace",
                  fontWeight:    700,
                  cursor:        loading ? "not-allowed" : "pointer",
                  letterSpacing: 0.3,
                }}
              >
                {size} Players
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={joinCode}
            onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="JOIN CODE"
            maxLength={6}
            spellCheck={false}
            style={{
              flex:          1,
              background:    "var(--surface2)",
              border:        "1px solid var(--border)",
              borderRadius:  4,
              color:         "var(--text)",
              padding:       "0.6rem 0.9rem",
              fontSize:      "0.9rem",
              fontFamily:    "monospace",
              outline:       "none",
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          />
          <button
            onClick={handleJoin}
            disabled={!joinCode.trim() || loading}
            style={{
              background:    !joinCode.trim() || loading ? "var(--surface2)" : "transparent",
              color:         !joinCode.trim() || loading ? "var(--text3)" : "#8B5CF6",
              border:        `1px solid ${!joinCode.trim() || loading ? "var(--border)" : "#8B5CF6"}`,
              borderRadius:  4,
              padding:       "0.6rem 1rem",
              fontSize:      "0.9rem",
              fontFamily:    "monospace",
              fontWeight:    700,
              cursor:        !joinCode.trim() || loading ? "not-allowed" : "pointer",
              letterSpacing: 0.3,
            }}
          >
            Join
          </button>
        </div>

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>
        )}

        <p style={{ margin: 0, color: "var(--text3)", fontSize: 11, paddingTop: "0.25rem" }}>
          Single elimination · Unranked · 4 or 8 players
        </p>
      </div>
    </Card>
  );
}

// ── Account card ──────────────────────────────────────────────────────────────

function AccountCard({
  onSignOut,
  currentUsername,
  userId,
  onUsernameChanged,
}: {
  onSignOut: () => void;
  currentUsername: string | null;
  userId: string | null;
  onUsernameChanged: (newName: string) => void;
}) {
  const [editing, setEditing]       = useState(false);
  const [draft, setDraft]           = useState(currentUsername ?? "");
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [cooldownEnd, setCooldownEnd] = useState<Date | null>(null);
  const [joinedAt, setJoinedAt] = useState<string | null>(null);

  // Fetch cooldown on mount
  useEffect(() => {
    if (!userId) return;
    supabase
      .from("profiles")
      .select("username_changed_at, created_at")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        if (data?.username_changed_at) {
          const end = new Date(new Date(data.username_changed_at).getTime() + 30 * 24 * 60 * 60 * 1000);
          if (end > new Date()) setCooldownEnd(end);
        }
        if (data?.created_at) setJoinedAt(data.created_at);
      });
  }, [userId]);

  const cooldownActive = cooldownEnd && cooldownEnd > new Date();
  const cooldownDaysLeft = cooldownActive
    ? Math.ceil((cooldownEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : 0;

  function startEditing() {
    setDraft(currentUsername ?? "");
    setError(null);
    setEditing(true);
  }

  async function saveUsername() {
    const trimmed = draft.trim();
    if (trimmed === currentUsername) { setEditing(false); return; }
    const hint = usernameHint(trimmed);
    if (hint) { setError(hint); return; }
    if (!userId) return;

    setSaving(true);
    setError(null);

    // Re-check cooldown server-side
    const { data: profile } = await supabase
      .from("profiles")
      .select("username_changed_at")
      .eq("id", userId)
      .single();
    if (profile?.username_changed_at) {
      const end = new Date(new Date(profile.username_changed_at).getTime() + 30 * 24 * 60 * 60 * 1000);
      if (end > new Date()) {
        setCooldownEnd(end);
        setError(`You can change your username again in ${Math.ceil((end.getTime() - Date.now()) / (24 * 60 * 60 * 1000))} days.`);
        setSaving(false);
        return;
      }
    }

    // Check availability
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", trimmed)
      .neq("id", userId)
      .maybeSingle();
    if (existing) { setError("Username is taken."); setSaving(false); return; }

    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ username: trimmed, username_changed_at: new Date().toISOString() })
      .eq("id", userId);
    if (updateErr) { setError("Failed to update."); setSaving(false); return; }

    setCooldownEnd(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    onUsernameChanged(trimmed);
    setEditing(false);
    setSaving(false);
  }

  return (
    <Card>
      <CardLabel>Settings</CardLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {/* Username */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: editing ? 8 : 0 }}>
            <span style={{ fontSize: 12, color: "var(--text2)" }}>Username</span>
            {!editing && (
              cooldownActive ? (
                <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "monospace" }}>
                  {cooldownDaysLeft}d cooldown
                </span>
              ) : (
                <button
                  onClick={startEditing}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--primaryBtn)",
                    fontSize: 11,
                    fontFamily: "monospace",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: "2px 4px",
                  }}
                >
                  Edit
                </button>
              )
            )}
          </div>
          {editing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") saveUsername(); if (e.key === "Escape") setEditing(false); }}
                maxLength={16}
                autoFocus
                style={{
                  background: "var(--surface2)",
                  border: `1px solid ${error ? "var(--danger)" : "var(--border)"}`,
                  borderRadius: 4,
                  padding: "0.45rem 0.6rem",
                  fontSize: 13,
                  fontFamily: "monospace",
                  color: "var(--text)",
                  outline: "none",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
              {error && <span style={{ fontSize: 11, color: "var(--danger)" }}>{error}</span>}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={saveUsername}
                  disabled={saving}
                  style={{
                    flex: 1,
                    background: "var(--primaryBtn)",
                    color: "var(--primaryBtnText)",
                    border: "1px solid transparent",
                    borderRadius: 4,
                    padding: "0.4rem 0.75rem",
                    fontSize: 11,
                    fontFamily: "monospace",
                    fontWeight: 700,
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  style={{
                    background: "transparent",
                    color: "var(--text3)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "0.4rem 0.75rem",
                    fontSize: 11,
                    fontFamily: "monospace",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
              {currentUsername ?? "—"}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--text2)" }}>Theme</span>
          <ThemeToggle />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--text2)" }}>4-colour deck</span>
          <DeckToggle />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--text2)" }}>Joined</span>
          <span style={{ fontSize: 12, color: "var(--text3)", fontFamily: "monospace" }}>
            {joinedAt ? new Date(joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
          </span>
        </div>
        <div
          style={{
            borderTop:  "1px solid var(--border)",
            paddingTop: "0.75rem",
            marginTop:  "0.25rem",
          }}
        >
          <button
            onClick={onSignOut}
            style={{
              background:    "transparent",
              color:         "var(--text3)",
              border:        "1px solid var(--border)",
              borderRadius:  4,
              padding:       "0.5rem 1rem",
              fontSize:      11,
              fontFamily:    "monospace",
              fontWeight:    600,
              cursor:        "pointer",
              letterSpacing: 0.5,
              width:         "100%",
              textTransform: "uppercase",
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </Card>
  );
}

// ── Leaderboard card ──────────────────────────────────────────────────────────

function LeaderboardCard({
  entries,
  scope,
  onScopeChange,
  userRank,
  userCountry,
}: {
  entries:       LeaderboardEntry[];
  scope:         "global" | "national";
  onScopeChange: (scope: "global" | "national") => void;
  userRank:      { global: number | null; national: number | null };
  userCountry:   string | null | undefined;
}) {
  const rankValue = scope === "global" ? userRank.global : userRank.national;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <CardLabel style={{ marginBottom: 0 }}>Leaderboard</CardLabel>
        <div style={{ display: "grid", gridTemplateColumns: userCountry ? "1fr 1fr" : "1fr", gap: 6 }}>
          {(["global", ...(userCountry ? ["national"] : [])] as const).map((s) => (
            <button
              key={s}
              onClick={() => onScopeChange(s as "global" | "national")}
              style={{
                background:    scope === s ? "var(--primaryBtn)" : "var(--surface2)",
                color:         scope === s ? "var(--primaryBtnText)" : "var(--text2)",
                border:        `1px solid ${scope === s ? "transparent" : "var(--border)"}`,
                borderRadius:  4,
                padding:       "0.35rem 0.65rem",
                fontSize:      10,
                fontFamily:    "monospace",
                fontWeight:    scope === s ? 700 : 400,
                cursor:        "pointer",
                letterSpacing: 0.3,
                textTransform: "capitalize",
              }}
            >
              {s === "national" && userCountry && COUNTRY_MAP[userCountry] ? `${COUNTRY_MAP[userCountry].flag} ` : ""}{s}
            </button>
          ))}
        </div>
      </div>
      {entries.length === 0 ? (
        <div style={{ color: "var(--text3)", fontSize: 12, textAlign: "center", padding: "0.5rem 0" }}>
          No players yet
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["#", "Player", "Elo", "W/L"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign:     h === "Player" ? "left" : "right",
                    color:         "var(--text3)",
                    fontSize:      10,
                    fontWeight:    600,
                    letterSpacing: 1,
                    paddingBottom: "0.5rem",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr
                key={e.id}
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <td style={{ color: "var(--text3)", fontSize: 12, textAlign: "right", paddingRight: 10, width: 20, paddingTop: "0.45rem", paddingBottom: "0.45rem" }}>
                  {i + 1}
                </td>
                <td style={{ color: "var(--text)", fontSize: 13, fontWeight: 600, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.country && COUNTRY_MAP[e.country] ? `${COUNTRY_MAP[e.country].flag} ` : ""}{e.username}
                </td>
                <td style={{ color: "#F59E0B", fontSize: 13, fontWeight: 700, textAlign: "right" }}>
                  {e.elo}
                </td>
                <td style={{ color: "var(--text2)", fontSize: 11, textAlign: "right", paddingLeft: 12 }}>
                  {e.wins}–{e.losses}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rankValue !== null && (
        <div
          style={{
            marginTop:     "0.75rem",
            paddingTop:    "0.75rem",
            borderTop:     "1px solid var(--border)",
            fontSize:      12,
            color:         "var(--text2)",
            textAlign:     "center",
          }}
        >
          You are ranked <span style={{ fontWeight: 700, color: "var(--text)" }}>#{rankValue}</span> {scope === "national" ? "nationally" : "globally"}
        </div>
      )}
    </Card>
  );
}

// ── Recent Matches card ───────────────────────────────────────────────────────

function RecentMatchesCard({ matches }: { matches: RecentMatch[] }) {
  return (
    <Card>
      <CardLabel>Recent Matches</CardLabel>
      {matches.length === 0 ? (
        <div style={{ color: "var(--text3)", fontSize: 13, textAlign: "center", padding: "1.5rem 0" }}>
          No matches yet — play a game to see your history here.
        </div>
      ) : (
        <div
          style={{
            display:    "flex",
            flexDirection: "column",
            gap:        "0.5rem",
            maxHeight:  360,
            overflowY:  "auto",
          }}
        >
          {matches.map((m) => (
            <div
              key={m.id}
              style={{
                display:      "flex",
                alignItems:   "center",
                gap:          "0.75rem",
                padding:      "0.65rem 0.75rem",
                background:   "var(--surface2)",
                borderRadius: 4,
                border:       "1px solid var(--border)",
              }}
            >
              {/* Result badge */}
              <span
                style={{
                  fontSize:      11,
                  fontWeight:    800,
                  letterSpacing: 1,
                  color:
                    m.result === "WIN"  ? "var(--success)" :
                    m.result === "LOSS" ? "var(--danger)"  : "var(--text2)",
                  minWidth:      34,
                }}
              >
                {m.result}
              </span>

              {/* Opponent */}
              <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                vs {m.opponent}
              </span>

              {/* Rating delta — ranked only */}
              {m.ratingDelta !== null && (
                <span
                  style={{
                    fontSize:   12,
                    fontWeight: 700,
                    color:      m.ratingDelta >= 0 ? "var(--success)" : "var(--danger)",
                    minWidth:   36,
                    textAlign:  "right",
                  }}
                >
                  {m.ratingDelta >= 0 ? `+${m.ratingDelta}` : m.ratingDelta}
                </span>
              )}

              {/* Mode tag */}
              <span
                style={{
                  fontSize:      9,
                  fontWeight:    700,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color:         m.mode === "ranked" ? "var(--primaryBtn)" : "var(--text3)",
                  border:        `1px solid ${m.mode === "ranked" ? "var(--primaryBtn)" : "var(--border)"}`,
                  borderRadius:  2,
                  padding:       "2px 6px",
                  whiteSpace:    "nowrap",
                }}
              >
                {m.mode}
              </span>

              {/* Time */}
              <span style={{ fontSize: 11, color: "var(--text3)", minWidth: 48, textAlign: "right" }}>
                {m.timeAgo}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Friends card ─────────────────────────────────────────────────────────────

function FriendsCard({
  friends,
  friendCode,
  onChallenge,
  pendingChallenge,
  onAcceptChallenge,
  onDeclineChallenge,
  onCancelChallenge,
  challengeWaiting,
}: {
  friends:            Friend[];
  friendCode:         string | null;
  onChallenge:        (friendId: string, mode: Mode) => void;
  pendingChallenge:   IncomingChallenge | null;
  onAcceptChallenge:  () => void;
  onDeclineChallenge: () => void;
  onCancelChallenge:  () => void;
  challengeWaiting:   { friendId: string; challengeId: string } | null;
}) {
  const [showLink, setShowLink] = useState(false);
  const [copied, setCopied]     = useState(false);

  const link = friendCode ? `riverrank.io/?friend=${friendCode}` : "";

  function copyLink() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <CardLabel style={{ marginBottom: 0 }}>Friends</CardLabel>
        <button
          onClick={() => setShowLink((s) => !s)}
          style={{
            background:    "var(--primaryBtn)",
            color:         "var(--primaryBtnText)",
            border:        "none",
            borderRadius:  4,
            padding:       "0.35rem 0.65rem",
            fontSize:      10,
            fontFamily:    "monospace",
            fontWeight:    700,
            cursor:        "pointer",
            letterSpacing: 0.3,
          }}
        >
          {showLink ? "Hide Link" : "Add Friend"}
        </button>
      </div>

      {/* Share link */}
      {showLink && friendCode && (
        <div
          style={{
            display:      "flex",
            alignItems:   "center",
            gap:          8,
            padding:      "0.6rem 0.75rem",
            background:   "var(--surface2)",
            borderRadius: 4,
            border:       "1px solid var(--border)",
            marginBottom: "0.75rem",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {link}
          </span>
          <button
            onClick={copyLink}
            style={{
              background:   "transparent",
              color:        copied ? "var(--success)" : "var(--primaryBtn)",
              border:       `1px solid ${copied ? "var(--success)" : "var(--primaryBtn)"}`,
              borderRadius: 4,
              padding:      "0.25rem 0.5rem",
              fontSize:     10,
              fontFamily:   "monospace",
              fontWeight:   700,
              cursor:       "pointer",
              whiteSpace:   "nowrap",
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}

      {/* Incoming challenge banner */}
      {pendingChallenge && (
        <div
          style={{
            display:      "flex",
            alignItems:   "center",
            gap:          8,
            padding:      "0.6rem 0.75rem",
            background:   "var(--surface2)",
            borderRadius: 4,
            border:       "1px solid var(--primaryBtn)",
            marginBottom: "0.75rem",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text)", flex: 1 }}>
            <strong>{pendingChallenge.fromUsername}</strong> challenges you to {pendingChallenge.mode}!
          </span>
          <button
            onClick={onAcceptChallenge}
            style={{
              background:   "var(--primaryBtn)",
              color:        "var(--primaryBtnText)",
              border:       "none",
              borderRadius: 4,
              padding:      "0.3rem 0.6rem",
              fontSize:     10,
              fontFamily:   "monospace",
              fontWeight:   700,
              cursor:       "pointer",
            }}
          >
            Accept
          </button>
          <button
            onClick={onDeclineChallenge}
            style={{
              background:   "transparent",
              color:        "var(--text3)",
              border:       "1px solid var(--border)",
              borderRadius: 4,
              padding:      "0.3rem 0.6rem",
              fontSize:     10,
              fontFamily:   "monospace",
              fontWeight:   700,
              cursor:       "pointer",
            }}
          >
            Decline
          </button>
        </div>
      )}

      {/* Friends list */}
      {friends.length === 0 ? (
        <div style={{ color: "var(--text3)", fontSize: 12, textAlign: "center", padding: "1rem 0" }}>
          No friends yet — share your link to add friends!
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: 300, overflowY: "auto" }}>
          {friends.map((f) => {
            const isWaiting = challengeWaiting?.friendId === f.id;
            const flag = f.country && COUNTRY_MAP[f.country] ? COUNTRY_MAP[f.country].flag + " " : "";

            return (
              <div
                key={f.id}
                style={{
                  display:      "flex",
                  alignItems:   "center",
                  gap:          8,
                  padding:      "0.5rem 0.6rem",
                  background:   "var(--surface2)",
                  borderRadius: 4,
                  border:       "1px solid var(--border)",
                }}
              >
                {/* Name */}
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {flag}{f.username}
                </span>
                {/* Elo */}
                <span style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B", minWidth: 32, textAlign: "right" }}>
                  {f.elo}
                </span>
                {/* W-L */}
                <span style={{ fontSize: 10, color: "var(--text3)", minWidth: 36, textAlign: "right" }}>
                  {f.wins}-{f.losses}
                </span>
                {/* Challenge buttons */}
                {isWaiting ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, whiteSpace: "nowrap" }}>Waiting...</span>
                    <button
                      onClick={onCancelChallenge}
                      style={{
                        background:   "transparent",
                        color:        "var(--text3)",
                        border:       "1px solid var(--border)",
                        borderRadius: 4,
                        padding:      "0.2rem 0.45rem",
                        fontSize:     10,
                        fontFamily:   "monospace",
                        fontWeight:   700,
                        cursor:       "pointer",
                        whiteSpace:   "nowrap",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => onChallenge(f.id, "ranked")}
                      style={{
                        background:   "var(--primaryBtn)",
                        color:        "var(--primaryBtnText)",
                        border:       "none",
                        borderRadius: 4,
                        padding:      "0.2rem 0.45rem",
                        fontSize:     10,
                        fontFamily:   "monospace",
                        fontWeight:   700,
                        cursor:       "pointer",
                        whiteSpace:   "nowrap",
                      }}
                    >
                      Ranked
                    </button>
                    <button
                      onClick={() => onChallenge(f.id, "unranked")}
                      style={{
                        background:   "transparent",
                        color:        "var(--primaryBtn)",
                        border:       "1px solid var(--primaryBtn)",
                        borderRadius: 4,
                        padding:      "0.2rem 0.45rem",
                        fontSize:     10,
                        fontFamily:   "monospace",
                        fontWeight:   700,
                        cursor:       "pointer",
                        whiteSpace:   "nowrap",
                      }}
                    >
                      Casual
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Choose username view ──────────────────────────────────────────────────────

const COUNTRIES: { code: string; flag: string; name: string }[] = [
  { code: "AF", flag: "🇦🇫", name: "Afghanistan" },
  { code: "AL", flag: "🇦🇱", name: "Albania" },
  { code: "DZ", flag: "🇩🇿", name: "Algeria" },
  { code: "AR", flag: "🇦🇷", name: "Argentina" },
  { code: "AU", flag: "🇦🇺", name: "Australia" },
  { code: "AT", flag: "🇦🇹", name: "Austria" },
  { code: "BD", flag: "🇧🇩", name: "Bangladesh" },
  { code: "BE", flag: "🇧🇪", name: "Belgium" },
  { code: "BR", flag: "🇧🇷", name: "Brazil" },
  { code: "BG", flag: "🇧🇬", name: "Bulgaria" },
  { code: "CA", flag: "🇨🇦", name: "Canada" },
  { code: "CL", flag: "🇨🇱", name: "Chile" },
  { code: "CN", flag: "🇨🇳", name: "China" },
  { code: "CO", flag: "🇨🇴", name: "Colombia" },
  { code: "HR", flag: "🇭🇷", name: "Croatia" },
  { code: "CZ", flag: "🇨🇿", name: "Czechia" },
  { code: "DK", flag: "🇩🇰", name: "Denmark" },
  { code: "EG", flag: "🇪🇬", name: "Egypt" },
  { code: "EE", flag: "🇪🇪", name: "Estonia" },
  { code: "FI", flag: "🇫🇮", name: "Finland" },
  { code: "FR", flag: "🇫🇷", name: "France" },
  { code: "DE", flag: "🇩🇪", name: "Germany" },
  { code: "GR", flag: "🇬🇷", name: "Greece" },
  { code: "HK", flag: "🇭🇰", name: "Hong Kong" },
  { code: "HU", flag: "🇭🇺", name: "Hungary" },
  { code: "IS", flag: "🇮🇸", name: "Iceland" },
  { code: "IN", flag: "🇮🇳", name: "India" },
  { code: "ID", flag: "🇮🇩", name: "Indonesia" },
  { code: "IR", flag: "🇮🇷", name: "Iran" },
  { code: "IQ", flag: "🇮🇶", name: "Iraq" },
  { code: "IE", flag: "🇮🇪", name: "Ireland" },
  { code: "IL", flag: "🇮🇱", name: "Israel" },
  { code: "IT", flag: "🇮🇹", name: "Italy" },
  { code: "JP", flag: "🇯🇵", name: "Japan" },
  { code: "KZ", flag: "🇰🇿", name: "Kazakhstan" },
  { code: "KE", flag: "🇰🇪", name: "Kenya" },
  { code: "KR", flag: "🇰🇷", name: "South Korea" },
  { code: "LV", flag: "🇱🇻", name: "Latvia" },
  { code: "LT", flag: "🇱🇹", name: "Lithuania" },
  { code: "MY", flag: "🇲🇾", name: "Malaysia" },
  { code: "MX", flag: "🇲🇽", name: "Mexico" },
  { code: "MA", flag: "🇲🇦", name: "Morocco" },
  { code: "NL", flag: "🇳🇱", name: "Netherlands" },
  { code: "NZ", flag: "🇳🇿", name: "New Zealand" },
  { code: "NG", flag: "🇳🇬", name: "Nigeria" },
  { code: "NO", flag: "🇳🇴", name: "Norway" },
  { code: "PK", flag: "🇵🇰", name: "Pakistan" },
  { code: "PE", flag: "🇵🇪", name: "Peru" },
  { code: "PH", flag: "🇵🇭", name: "Philippines" },
  { code: "PL", flag: "🇵🇱", name: "Poland" },
  { code: "PT", flag: "🇵🇹", name: "Portugal" },
  { code: "RO", flag: "🇷🇴", name: "Romania" },
  { code: "RU", flag: "🇷🇺", name: "Russia" },
  { code: "SA", flag: "🇸🇦", name: "Saudi Arabia" },
  { code: "RS", flag: "🇷🇸", name: "Serbia" },
  { code: "SG", flag: "🇸🇬", name: "Singapore" },
  { code: "SK", flag: "🇸🇰", name: "Slovakia" },
  { code: "ZA", flag: "🇿🇦", name: "South Africa" },
  { code: "ES", flag: "🇪🇸", name: "Spain" },
  { code: "SE", flag: "🇸🇪", name: "Sweden" },
  { code: "CH", flag: "🇨🇭", name: "Switzerland" },
  { code: "TW", flag: "🇹🇼", name: "Taiwan" },
  { code: "TH", flag: "🇹🇭", name: "Thailand" },
  { code: "TR", flag: "🇹🇷", name: "Turkey" },
  { code: "UA", flag: "🇺🇦", name: "Ukraine" },
  { code: "AE", flag: "🇦🇪", name: "UAE" },
  { code: "GB", flag: "🇬🇧", name: "United Kingdom" },
  { code: "US", flag: "🇺🇸", name: "United States" },
  { code: "VN", flag: "🇻🇳", name: "Vietnam" },
];

const COUNTRY_MAP = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;

function usernameHint(value: string): string | null {
  const v = value.trim();
  if (v.length === 0)   return null;
  if (v.length < 3)     return "At least 3 characters required.";
  if (v.length > 16)    return "Maximum 16 characters.";
  if (!USERNAME_RE.test(v)) return "Only letters, numbers, and underscores.";
  return null;
}

function ChooseUsernameView({
  userId,
  onDone,
}: {
  userId: string;
  onDone: (username: string, elo: number) => void;
}) {
  const [value, setValue]         = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [level, setLevel]         = useState<"beginner" | "intermediate" | null>(null);
  const [country, setCountry]     = useState("");
  const [taken, setTaken]         = useState(false);
  const [checking, setChecking]   = useState(false);

  const trimmed   = value.trim();
  const hint      = usernameHint(value);
  const isValid   = USERNAME_RE.test(trimmed) && level !== null && country !== "" && !taken && !checking;

  // Debounced username availability check
  useEffect(() => {
    if (!USERNAME_RE.test(trimmed)) { setTaken(false); return; }
    setChecking(true);
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("username", trimmed)
        .maybeSingle();
      setTaken(!!data);
      setChecking(false);
    }, 400);
    return () => { clearTimeout(timer); setChecking(false); };
  }, [trimmed]);

  async function submit() {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const elo = level === "beginner" ? 600 : 1200;

    const { error } = await supabase
      .from("profiles")
      .update({ username: trimmed, elo, country })
      .eq("id", userId);

    setSubmitting(false);

    if (error) {
      // Postgres unique-violation code
      if (error.code === "23505") {
        setSubmitError("That username is already taken.");
      } else {
        setSubmitError(error.message);
      }
    } else {
      onDone(trimmed, elo);
    }
  }

  return (
    <div
      style={{
        minHeight:      "100vh",
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        fontFamily:     "monospace",
        gap:            "1.5rem",
        padding:        "2rem 1rem",
        background:     "var(--bg)",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 8, color: "var(--text)" }}>♠</div>
        <h1 className="wordmark" style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text)" }}>
          RiverRank.io
        </h1>
      </div>

      <div
        style={{
          background:    "var(--surface)",
          border:        "1px solid var(--border)",
          borderRadius:  8,
          padding:       "2rem",
          width:         340,
          display:       "flex",
          flexDirection: "column",
          gap:           "1rem",
        }}
      >
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", marginBottom: "0.35rem" }}>
            Choose your username
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)" }}>
            This will be visible on the leaderboard.
          </div>
        </div>

        {/* Skill level */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <div style={{ fontSize: 12, color: "var(--text3)" }}>Skill level</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(["beginner", "intermediate"] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setLevel(lvl)}
                style={{
                  background:   level === lvl ? "var(--primaryBtn)" : "var(--surface2)",
                  color:        level === lvl ? "var(--primaryBtnText)" : "var(--text2)",
                  border:       `1px solid ${level === lvl ? "transparent" : "var(--border)"}`,
                  borderRadius: 4,
                  padding:      "0.55rem 0",
                  fontSize:     12,
                  fontFamily:   "monospace",
                  fontWeight:   level === lvl ? 700 : 400,
                  cursor:       "pointer",
                  letterSpacing: 0.3,
                }}
              >
                {lvl === "beginner" ? "Beginner" : "Intermediate"}
              </button>
            ))}
          </div>
          {level && (
            <div style={{ fontSize: 11, color: "var(--text3)" }}>
              Starting ELO: {level === "beginner" ? 600 : 1200}
            </div>
          )}
        </div>

        {/* Country */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <div style={{ fontSize: 12, color: "var(--text3)" }}>Country</div>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            style={{
              appearance:       "none",
              WebkitAppearance: "none",
              background:       "var(--surface2)",
              backgroundImage:  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat:   "no-repeat",
              backgroundPosition: "right 0.75rem center",
              backgroundSize:     "0.75rem",
              border:       "1px solid var(--border)",
              borderRadius: 4,
              color:        country ? "var(--text)" : "var(--text3)",
              padding:      "0.6rem 0.9rem",
              paddingRight: "2rem",
              fontSize:     "0.9rem",
              fontFamily:   "monospace",
              outline:      "none",
              width:        "100%",
              boxSizing:    "border-box",
              cursor:       "pointer",
            }}
          >
            <option value="" disabled>Select your country</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <input
            value={value}
            onChange={(e) => { setValue(e.target.value); setSubmitError(null); }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. river_shark"
            maxLength={16}
            autoFocus
            spellCheck={false}
            style={{
              background:   "var(--surface2)",
              border:       `1px solid ${submitError ? "var(--danger)" : "var(--border)"}`,
              borderRadius: 4,
              color:        "var(--text)",
              padding:      "0.65rem 0.9rem",
              fontSize:     "0.95rem",
              fontFamily:   "monospace",
              outline:      "none",
              width:        "100%",
              boxSizing:    "border-box",
              letterSpacing: 0.5,
            }}
          />

          {/* Inline validation hint */}
          {(hint || submitError || taken) && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>
              {submitError ?? hint ?? "That username is already taken."}
            </p>
          )}

          {/* Character counter */}
          <p style={{ margin: 0, fontSize: 11, color: "var(--text3)", textAlign: "right" }}>
            {trimmed.length} / 16 · letters, numbers, underscores only
          </p>
        </div>

        <button
          onClick={submit}
          disabled={!isValid || submitting}
          style={{
            background:    !isValid || submitting ? "var(--surface2)" : "var(--primaryBtn)",
            color:         !isValid || submitting ? "var(--text3)"    : "var(--primaryBtnText)",
            border:        "1px solid transparent",
            borderRadius:  4,
            padding:       "0.7rem 1.25rem",
            fontSize:      "0.95rem",
            fontFamily:    "monospace",
            fontWeight:    700,
            cursor:        !isValid || submitting ? "not-allowed" : "pointer",
            width:         "100%",
            letterSpacing: 0.5,
          }}
        >
          {submitting ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

// ── Auth view ─────────────────────────────────────────────────────────────────

function AuthView({
  identifier, setIdentifier, password, setPassword,
  mode, onToggleMode, submitting, errorMsg, onSubmit,
}: {
  identifier:     string;
  setIdentifier:  (v: string) => void;
  password:       string;
  setPassword:    (v: string) => void;
  mode:           "signin" | "signup";
  onToggleMode:   () => void;
  submitting:     boolean;
  errorMsg:       string | null;
  onSubmit:       () => void;
}) {
  const disabled = submitting || !identifier.trim() || password.length < 6;

  return (
    <div
      style={{
        minHeight:      "100vh",
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        fontFamily:     "monospace",
        gap:            "1.5rem",
        padding:        "2rem 1rem",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 8, color: "var(--text)" }}>♠</div>
        <h1 className="wordmark" style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text)" }}>
          RiverRank.io
        </h1>
        <p style={{ margin: "0.5rem 0 0", color: "var(--text3)", fontSize: 12, letterSpacing: 1 }}>
          Ranked heads-up poker
        </p>
      </div>

      <div
        style={{
          background:    "var(--surface)",
          border:        "1px solid var(--border)",
          borderRadius:  8,
          padding:       "2rem",
          width:         320,
          display:       "flex",
          flexDirection: "column",
          gap:           "0.9rem",
        }}
      >
        <p style={{ margin: 0, color: "var(--text2)", fontSize: 13 }}>
          {mode === "signin" ? "Sign in to play" : "Create an account"}
        </p>

        <input
          type={mode === "signin" ? "text" : "email"}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder={mode === "signin" ? "email or username" : "you@example.com"}
          autoFocus
          style={{
            background:   "var(--surface2)",
            border:       "1px solid var(--border)",
            borderRadius: 4,
            color:        "var(--text)",
            padding:      "0.6rem 0.9rem",
            fontSize:     "0.9rem",
            fontFamily:   "monospace",
            outline:      "none",
            width:        "100%",
            boxSizing:    "border-box",
          }}
        />

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder="password (min 6 chars)"
          style={{
            background:   "var(--surface2)",
            border:       "1px solid var(--border)",
            borderRadius: 4,
            color:        "var(--text)",
            padding:      "0.6rem 0.9rem",
            fontSize:     "0.9rem",
            fontFamily:   "monospace",
            outline:      "none",
            width:        "100%",
            boxSizing:    "border-box",
          }}
        />

        {errorMsg && (
          <p style={{ margin: 0, color: "var(--danger)", fontSize: 12 }}>{errorMsg}</p>
        )}

        <button
          onClick={onSubmit}
          disabled={disabled}
          style={{
            background:    disabled ? "var(--surface2)" : "var(--primaryBtn)",
            color:         disabled ? "var(--text3)"    : "var(--primaryBtnText)",
            border:        "1px solid transparent",
            borderRadius:  4,
            padding:       "0.65rem 1.25rem",
            fontSize:      "0.9rem",
            fontFamily:    "monospace",
            fontWeight:    700,
            cursor:        disabled ? "not-allowed" : "pointer",
            width:         "100%",
            letterSpacing: 0.3,
          }}
        >
          {submitting ? "…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <button
          onClick={onToggleMode}
          style={{
            background:    "transparent",
            color:         "var(--text3)",
            border:        "none",
            fontSize:      12,
            fontFamily:    "monospace",
            cursor:        "pointer",
            padding:       0,
            textAlign:     "center",
          }}
        >
          {mode === "signin" ? "No account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function PageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const isMobile     = useIsMobile();

  const [session, setSession]             = useState<Session | null>(null);
  const [profile, setProfile]             = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [authChecked, setAuthChecked]     = useState(false);

  const [identifier, setIdentifier]       = useState("");
  const [password, setPassword]           = useState("");
  const [authMode, setAuthMode]           = useState<"signin" | "signup">("signin");
  const [submitting, setSubmitting]       = useState(false);
  const [errorMsg, setErrorMsg]           = useState<string | null>(null);

  const [leaderboard, setLeaderboard]     = useState<LeaderboardEntry[]>([]);
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);
  const [leaderboardScope, setLeaderboardScope] = useState<"global" | "national">("global");
  const [userRank, setUserRank] = useState<{ global: number | null; national: number | null }>({ global: null, national: null });

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef     = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Friends state
  const [friends, setFriends]                   = useState<Friend[]>([]);
  const [friendCode, setFriendCode]             = useState<string | null>(null);
  const [pendingChallenge, setPendingChallenge] = useState<IncomingChallenge | null>(null);
  const [challengeWaiting, setChallengeWaiting] = useState<{ friendId: string; challengeId: string } | null>(null);
  const [friendToast, setFriendToast]           = useState<string | null>(null);
  const dashboardSocketRef = useRef<Socket | null>(null);

  // Session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Profile + recent matches
  useEffect(() => {
    if (!session) {
      setProfile(null);
      setRecentMatches([]);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);

    supabase
      .from("profiles")
      .select("username, elo, wins, losses, country, friend_code")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        // If friend_code column doesn't exist yet, retry without it
        let profileData = data;
        if (error && !data) {
          const retry = await supabase
            .from("profiles")
            .select("username, elo, wins, losses, country")
            .eq("id", session.user.id)
            .maybeSingle();
          profileData = retry.data as typeof data;
        }

        if (!profileData) {
          // Profile row missing — create it with null username so onboarding runs
          await supabase
            .from("profiles")
            .upsert({ id: session.user.id, username: null }, { onConflict: "id" });
          setProfile({ username: null, elo: 1200, wins: 0, losses: 0, country: null });
        } else {
          setProfile(profileData as Profile);
          if ((profileData as any).friend_code) setFriendCode((profileData as any).friend_code as string);
        }
        setProfileLoading(false);
      });

    const userId = session.user.id;
    supabase
      .from("matches")
      .select("id, p1, p2, winner, ranked, ended_at, p1_prof:profiles!p1(username), p2_prof:profiles!p2(username)")
      .or(`p1.eq.${userId},p2.eq.${userId}`)
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (!data) return;
        setRecentMatches(
          data.map((row: any) => {
            const isP1 = row.p1 === userId;
            const opponentProf = isP1 ? row.p2_prof : row.p1_prof;
            return {
              id: row.id,
              opponent: opponentProf?.username ?? "Unknown",
              result:
                row.winner === null ? "DRAW" :
                row.winner === userId ? "WIN" : "LOSS",
              mode: row.ranked ? "ranked" : "unranked",
              ratingDelta: null,
              timeAgo: timeAgo(row.ended_at),
            } satisfies RecentMatch;
          })
        );
      });
  }, [session]);

  // Fetch friends list
  const fetchFriends = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("friendships")
      .select("friend:profiles!friend_id(id, username, country, elo, wins, losses)")
      .eq("user_id", userId);
    if (data) {
      setFriends(
        data.map((row: any) => row.friend as Friend).filter(Boolean),
      );
    }
  }, []);

  useEffect(() => {
    if (!session || !profile?.username) return;
    fetchFriends(session.user.id);
  }, [session, profile?.username, fetchFriends]);

  // Friend link handling
  useEffect(() => {
    const code = searchParams.get("friend");
    if (!code || !session || !profile?.username) return;

    (async () => {
      const { data, error } = await supabase.rpc("add_friend_by_code", { p_friend_code: code });
      if (error) {
        setFriendToast("Failed to add friend.");
      } else if (data?.error === "not_found") {
        setFriendToast("Friend code not found.");
      } else if (data?.error === "self") {
        setFriendToast("That's your own code!");
      } else {
        setFriendToast("Friend added!");
        fetchFriends(session.user.id);
      }
      router.replace("/");
      setTimeout(() => setFriendToast(null), 3000);
    })();
  }, [searchParams, session, profile?.username, fetchFriends, router]);

  // Realtime subscription for incoming challenges (DB-backed delivery)
  useEffect(() => {
    if (!session) return;
    const userId = session.user.id;

    const channel = supabase
      .channel("pending_challenges")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pending_challenges", filter: `to_user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { id: string; from_username: string; from_user_id: string; mode: Mode };
          setPendingChallenge((prev) => {
            // Don't overwrite if same challenge already shown via socket
            if (prev?.challengeId === row.id) return prev;
            return { challengeId: row.id, fromUsername: row.from_username, fromUserId: row.from_user_id, mode: row.mode };
          });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session]);

  // Dashboard socket for challenges & online status
  useEffect(() => {
    if (!session || !profile?.username) return;

    const accessToken = session.access_token;
    const socket = io(BACKEND, {
      transports: ["websocket"],
      auth: { accessToken },
    });
    dashboardSocketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("auth.guest", { username: profile.username }, () => {});
    });

    socket.on("challenge.received", (data: IncomingChallenge) => {
      setPendingChallenge((prev) => {
        if (prev?.challengeId === data.challengeId) return prev;
        return data;
      });
    });

    socket.on("challenge.expired", () => {
      setChallengeWaiting(null);
      setPendingChallenge(null);
    });

    socket.on("challenge.declined", () => {
      setChallengeWaiting(null);
    });

    socket.on("match.found", ({ mode: mMode }: { matchId: string; opponent: any; mode?: Mode }) => {
      setChallengeWaiting(null);
      setPendingChallenge(null);
      router.push(`/game?mode=${mMode ?? "ranked"}`);
    });

    return () => {
      socket.disconnect();
      dashboardSocketRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, profile?.username]);

  function handleChallenge(friendId: string, mode: Mode) {
    const socket = dashboardSocketRef.current;
    if (!socket?.connected) return;
    socket.emit(
      "challenge.create",
      { toUserId: friendId, mode },
      (res: { challengeId?: string; error?: string }) => {
        if (res.challengeId) {
          setChallengeWaiting({ friendId, challengeId: res.challengeId });
        }
      },
    );
  }

  function handleAcceptChallenge() {
    const socket = dashboardSocketRef.current;
    if (!socket?.connected || !pendingChallenge) return;
    socket.emit("challenge.accept", { challengeId: pendingChallenge.challengeId });
    supabase.from("pending_challenges").delete().eq("id", pendingChallenge.challengeId);
  }

  function handleCancelChallenge() {
    const socket = dashboardSocketRef.current;
    if (!challengeWaiting) return;
    if (socket?.connected) socket.emit("challenge.cancel", { challengeId: challengeWaiting.challengeId });
    setChallengeWaiting(null);
  }

  function handleDeclineChallenge() {
    const socket = dashboardSocketRef.current;
    if (!pendingChallenge) return;
    if (socket?.connected) socket.emit("challenge.decline", { challengeId: pendingChallenge.challengeId });
    supabase.from("pending_challenges").delete().eq("id", pendingChallenge.challengeId);
    setPendingChallenge(null);
  }

  // Click-outside to close username menu
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Leaderboard — refetch after auth so RLS-gated reads succeed
  useEffect(() => {
    if (!session) return;
    let query = supabase
      .from("profiles")
      .select("id, username, elo, wins, losses, country")
      .not("username", "is", null);
    if (leaderboardScope === "national" && profile?.country) {
      query = query.eq("country", profile.country);
    }
    query
      .order("elo", { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (error) { console.error("leaderboard fetch error:", error); return; }
        if (!data) return;
        setLeaderboard(
          data.map((row: any) => ({
            id: row.id,
            username: row.username,
            elo: row.elo,
            wins: row.wins,
            losses: row.losses,
            gamesPlayed: row.wins + row.losses,
            country: row.country ?? null,
          }))
        );
      });
  }, [session, leaderboardScope, profile?.country]);

  // User rank
  useEffect(() => {
    if (!session || !profile?.elo) return;
    // Global rank
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("username", "is", null)
      .gt("elo", profile.elo)
      .then(({ count }) => {
        setUserRank((prev) => ({ ...prev, global: count !== null ? count + 1 : null }));
      });
    // National rank
    if (profile.country) {
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .not("username", "is", null)
        .eq("country", profile.country)
        .gt("elo", profile.elo)
        .then(({ count }) => {
          setUserRank((prev) => ({ ...prev, national: count !== null ? count + 1 : null }));
        });
    } else {
      setUserRank((prev) => ({ ...prev, national: null }));
    }
  }, [session, profile?.elo, profile?.country]);

  async function submitAuth() {
    const trimmed = identifier.trim();
    if (!trimmed || password.length < 6) return;
    setSubmitting(true);
    setErrorMsg(null);

    if (authMode === "signup") {
      const { error } = await supabase.auth.signUp({
        email: trimmed,
        password,
      });
      if (error) setErrorMsg(error.message);
      setSubmitting(false);
      return;
    }

    // Sign-in: detect email vs username
    let emailToUse = trimmed;

    if (!trimmed.includes("@")) {
      const { data, error } = await supabase.rpc("get_email_by_username", {
        p_username: trimmed,
      });
      if (error) {
        setErrorMsg("Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      if (!data) {
        setErrorMsg("No account found for that username.");
        setSubmitting(false);
        return;
      }
      emailToUse = data as string;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password,
    });
    if (error) setErrorMsg(error.message);
    setSubmitting(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  function scrollToSettings() {
    settingsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setMenuOpen(false);
  }

  if (!authChecked) return null;

  if (!session) {
    return (
      <AuthView
        identifier={identifier}
        setIdentifier={setIdentifier}
        password={password}
        setPassword={setPassword}
        mode={authMode}
        onToggleMode={() => { setAuthMode((m) => m === "signin" ? "signup" : "signin"); setErrorMsg(null); }}
        submitting={submitting}
        errorMsg={errorMsg}
        onSubmit={submitAuth}
      />
    );
  }

  // Signed in — wait for profile to load
  if (profileLoading) return null;

  // Username not set yet — run onboarding
  if (!profile?.username) {
    return (
      <ChooseUsernameView
        userId={session.user.id}
        onDone={(username, elo) => setProfile((p) => p ? { ...p, username, elo } : p)} 
      />
    );
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight:  "100vh",
        background: "var(--bg)",
        fontFamily: "monospace",
        color:      "var(--text)",
      }}
    >
      {/* Top nav */}
      <header
        style={{
          height:         48,
          background:     "var(--surface)",
          borderBottom:   "1px solid var(--border)",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "0 24px",
          position:       "sticky",
          top:            0,
          zIndex:         10,
        }}
      >
        <span className="wordmark" style={{ fontWeight: 800, fontSize: 13 }}>RiverRank.io ♠</span>
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            style={{
              background:  "transparent",
              border:      "none",
              cursor:      "pointer",
              color:       "var(--text3)",
              fontSize:    12,
              fontFamily:  "monospace",
              display:     "flex",
              alignItems:  "center",
              gap:         4,
              padding:     "4px 6px",
              borderRadius: 4,
            }}
          >
            {profile?.username ?? ""} <span style={{ fontSize: 10 }}>▾</span>
          </button>
          {menuOpen && (
            <div style={{
              position:   "absolute",
              top:        "calc(100% + 6px)",
              right:      0,
              background: "var(--surface)",
              border:     "1px solid var(--border)",
              borderRadius: 6,
              minWidth:   160,
              zIndex:     100,
              overflow:   "hidden",
            }}>
              {[
                { label: "Profile Settings", action: scrollToSettings },
                { label: "Sign Out",         action: () => { signOut(); setMenuOpen(false); } },
              ].map(({ label, action }) => (
                <button key={label} onClick={action} style={{
                  display:      "block",
                  width:        "100%",
                  background:   "transparent",
                  border:       "none",
                  borderBottom: label !== "Sign Out" ? "1px solid var(--border)" : "none",
                  color:        label === "Sign Out" ? "var(--danger)" : "var(--text2)",
                  fontSize:     12,
                  fontFamily:   "monospace",
                  padding:      "10px 14px",
                  textAlign:    "left",
                  cursor:       "pointer",
                  letterSpacing: 0.3,
                }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <main
        style={{
          maxWidth: 1100,
          margin:   "0 auto",
          padding:  isMobile ? "1rem" : "2rem 1.5rem",
        }}
      >
        {/* Two-column grid */}
        <div
          style={{
            display:             "grid",
            gridTemplateColumns: isMobile ? "1fr" : "340px 1fr",
            gap:                 "1.25rem",
            alignItems:          "start",
          }}
        >
          {/* Left column */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {profile && <ProfileCard profile={profile} />}
            <PlayCard onPlay={(mode) => router.push(`/game?mode=${mode}`)} />
            <BulletPlayCard onPlay={(mode) => router.push(`/game?mode=${mode}`)} />
            <TournamentCard
              dashboardSocket={dashboardSocketRef.current}
              onNavigate={(path) => router.push(path)}
            />
            <div ref={settingsRef}>
              <AccountCard
                onSignOut={signOut}
                currentUsername={profile?.username ?? null}
                userId={session?.user.id ?? null}
                onUsernameChanged={(newName) => setProfile((p) => p ? { ...p, username: newName } : p)}
              />
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <LeaderboardCard
              entries={leaderboard}
              scope={leaderboardScope}
              onScopeChange={setLeaderboardScope}
              userRank={userRank}
              userCountry={profile?.country}
            />
            <FriendsCard
              friends={friends}
              friendCode={friendCode}
              onChallenge={handleChallenge}
              pendingChallenge={pendingChallenge}
              onAcceptChallenge={handleAcceptChallenge}
              onDeclineChallenge={handleDeclineChallenge}
              onCancelChallenge={handleCancelChallenge}
              challengeWaiting={challengeWaiting}
            />
            <RecentMatchesCard matches={recentMatches} />
          </div>
        </div>

        {/* Friend toast */}
        {friendToast && (
          <div
            style={{
              position:     "fixed",
              bottom:       24,
              left:         "50%",
              transform:    "translateX(-50%)",
              background:   "var(--surface)",
              border:       "1px solid var(--border)",
              borderRadius: 6,
              padding:      "0.6rem 1.2rem",
              fontSize:     12,
              fontFamily:   "monospace",
              color:        "var(--text)",
              zIndex:       1000,
              boxShadow:    "0 4px 12px rgba(0,0,0,0.15)",
            }}
          >
            {friendToast}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Export with Suspense (required for useSearchParams in Next.js App Router) ──

export default function Page() {
  return (
    <Suspense>
      <PageInner />
    </Suspense>
  );
}
