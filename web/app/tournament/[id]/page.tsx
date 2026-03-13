"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { supabase } from "@/lib/supabaseClient";
import { BracketView } from "@/ui/BracketView";
import { useIsMobile } from "@/lib/useIsMobile";
import type { TournamentState, TournamentMatchInfo } from "@/ui/types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export default function TournamentPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = params.id as string;
  const isMobile = useIsMobile();

  const socketRef = useRef<Socket | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [state, setState] = useState<TournamentState | null>(null);
  const [copied, setCopied] = useState(false);
  const [matchCountdown, setMatchCountdown] = useState<number | null>(null);
  const [myMatchReady, setMyMatchReady] = useState<{
    tournamentMatchId: string;
    opponentId: string;
    opponentName: string;
    startsAt: number;
  } | null>(null);
  const [eliminated, setEliminated] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;

  const fetchState = useCallback((socket: Socket) => {
    socket.emit(
      "tournament.get_state",
      { tournamentId },
      (res: TournamentState & { error?: string }) => {
        if (res.error) return;
        setState(res);
      },
    );
  }, [tournamentId]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace("/");
        return;
      }

      const uid = session.user.id;
      setUserId(uid);

      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", uid)
        .single();
      const username =
        (profile as { username?: string } | null)?.username ??
        `player_${uid.slice(0, 8)}`;

      const socket = io(BACKEND, {
        transports: ["websocket"],
        auth: { accessToken: session.access_token },
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        socket.emit(
          "auth.guest",
          { username },
          () => {
            fetchState(socket);
          },
        );
      });

      // Tournament events
      socket.on("tournament.player_joined", ({ userId: joinedId, username: joinedName, participantCount }) => {
        setState((prev) => {
          if (!prev) return prev;
          if (prev.participants.some((p) => p.userId === joinedId)) return prev;
          return {
            ...prev,
            participants: [
              ...prev.participants,
              { userId: joinedId, username: joinedName, seed: null },
            ],
          };
        });
      });

      socket.on("tournament.player_left", ({ userId: leftId, participantCount }) => {
        setState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            participants: prev.participants.filter((p) => p.userId !== leftId),
          };
        });
      });

      socket.on("tournament.cancelled", () => {
        router.replace("/");
      });

      socket.on("tournament.started", (fullState: TournamentState) => {
        setState(fullState);
      });

      socket.on("tournament.match_ready", ({
        tournamentMatchId, round, position, p1Id, p2Id, startsAt,
      }: {
        tournamentMatchId: string;
        round: number;
        position: number;
        p1Id: string;
        p2Id: string;
        startsAt: number;
      }) => {
        // Update match status in state
        setState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            matches: prev.matches.map((m) =>
              m.id === tournamentMatchId
                ? { ...m, status: "ready" as const, p1: m.p1 ?? { userId: p1Id, username: "Unknown" }, p2: m.p2 ?? { userId: p2Id, username: "Unknown" } }
                : m,
            ),
          };
        });

        // Check if it's my match
        if (p1Id === uid || p2Id === uid) {
          const opponentId = p1Id === uid ? p2Id : p1Id;
          const cur = stateRef.current;
          const opponentName =
            cur?.participants.find((p) => p.userId === opponentId)?.username ?? "Opponent";
          setMyMatchReady({ tournamentMatchId, opponentId, opponentName, startsAt });
        }
      });

      socket.on("tournament.match_started", ({ tournamentMatchId, p1Id, p2Id }) => {
        setState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            matches: prev.matches.map((m) =>
              m.id === tournamentMatchId ? { ...m, status: "in_progress" as const } : m,
            ),
          };
        });
      });

      socket.on("match.found", ({ matchId, opponent, mode }: { matchId: string; opponent: any; mode?: string }) => {
        // Tournament match launched — redirect to game
        setMyMatchReady(null);
        router.push(`/game?mode=unranked&tournament=${tournamentId}`);
      });

      socket.on("tournament.bracket_updated", ({
        tournamentMatchId, winnerId, nextRound, nextPosition,
      }) => {
        setState((prev) => {
          if (!prev) return prev;
          const newMatches = prev.matches.map((m) => {
            if (m.id === tournamentMatchId) {
              return { ...m, winnerId, status: "completed" as const };
            }
            return m;
          });

          // Update next round match with advancing player
          if (nextRound !== null && nextPosition !== null) {
            const nextMatchIdx = newMatches.findIndex(
              (m) => m.round === nextRound && m.position === nextPosition,
            );
            if (nextMatchIdx !== -1) {
              const nm = { ...newMatches[nextMatchIdx] };
              const winnerName =
                prev.participants.find((p) => p.userId === winnerId)?.username ?? "Unknown";
              const completedMatch = prev.matches.find((m) => m.id === tournamentMatchId);
              const slotPosition = completedMatch?.position ?? 0;
              if (slotPosition % 2 === 0) {
                nm.p1 = { userId: winnerId, username: winnerName };
              } else {
                nm.p2 = { userId: winnerId, username: winnerName };
              }
              newMatches[nextMatchIdx] = nm;
            }
          }

          // Check if current user was eliminated
          const completedMatch = newMatches.find((m) => m.id === tournamentMatchId);
          if (completedMatch && winnerId !== uid) {
            const wasInMatch =
              completedMatch.p1?.userId === uid || completedMatch.p2?.userId === uid;
            if (wasInMatch) {
              setEliminated(true);
            }
          }

          return { ...prev, matches: newMatches };
        });
      });

      socket.on("tournament.completed", ({ winnerId: wId }) => {
        setState((prev) => (prev ? { ...prev, status: "completed", winnerId: wId } : prev));
      });
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown timer for match ready
  useEffect(() => {
    if (!myMatchReady) {
      setMatchCountdown(null);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((myMatchReady.startsAt - Date.now()) / 1000));
      setMatchCountdown(remaining);
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [myMatchReady]);

  function copyCode() {
    if (!state) return;
    navigator.clipboard.writeText(state.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleLeave() {
    socketRef.current?.emit(
      "tournament.leave",
      { tournamentId },
      () => router.replace("/"),
    );
  }

  function handleStart() {
    socketRef.current?.emit(
      "tournament.start",
      { tournamentId },
      (res: { ok?: boolean; error?: string }) => {
        if (res.error) console.error("Start error:", res.error);
      },
    );
  }

  if (!state) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          color: "var(--text3)",
        }}
      >
        Loading tournament...
      </div>
    );
  }

  const isHost = userId === state.hostId;
  const winnerName =
    state.winnerId
      ? state.participants.find((p) => p.userId === state.winnerId)?.username ?? "Unknown"
      : null;

  // ── Lobby ──────────────────────────────────────────────────────────────────

  if (state.status === "lobby") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          gap: "1.5rem",
          padding: "2rem 1rem",
          background: "var(--bg)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, lineHeight: 1, marginBottom: 8, color: "var(--text)" }}>
            ♠
          </div>
          <h1
            className="wordmark"
            style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text)" }}
          >
            Tournament
          </h1>
        </div>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: isMobile ? "1.5rem" : "2rem",
            width: isMobile ? "90vw" : 360,
            maxWidth: 400,
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
          }}
        >
          {/* Join code */}
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2,
                color: "var(--text3)",
                textTransform: "uppercase",
                marginBottom: "0.5rem",
              }}
            >
              Join Code
            </div>
            <button
              onClick={copyCode}
              style={{
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: 6,
                color: "var(--text)",
                fontFamily: "monospace",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.6rem 1.2rem",
                cursor: "pointer",
                width: "100%",
              }}
            >
              {state.joinCode}
            </button>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
              {copied ? "Copied!" : "Click to copy"}
            </div>
          </div>

          {/* Player list */}
          <div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text2)",
                marginBottom: "0.5rem",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Players</span>
              <span>
                {state.participants.length} / {state.size}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.35rem",
              }}
            >
              {state.participants.map((p) => (
                <div
                  key={p.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "0.5rem 0.65rem",
                    background: "var(--surface2)",
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "var(--success)",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text)",
                      flex: 1,
                    }}
                  >
                    {p.username}
                    {p.userId === state.hostId && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: "var(--primaryBtn)",
                          marginLeft: 6,
                          letterSpacing: 1,
                        }}
                      >
                        HOST
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          {isHost ? (
            <button
              onClick={handleStart}
              disabled={state.participants.length < 2}
              style={{
                background:
                  state.participants.length < 2 ? "var(--surface2)" : "var(--primaryBtn)",
                color:
                  state.participants.length < 2 ? "var(--text3)" : "var(--primaryBtnText)",
                border: "1px solid transparent",
                borderRadius: 4,
                padding: "0.8rem 1.25rem",
                fontSize: "0.95rem",
                fontFamily: "monospace",
                fontWeight: 700,
                cursor: state.participants.length < 2 ? "not-allowed" : "pointer",
                letterSpacing: 0.5,
                width: "100%",
              }}
            >
              Start Tournament
            </button>
          ) : (
            <div
              style={{
                textAlign: "center",
                fontSize: 13,
                color: "var(--text3)",
                padding: "0.5rem 0",
              }}
            >
              Waiting for host to start...
            </div>
          )}
          <button
            onClick={handleLeave}
            style={{
              background: "transparent",
              color: "var(--danger)",
              border: "1px solid var(--danger)",
              borderRadius: 4,
              padding: "0.65rem 1.25rem",
              fontSize: "0.9rem",
              fontFamily: "monospace",
              fontWeight: 700,
              cursor: "pointer",
              width: "100%",
              letterSpacing: 0.3,
            }}
          >
            Leave
          </button>
        </div>
      </div>
    );
  }

  // ── In Progress / Completed ────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        fontFamily: "monospace",
        color: "var(--text)",
      }}
    >
      {/* Header */}
      <header
        style={{
          height: 48,
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 13 }}>
          Tournament {state.joinCode}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: "uppercase",
            color:
              state.status === "completed" ? "var(--success)" : "#F59E0B",
          }}
        >
          {state.status === "completed" ? "Completed" : "In Progress"}
        </span>
      </header>

      <main
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: isMobile ? "1rem" : "2rem 1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
        }}
      >
        {/* Winner banner */}
        {state.status === "completed" && winnerName && (
          <div
            style={{
              textAlign: "center",
              padding: "1.5rem",
              background: "var(--surface)",
              border: "1px solid var(--success)",
              borderRadius: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 2,
                color: "var(--text3)",
                textTransform: "uppercase",
                marginBottom: "0.5rem",
              }}
            >
              Champion
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: "var(--success)",
              }}
            >
              {winnerName}
            </div>
          </div>
        )}

        {/* Match ready banner */}
        {myMatchReady && matchCountdown !== null && (
          <div
            style={{
              textAlign: "center",
              padding: "1rem 1.5rem",
              background: "var(--surface)",
              border: "1px solid #60A5FA",
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#60A5FA" }}>
              Your match starts in {matchCountdown}s
            </div>
            <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 4 }}>
              vs {myMatchReady.opponentName}
            </div>
          </div>
        )}

        {/* Eliminated banner */}
        {eliminated && state.status !== "completed" && (
          <div
            style={{
              textAlign: "center",
              padding: "1rem 1.5rem",
              background: "var(--surface)",
              border: "1px solid var(--danger)",
              borderRadius: 8,
              color: "var(--danger)",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            You were eliminated. Watching bracket updates...
          </div>
        )}

        {/* Bracket */}
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: isMobile ? "1rem" : "1.5rem",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2,
              color: "var(--text3)",
              textTransform: "uppercase",
              marginBottom: "1rem",
            }}
          >
            Bracket
          </div>
          <BracketView
            matches={state.matches}
            size={state.size}
            currentUserId={userId}
            participants={state.participants}
          />
        </div>

        {/* Back / Leave button */}
        {state.status === "completed" ? (
          <button
            onClick={() => router.push("/")}
            style={{
              background: "var(--primaryBtn)",
              color: "var(--primaryBtnText)",
              border: "1px solid transparent",
              borderRadius: 4,
              padding: "0.8rem 1.25rem",
              fontSize: "0.95rem",
              fontFamily: "monospace",
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: 0.5,
              width: "100%",
              maxWidth: 300,
              alignSelf: "center",
            }}
          >
            Back to Lobby
          </button>
        ) : (
          <button
            onClick={handleLeave}
            style={{
              background: "transparent",
              color: "var(--danger)",
              border: "1px solid var(--danger)",
              borderRadius: 4,
              padding: "0.65rem 1.25rem",
              fontSize: "0.9rem",
              fontFamily: "monospace",
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: 0.3,
              width: "100%",
              maxWidth: 300,
              alignSelf: "center",
            }}
          >
            Leave Tournament
          </button>
        )}
      </main>
    </div>
  );
}
