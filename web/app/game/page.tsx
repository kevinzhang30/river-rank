"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { supabase } from "@/lib/supabaseClient";
import { PokerTable } from "@/ui/PokerTable";
import { DebugPanel } from "@/ui/DebugPanel";
import { mockState, mockHeroHoleCards } from "@/ui/mockState";
import {
  adaptBackendState,
  isBackendGameState,
  type BackendGameState,
} from "@/ui/adapters";
import type { PublicGameState, PublicPlayer, Mode } from "@/ui/types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

interface Opponent {
  userId:   string;
  username: string;
}

// ── Main game component ───────────────────────────────────────────────────────

function GameView() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const mode         = (searchParams.get("mode") ?? "ranked") as Mode;

  const socketRef  = useRef<Socket | null>(null);
  const userIdRef  = useRef<string | null>(null);

  const [userId, setUserId]               = useState<string | null>(null);
  const [username, setUsername]           = useState<string>("");
  const [status, setStatus]               = useState("connecting…");
  const [noAuth, setNoAuth]               = useState(false);

  const [matchId, setMatchId]             = useState<string | null>(null);
  const [opponent, setOpponent]           = useState<Opponent | null>(null);
  const [matchMode, setMatchMode]         = useState<Mode>(mode);

  const [matchResult, setMatchResult]     = useState<{
    winnerId:       string;
    winnerUsername: string;
    ratingDelta:    Record<string, number> | null;
  } | null>(null);

  const [liveState, setLiveState]         = useState<PublicGameState | null>(null);
  const [liveHeroCards, setLiveHeroCards] = useState<[string, string] | null>(null);
  const [rawBackendState, setRawBackendState] = useState<BackendGameState | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      // Block ranked (and all modes) if not authenticated
      if (!session) {
        if (mode === "ranked") {
          setNoAuth(true);
          return;
        }
        // Unranked: still require auth for now; redirect home
        router.replace("/");
        return;
      }

      const accessToken = session.access_token;

      // Fetch profile for username
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .single();

      const resolvedUsername =
        (profile as { username?: string } | null)?.username ??
        `player_${session.user.id.slice(0, 8)}`;

      setUsername(resolvedUsername);

      // Connect with Supabase token so backend can verify identity
      const socket = io(BACKEND, {
        transports: ["websocket"],
        auth: { accessToken },
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        setStatus("authenticating…");
        socket.emit(
          "auth.guest",
          { username: resolvedUsername },
          (res: { userId: string; username: string; elo: number }) => {
            userIdRef.current = res.userId;
            setUserId(res.userId);
            setStatus("in queue…");
            socket.emit("queue.join", { mode });
          },
        );
      });

      socket.on(
        "match.found",
        ({ matchId, opponent, mode: mMode }: { matchId: string; opponent: Opponent; mode?: Mode }) => {
          setMatchId(matchId);
          setOpponent(opponent);
          setMatchMode(mMode ?? mode);
          setStatus("in match");
        },
      );

      socket.on(
        "game.state",
        ({ publicState, heroHoleCards }: { publicState: PublicGameState; heroHoleCards: string[] }) => {
          setLiveState(publicState);
          if (heroHoleCards.length >= 2) {
            setLiveHeroCards([heroHoleCards[0], heroHoleCards[1]]);
          }
        },
      );

      socket.on("state.update", ({ state }: { state: unknown }) => {
        if (!isBackendGameState(state)) return;
        setRawBackendState(state);
        setLiveState((prev) => {
          if (prev !== null) return prev;
          return adaptBackendState(state, userIdRef.current);
        });
      });

      socket.on(
        "match.ended",
        ({ winnerId, winnerUsername, ratingDelta }: {
          matchId:        string;
          winnerId:       string;
          winnerUsername: string;
          ranked:         boolean;
          ratingDelta:    Record<string, number> | null;
        }) => {
          setMatchResult({ winnerId, winnerUsername, ratingDelta: ratingDelta ?? null });
        },
      );

      socket.on("connect_error", (err) => {
        if (err.message === "unauthorized") {
          setNoAuth(true);
        } else {
          setStatus("connection failed");
        }
      });
    });

    return () => { socketRef.current?.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function sendAction(action: string, amount?: number) {
    if (!matchId) return;
    socketRef.current?.emit("game.action", { matchId, action, amount });
  }

  function backToLobby() {
    socketRef.current?.disconnect();
    router.push("/");
  }

  const tableState: PublicGameState | null = useMemo(() => {
    if (!matchId || !userId || !opponent) return null;
    if (liveState) return liveState;
    return {
      ...mockState,
      matchId,
      mode: matchMode,
      players: [
        { ...mockState.players[0], userId: opponent.userId, username: opponent.username },
        { ...mockState.players[1], userId, username },
      ] as [PublicPlayer, PublicPlayer],
    };
  }, [matchId, userId, opponent, username, matchMode, liveState]);

  const tableHeroCards: [string, string] = liveHeroCards ?? mockHeroHoleCards;
  const debugState: unknown = liveState ?? rawBackendState ?? null;

  // ── No auth (ranked blocked) ────────────────────────────────────────────────

  if (noAuth) {
    return (
      <div
        style={{
          minHeight:      "100vh",
          display:        "flex",
          flexDirection:  "column",
          alignItems:     "center",
          justifyContent: "center",
          fontFamily:     "monospace",
          gap:            "1rem",
        }}
      >
        <p style={{ color: "var(--danger)", fontWeight: 700, fontSize: 15, margin: 0 }}>
          You must be signed in to play ranked.
        </p>
        <button
          onClick={() => router.push("/")}
          style={{
            background:   "transparent",
            color:        "var(--primaryBtn)",
            border:       "1px solid var(--primaryBtn)",
            borderRadius: 4,
            padding:      "0.6rem 1.25rem",
            fontSize:     "0.9rem",
            fontFamily:   "monospace",
            fontWeight:   700,
            cursor:       "pointer",
          }}
        >
          Back to Lobby
        </button>
      </div>
    );
  }

  // ── Match view ──────────────────────────────────────────────────────────────

  if (tableState && userId) {
    const isWinner = matchResult?.winnerId === userId;
    return (
      <>
        <PokerTable
          state={tableState}
          heroUserId={userId}
          heroHoleCards={tableHeroCards}
          onFold={() => sendAction("FOLD")}
          onCheck={() => sendAction("CHECK")}
          onCall={() => sendAction("CALL")}
          onRaise={(amount) => sendAction("RAISE_TO", amount)}
        />
        <DebugPanel state={debugState} />

        {matchResult && (
          <div
            style={{
              position:       "fixed",
              inset:          0,
              background:     "rgba(0,0,0,0.72)",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              zIndex:         100,
            }}
          >
            <div
              style={{
                background:    "var(--surface)",
                border:        `1px solid ${isWinner ? "var(--success)" : "var(--danger)"}`,
                borderRadius:  8,
                padding:       "2.5rem 3rem",
                textAlign:     "center",
                fontFamily:    "monospace",
                display:       "flex",
                flexDirection: "column",
                alignItems:    "center",
                gap:           "1.2rem",
              }}
            >
              <div
                style={{
                  fontSize:      28,
                  fontWeight:    800,
                  letterSpacing: 1,
                  color: matchResult.ratingDelta === null
                    ? "var(--text3)"
                    : isWinner ? "var(--success)" : "var(--danger)",
                }}
              >
                {matchResult.ratingDelta === null
                  ? "UNRANKED"
                  : (() => {
                      const d = matchResult.ratingDelta[userId] ?? 0;
                      return d >= 0 ? `+${d}` : `${d}`;
                    })()
                }
              </div>
              <div
                style={{
                  fontSize:      24,
                  fontWeight:    800,
                  color:         isWinner ? "var(--success)" : "var(--danger)",
                  letterSpacing: 2,
                  textTransform: "uppercase",
                }}
              >
                {isWinner ? "You Win" : "You Lose"}
              </div>
              <div style={{ color: "var(--text2)", fontSize: 13 }}>
                {isWinner
                  ? "Your opponent ran out of chips."
                  : `${matchResult.winnerUsername} wins the match.`}
              </div>
              <button
                onClick={backToLobby}
                style={{
                  background:    isWinner ? "var(--success)" : "transparent",
                  color:         isWinner ? "var(--primaryBtnText)" : "var(--primaryBtn)",
                  border:        isWinner ? "1px solid transparent" : "1px solid var(--primaryBtn)",
                  borderRadius:  4,
                  padding:       "0.65rem 1.25rem",
                  fontSize:      "0.9rem",
                  fontFamily:    "monospace",
                  fontWeight:    700,
                  cursor:        "pointer",
                  letterSpacing: 0.3,
                }}
              >
                Back to Lobby
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Queue / waiting view ────────────────────────────────────────────────────

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
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 36, lineHeight: 1, marginBottom: 8, color: "var(--text)" }}>♠</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: 3, color: "var(--text)" }}>
          RiverRank
        </h1>
      </div>

      <div
        style={{
          background:    "var(--surface)",
          border:        "1px solid var(--border)",
          borderRadius:  8,
          padding:       "2rem",
          width:         300,
          display:       "flex",
          flexDirection: "column",
          alignItems:    "center",
          gap:           "1rem",
        }}
      >
        <div
          style={{
            display:      "flex",
            alignItems:   "center",
            gap:          8,
            background:   "var(--surface2)",
            border:       "1px solid var(--border)",
            borderRadius: 4,
            padding:      "0.6rem 0.9rem",
            width:        "100%",
            boxSizing:    "border-box",
          }}
        >
          <span
            style={{
              display:      "inline-block",
              width:        7,
              height:       7,
              borderRadius: "50%",
              background:   "#60A5FA",
              flexShrink:   0,
            }}
          />
          <span style={{ color: "var(--text2)", fontSize: 13 }}>
            {status === "in queue…"
              ? `Finding ${mode} opponent…`
              : status}
          </span>
        </div>

        <button
          onClick={backToLobby}
          style={{
            background:    "transparent",
            color:         "var(--danger)",
            border:        "1px solid var(--danger)",
            borderRadius:  4,
            padding:       "0.65rem 1.25rem",
            fontSize:      "0.9rem",
            fontFamily:    "monospace",
            fontWeight:    700,
            cursor:        "pointer",
            width:         "100%",
            letterSpacing: 0.3,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Export with Suspense (required for useSearchParams in Next.js App Router) ──

export default function GamePage() {
  return (
    <Suspense>
      <GameView />
    </Suspense>
  );
}
