"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { supabase } from "@/lib/supabaseClient";
import { BracketView } from "@/ui/BracketView";
import { PokerTable } from "@/ui/PokerTable";
import { useIsMobile } from "@/lib/useIsMobile";
import type { TournamentState, TournamentMatchInfo, PublicGameState } from "@/ui/types";

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
  const [myMatchReady, setMyMatchReady] = useState<{
    tournamentMatchId: string;
    opponentId: string;
    opponentName: string;
  } | null>(null);
  const [readyPlayerIds, setReadyPlayerIds] = useState<Set<string>>(new Set());
  const [eliminated, setEliminated] = useState(false);
  const [sessionReplaced, setSessionReplaced] = useState(false);
  const [spectating, setSpectating] = useState<{ tournamentMatchId: string; matchId: string } | null>(null);
  const [spectateState, setSpectateState] = useState<PublicGameState | null>(null);
  const [spectateAllInCards, setSpectateAllInCards] = useState<Record<string, [string, string]> | null>(null);
  const [spectateBestHands, setSpectateBestHands] = useState<Record<string, string> | null>(null);
  const [spectateEnded, setSpectateEnded] = useState<{ winnerId: string; winnerUsername: string } | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const spectatingRef = useRef(spectating);
  spectatingRef.current = spectating;

  const fetchState = useCallback((socket: Socket, uid: string) => {
    socket.emit(
      "tournament.get_state",
      { tournamentId },
      (res: TournamentState & { error?: string }) => {
        if (res.error) return;
        setState(res);

        // Check if user has a ready match (e.g. returning from a game)
        if (res.status === 'in_progress') {
          const readyMatch = res.matches.find(
            (m) => m.status === 'ready' &&
              (m.p1?.userId === uid || m.p2?.userId === uid),
          );
          if (readyMatch) {
            const opponentId = readyMatch.p1?.userId === uid
              ? readyMatch.p2?.userId ?? ''
              : readyMatch.p1?.userId ?? '';
            const opponentName = readyMatch.p1?.userId === uid
              ? readyMatch.p2?.username ?? 'Opponent'
              : readyMatch.p1?.username ?? 'Opponent';
            setMyMatchReady({ tournamentMatchId: readyMatch.id, opponentId, opponentName });
            setReadyPlayerIds(new Set());
          }

          // Check if user is eliminated
          const userMatches = res.matches.filter(
            (m) => (m.p1?.userId === uid || m.p2?.userId === uid) && m.status === 'completed',
          );
          const wasEliminated = userMatches.some((m) => m.winnerId && m.winnerId !== uid);
          if (wasEliminated) setEliminated(true);
        }
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
            fetchState(socket, uid);
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
        tournamentMatchId, round, position, p1Id, p2Id,
      }: {
        tournamentMatchId: string;
        round: number;
        position: number;
        p1Id: string;
        p2Id: string;
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
          // Auto-stop spectating if we were watching another match
          const cur_spectating = spectatingRef.current;
          if (cur_spectating) {
            socket.emit("spectate.leave", { matchId: cur_spectating.matchId });
            setSpectating(null);
            setSpectateState(null);
            setSpectateAllInCards(null);
            setSpectateBestHands(null);
            setSpectateEnded(null);
          }

          const opponentId = p1Id === uid ? p2Id : p1Id;
          const cur = stateRef.current;
          const opponentName =
            cur?.participants.find((p) => p.userId === opponentId)?.username ?? "Opponent";
          setMyMatchReady({ tournamentMatchId, opponentId, opponentName });
          setReadyPlayerIds(new Set());
        }
      });

      socket.on("tournament.player_readied", ({
        tournamentMatchId, userId: readiedUserId, readyPlayerIds: ids,
      }: {
        tournamentMatchId: string;
        userId: string;
        readyPlayerIds: string[];
      }) => {
        setReadyPlayerIds(new Set(ids));
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

      socket.on("spectate.state", ({ publicState, allInCards, bestHands }: {
        publicState: PublicGameState;
        allInCards: Record<string, [string, string]> | null;
        bestHands: Record<string, string> | null;
      }) => {
        setSpectateState(publicState);
        setSpectateAllInCards(allInCards);
        setSpectateBestHands(bestHands);
      });

      socket.on("spectate.ended", ({ winnerId: wId, winnerUsername: wName }: {
        winnerId: string; winnerUsername: string;
      }) => {
        setSpectateEnded({ winnerId: wId, winnerUsername: wName });
        setTimeout(() => {
          setSpectating(null);
          setSpectateState(null);
          setSpectateAllInCards(null);
          setSpectateBestHands(null);
          setSpectateEnded(null);
        }, 3000);
      });

      socket.on("session.replaced", () => {
        setSessionReplaced(true);
      });
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleReadyUp() {
    if (!myMatchReady) return;
    socketRef.current?.emit(
      "tournament.match_ready_up",
      { tournamentMatchId: myMatchReady.tournamentMatchId },
      (res: { ok?: boolean; error?: string }) => {
        if (res.error) console.error("Ready up error:", res.error);
      },
    );
  }

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

  function handleSpectate(tournamentMatchId: string) {
    socketRef.current?.emit(
      "spectate.join",
      { tournamentMatchId },
      (res: { ok?: boolean; matchId?: string; error?: string }) => {
        if (res.ok && res.matchId) {
          setSpectating({ tournamentMatchId, matchId: res.matchId });
          setSpectateEnded(null);
        }
      },
    );
  }

  function handleStopSpectating() {
    if (spectating) {
      socketRef.current?.emit("spectate.leave", { matchId: spectating.matchId });
    }
    setSpectating(null);
    setSpectateState(null);
    setSpectateAllInCards(null);
    setSpectateBestHands(null);
    setSpectateEnded(null);
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

  if (sessionReplaced) {
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
          This session was opened in another tab.
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

        {/* Match ready-up banner */}
        {myMatchReady && (() => {
          const youReady = !!(userId && readyPlayerIds.has(userId));
          const oppReady = readyPlayerIds.has(myMatchReady.opponentId);
          return (
            <div
              style={{
                padding: "1.5rem",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "1.25rem",
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "var(--text3)", textTransform: "uppercase" }}>
                Next Match
              </div>

              {/* Player vs Player row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: isMobile ? "1rem" : "1.5rem",
                  width: "100%",
                  justifyContent: "center",
                }}
              >
                {/* You */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 80 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      border: `2px solid ${youReady ? "var(--success)" : "var(--border)"}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 800,
                      color: youReady ? "var(--success)" : "var(--text3)",
                      background: youReady ? "rgba(34,197,94,0.1)" : "var(--surface2)",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {youReady ? "✓" : "?"}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>You</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: youReady ? "var(--success)" : "var(--text3)" }}>
                    {youReady ? "READY" : "NOT READY"}
                  </span>
                </div>

                {/* VS */}
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text3)", letterSpacing: 1 }}>
                  VS
                </div>

                {/* Opponent */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 80 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      border: `2px solid ${oppReady ? "var(--success)" : "var(--border)"}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 800,
                      color: oppReady ? "var(--success)" : "var(--text3)",
                      background: oppReady ? "rgba(34,197,94,0.1)" : "var(--surface2)",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {oppReady ? "✓" : "?"}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
                    {myMatchReady.opponentName}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: oppReady ? "var(--success)" : "var(--text3)" }}>
                    {oppReady ? "READY" : "NOT READY"}
                  </span>
                </div>
              </div>

              {/* Action */}
              {!youReady ? (
                <button
                  onClick={handleReadyUp}
                  style={{
                    background: "var(--primaryBtn)",
                    color: "var(--primaryBtnText)",
                    border: "1px solid transparent",
                    borderRadius: 4,
                    padding: "0.7rem 2.5rem",
                    fontSize: "0.95rem",
                    fontFamily: "monospace",
                    fontWeight: 700,
                    cursor: "pointer",
                    letterSpacing: 0.5,
                  }}
                >
                  Ready Up
                </button>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 600 }}>
                  Waiting for opponent...
                </div>
              )}
            </div>
          );
        })()}

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
            onSpectate={handleSpectate}
          />
        </div>

        {/* Spectator view */}
        {spectating && spectateState && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid #F59E0B",
              borderRadius: 8,
              overflow: "hidden",
              position: "relative",
            }}
          >
            {/* Spectator header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.5rem 1rem",
                borderBottom: "1px solid var(--border)",
                background: "var(--surface2)",
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#F59E0B", textTransform: "uppercase" }}>
                Spectating
              </span>
              <button
                onClick={handleStopSpectating}
                style={{
                  background: "transparent",
                  color: "var(--text3)",
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                  padding: "2px 10px",
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "monospace",
                  letterSpacing: 1,
                  textTransform: "uppercase",
                }}
              >
                Close
              </button>
            </div>

            {/* Match ended overlay */}
            {spectateEnded && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0,0,0,0.7)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 10,
                }}
              >
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: "var(--text3)", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>
                    Match Over
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--success)" }}>
                    {spectateEnded.winnerUsername} wins
                  </div>
                </div>
              </div>
            )}

            <div style={{ height: "min(70vh, 600px)" }}>
              <PokerTable
                state={spectateState}
                heroUserId=""
                heroHoleCards={spectateAllInCards?.[spectateState.players[1]?.userId] ?? null}
                spectatorMode={true}
                liveOpponentCards={spectateAllInCards?.[spectateState.players[0]?.userId] ?? null}
                heroBestHand={spectateBestHands?.[spectateState.players[1]?.userId] ?? null}
                opponentBestHand={spectateBestHands?.[spectateState.players[0]?.userId] ?? null}
              />
            </div>
          </div>
        )}

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
