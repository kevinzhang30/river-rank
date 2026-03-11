"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { DeckToggle } from "@/ui/DeckToggle";
import type { LeaderboardEntry, Mode } from "@/ui/types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Profile {
  username: string | null;
  elo:      number;
  wins:     number;
  losses:   number;
}

interface RecentMatch {
  id:          string;
  timeAgo:     string;
  opponent:    string;
  result:      "WIN" | "LOSS" | "DRAW";
  mode:        "ranked" | "unranked";
  ratingDelta: number | null; // null for unranked
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

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: 2,
        color:         "var(--text3)",
        textTransform: "uppercase",
        marginBottom:  "1rem",
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
          {profile.username ?? "—"}
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
          Heads-up No-Limit Hold'em · Blinds increase every 3 hands
        </p>
      </div>
    </Card>
  );
}

// ── Account card ──────────────────────────────────────────────────────────────

function AccountCard({ onSignOut }: { onSignOut: () => void }) {
  return (
    <Card>
      <CardLabel>Settings</CardLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--text2)" }}>Theme</span>
          <ThemeToggle />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--text2)" }}>4-colour deck</span>
          <DeckToggle />
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

function LeaderboardCard({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <Card>
      <CardLabel>Leaderboard</CardLabel>
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
                  {e.username}
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

// ── Choose username view ──────────────────────────────────────────────────────

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

  const trimmed   = value.trim();
  const hint      = usernameHint(value);
  const isValid   = USERNAME_RE.test(trimmed) && level !== null;

  async function submit() {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const elo = level === "beginner" ? 600 : 1200;

    const { error } = await supabase
      .from("profiles")
      .update({ username: trimmed, elo })
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
          RiverRank
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
          {(hint || submitError) && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>
              {submitError ?? hint}
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
  email, setEmail, password, setPassword,
  mode, onToggleMode, submitting, errorMsg, onSubmit,
}: {
  email:          string;
  setEmail:       (v: string) => void;
  password:       string;
  setPassword:    (v: string) => void;
  mode:           "signin" | "signup";
  onToggleMode:   () => void;
  submitting:     boolean;
  errorMsg:       string | null;
  onSubmit:       () => void;
}) {
  const disabled = submitting || !email.trim() || password.length < 6;

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
          RiverRank
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
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder="you@example.com"
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

export default function Page() {
  const router = useRouter();

  const [session, setSession]             = useState<Session | null>(null);
  const [profile, setProfile]             = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [authChecked, setAuthChecked]     = useState(false);

  const [email, setEmail]                 = useState("");
  const [password, setPassword]           = useState("");
  const [authMode, setAuthMode]           = useState<"signin" | "signup">("signin");
  const [submitting, setSubmitting]       = useState(false);
  const [errorMsg, setErrorMsg]           = useState<string | null>(null);

  const [leaderboard, setLeaderboard]     = useState<LeaderboardEntry[]>([]);
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef     = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

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
      .select("username, elo, wins, losses")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!data) {
          // Profile row missing — create it with null username so onboarding runs
          await supabase
            .from("profiles")
            .upsert({ id: session.user.id, username: null }, { onConflict: "id" });
          setProfile({ username: null, elo: 1200, wins: 0, losses: 0 });
        } else {
          setProfile(data as Profile);
        }
        setProfileLoading(false);
      });

    // TODO: query Supabase matches table once populated by the backend RPC
    setRecentMatches([]);
  }, [session]);

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

  // Leaderboard
  useEffect(() => {
    fetch(`${BACKEND}/leaderboard`)
      .then((r) => r.json())
      .then((data: LeaderboardEntry[]) => setLeaderboard(data.slice(0, 10)))
      .catch(() => {});
  }, []);

  async function submitAuth() {
    if (!email.trim() || password.length < 6) return;
    setSubmitting(true);
    setErrorMsg(null);

    if (authMode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) setErrorMsg(error.message);
    } else {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) setErrorMsg(error.message);
    }

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
        email={email}
        setEmail={setEmail}
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
        <span className="wordmark" style={{ fontWeight: 800, fontSize: 13 }}>RiverRank ♠</span>
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
          padding:  "2rem 1.5rem",
        }}
      >
        {/* Two-column grid */}
        <div
          style={{
            display:             "grid",
            gridTemplateColumns: "340px 1fr",
            gap:                 "1.25rem",
            alignItems:          "start",
          }}
        >
          {/* Left column */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {profile && <ProfileCard profile={profile} />}
            <PlayCard onPlay={(mode) => router.push(`/game?mode=${mode}`)} />
            <div ref={settingsRef}>
              <AccountCard onSignOut={signOut} />
            </div>
          </div>

          {/* Right column */}
          <LeaderboardCard entries={leaderboard} />
        </div>

        {/* Full-width recent matches */}
        <div style={{ marginTop: "1.25rem" }}>
          <RecentMatchesCard matches={recentMatches} />
        </div>
      </main>
    </div>
  );
}
