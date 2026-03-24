"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { supabase } from "@/lib/supabaseClient";
import { PokerTable } from "@/ui/PokerTable";
import { DebugPanel } from "@/ui/DebugPanel";
import { mockState, mockHeroHoleCards } from "@/ui/mockState";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  adaptBackendState,
  isBackendGameState,
  type BackendGameState,
} from "@/ui/adapters";
import type { PublicGameState, PublicPlayer, Mode, EmoteEvent } from "@/ui/types";
import type { EmoteDefinition } from "@/lib/emotes";
import { rowToEmoteDefinition } from "@/lib/emotes";
import { unlockAudio, play, preloadSound } from "@/lib/sound";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

interface Opponent {
  userId:   string;
  username: string;
  elo:      number;
}

// ── Main game component ───────────────────────────────────────────────────────

function GameView() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const mode         = (searchParams.get("mode") ?? "ranked") as Mode;
  const tournamentId = searchParams.get("tournament");
  const isTournamentMatch = !!tournamentId;
  const isMobile     = useIsMobile();

  const socketRef  = useRef<Socket | null>(null);
  const userIdRef  = useRef<string | null>(null);

  const [userId, setUserId]               = useState<string | null>(null);
  const [username, setUsername]           = useState<string>("");
  const [status, setStatus]               = useState("connecting…");
  const [noAuth, setNoAuth]               = useState(false);

  const [matchId, setMatchId]             = useState<string | null>(null);
  const [opponent, setOpponent]           = useState<Opponent | null>(null);
  const [matchMode, setMatchMode]         = useState<Mode>(mode);

  type MatchResult = {
    winnerId:       string;
    winnerUsername: string;
    ratingDelta:    Record<string, number> | null;
    reason?:        string;
  };

  const [matchResult, setMatchResult]     = useState<MatchResult | null>(null);
  const [pendingResult, setPendingResult] = useState<MatchResult | null>(null);

  const [queueStartMs, setQueueStartMs]   = useState<number | null>(null);
  const [queueTick, setQueueTick]         = useState(0);
  const [liveState, setLiveState]         = useState<PublicGameState | null>(null);
  const [liveHeroCards, setLiveHeroCards] = useState<[string, string] | null>(null);
  const [heroBestHand, setHeroBestHand] = useState<string | null>(null);
  const [liveOpponentCards, setLiveOpponentCards] = useState<[string, string] | null>(null);
  const [opponentBestHand, setOpponentBestHand] = useState<string | null>(null);
  const [rawBackendState, setRawBackendState] = useState<BackendGameState | null>(null);
  const [opponentDisconnectedAt, setOpponentDisconnectedAt] = useState<number | null>(null);
  const [activeEmotes, setActiveEmotes] = useState<EmoteEvent[]>([]);
  const [equippedEmotes, setEquippedEmotes] = useState<EmoteDefinition[]>([]);
  const [emoteRegistry, setEmoteRegistry] = useState<Record<string, EmoteDefinition>>({});

  // Ref to access latest emoteRegistry inside socket handler closure
  const emoteRegistryRef = useRef<Record<string, EmoteDefinition>>({});
  useEffect(() => { emoteRegistryRef.current = emoteRegistry; }, [emoteRegistry]);

  // Unlock audio on first user gesture
  useEffect(() => {
    const handler = () => {
      unlockAudio();
      window.removeEventListener("click", handler);
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("click", handler);
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("click", handler);
      window.removeEventListener("keydown", handler);
    };
  }, []);

  // Preload emote sounds when registry loads
  useEffect(() => {
    for (const def of Object.values(emoteRegistry)) {
      if (def.soundUrl) preloadSound(def.soundUrl);
    }
  }, [emoteRegistry]);

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
            if (isTournamentMatch) {
              setStatus("waiting for tournament match…");
            } else {
              setStatus("in queue…");
              setQueueStartMs(Date.now());
              socket.emit("queue.join", { mode });
            }
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
        ({ publicState, heroHoleCards, heroBestHand, opponentHoleCards, opponentBestHand }: { publicState: PublicGameState; heroHoleCards: string[]; heroBestHand?: string | null; opponentHoleCards?: string[] | null; opponentBestHand?: string | null }) => {
          setLiveState(publicState);
          if (heroHoleCards.length >= 2) {
            setLiveHeroCards([heroHoleCards[0], heroHoleCards[1]]);
          }
          setHeroBestHand(heroBestHand ?? null);
          setOpponentBestHand(opponentBestHand ?? null);
          if (opponentHoleCards && opponentHoleCards.length >= 2) {
            setLiveOpponentCards([opponentHoleCards[0], opponentHoleCards[1]]);
          } else {
            setLiveOpponentCards(null);
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
        ({ winnerId, winnerUsername, ratingDelta, reason }: {
          matchId:        string;
          winnerId:       string;
          winnerUsername: string;
          ranked:         boolean;
          ratingDelta:    Record<string, number> | null;
          reason?:        string;
        }) => {
          const result = { winnerId, winnerUsername, ratingDelta: ratingDelta ?? null, reason };
          if (reason === "FORFEIT" || reason === "DISCONNECT" || reason === "TIMEOUT") {
            setMatchResult(result);
          } else {
            setPendingResult(result);
          }
        },
      );

      socket.on("emote.event", ({ actorUserId, emoteId, createdAt }: { actorUserId: string; emoteId: string; createdAt: number }) => {
        console.log("[emote.event] received:", { actorUserId, emoteId, createdAt });
        const id = `${actorUserId}-${createdAt}`;
        setActiveEmotes((prev) => [...prev, { id, actorUserId, emoteId, createdAt }]);
        // Play emote sound if available
        const def = emoteRegistryRef.current[emoteId];
        if (def?.soundUrl) play(def.soundUrl);
      });

      socket.on("player.disconnected", () => {
        setOpponentDisconnectedAt(Date.now());
      });

      socket.on("player.reconnected", () => {
        setOpponentDisconnectedAt(null);
      });

      socket.on("session.replaced", () => {
        setStatus("session replaced");
      });

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

  // Fetch equipped emotes when userId is available
  useEffect(() => {
    if (!userId) return;
    (async () => {
      // Fetch all emotes for the registry
      const { data: allEmotes } = await supabase
        .from("emotes")
        .select("id, name, image_url, asset_type, sound_url, tier")
        .order("sort_order");
      const reg: Record<string, EmoteDefinition> = {};
      for (const row of allEmotes ?? []) {
        reg[row.id] = rowToEmoteDefinition(row);
      }
      setEmoteRegistry(reg);

      // Fetch equipped emotes (joined with emotes table)
      const { data: equipped } = await supabase
        .from("equipped_emotes")
        .select("slot, emote_id, emotes(id, name, image_url, asset_type, sound_url, tier)")
        .eq("user_id", userId)
        .order("slot");

      if (equipped && equipped.length > 0) {
        setEquippedEmotes(
          equipped
            .filter((e: any) => e.emotes)
            .map((e: any) => rowToEmoteDefinition(e.emotes)),
        );
      }
      // No fallback — only show emotes the player explicitly equipped in the lobby
    })();
  }, [userId]);

  // Tick every second while in queue to update countdown
  useEffect(() => {
    if (status !== "in queue…") return;
    const interval = setInterval(() => setQueueTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [status]);

  function sendAction(action: string, amount?: number) {
    if (!matchId) return;
    socketRef.current?.emit("game.action", { matchId, action, amount });
  }

  function sendReveal(cards: string[]) {
    if (!matchId) return;
    socketRef.current?.emit("hand.reveal", { matchId, cards });
  }

  function sendReady() {
    if (!matchId) return;
    socketRef.current?.emit("hand.ready", { matchId });
  }

  function sendForfeit() {
    if (!matchId) return;
    socketRef.current?.emit("game.forfeit", { matchId });
  }

  function sendEmote(emoteId: string) {
    if (!matchId) return;
    socketRef.current?.emit("emote.send", { matchId, emoteId }, (ack: string) => {
      console.log("[emote.send] ack:", ack);
    });
  }

  function handleEmoteComplete(id: string) {
    setActiveEmotes((prev) => prev.filter((e) => e.id !== id));
  }

  function backToLobby() {
    if (status === "in queue…") {
      socketRef.current?.emit("queue.leave");
    }
    socketRef.current?.disconnect();
    if (isTournamentMatch) {
      router.push(`/tournament/${tournamentId}`);
    } else {
      router.push("/");
    }
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

  // ── Session replaced ────────────────────────────────────────────────────────

  if (status === "session replaced") {
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
          heroBestHand={heroBestHand}
          liveOpponentCards={liveOpponentCards}
          opponentBestHand={opponentBestHand}
          onFold={() => sendAction("FOLD")}
          onCheck={() => sendAction("CHECK")}
          onCall={() => sendAction("CALL")}
          onRaise={(amount) => sendAction("RAISE_TO", amount)}
          onReveal={sendReveal}
          onReady={sendReady}
          onForfeit={sendForfeit}
          opponentDisconnectedAt={opponentDisconnectedAt}
          pendingResult={pendingResult}
          onViewResults={() => { setMatchResult(pendingResult); setPendingResult(null); }}
          activeEmotes={activeEmotes}
          onSendEmote={sendEmote}
          onEmoteComplete={handleEmoteComplete}
          equippedEmotes={equippedEmotes}
          emoteRegistry={emoteRegistry}
        />
        {process.env.NEXT_PUBLIC_DEBUG === "true" && <DebugPanel state={debugState} />}

        {matchResult && (
          <div
            style={{
              position:       "fixed",
              inset:          0,
              background:     "rgba(0,0,0,0.5)",
              backdropFilter: "blur(6px)",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              zIndex:         100,
            }}
          >
            <div
              style={{
                background:    "var(--surface)",
                border:        "1px solid var(--border)",
                borderRadius:  8,
                padding:       isMobile ? "1.5rem 1.25rem" : "2.5rem 3rem",
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
                {matchResult.reason === "FORFEIT"
                  ? isWinner ? "Your opponent forfeited." : "You forfeited the match."
                  : matchResult.reason === "DISCONNECT"
                  ? isWinner ? "Your opponent disconnected." : "You were disconnected."
                  : matchResult.reason === "TIMEOUT"
                  ? isWinner ? "Your opponent timed out." : "You timed out."
                  : isWinner
                  ? "Your opponent ran out of chips."
                  : `${matchResult.winnerUsername} wins the match.`}
              </div>
              <button
                onClick={backToLobby}
                style={{
                  background:    isWinner ? "var(--success)" : "transparent",
                  color:         isWinner ? "var(--primaryBtnText)" : "var(--danger)",
                  border:        isWinner ? "1px solid transparent" : "1px solid var(--danger)",
                  borderRadius:  4,
                  padding:       "0.65rem 1.25rem",
                  fontSize:      "0.9rem",
                  fontFamily:    "monospace",
                  fontWeight:    700,
                  cursor:        "pointer",
                  letterSpacing: 0.3,
                }}
              >
                {isTournamentMatch ? "Back to Bracket" : "Back to Lobby"}
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
        <h1 className="wordmark" style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text)" }}>
          RiverRank.io
        </h1>
      </div>

      <div
        style={{
          background:    "var(--surface)",
          border:        "1px solid var(--border)",
          borderRadius:  8,
          padding:       isMobile ? "1.5rem" : "2rem",
          width:         isMobile ? "90vw" : 300,
          maxWidth:      isMobile ? 300 : undefined,
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
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ color: "var(--text2)", fontSize: 13 }}>
              {status === "in queue…"
                ? `Finding ${mode} opponent…`
                : status}
            </span>
            {status === "in queue…" && queueStartMs && (() => {
              const elapsed  = Math.floor((Date.now() - queueStartMs) / 1000);
              return (
                <span style={{ color: "var(--text3)", fontSize: 11, fontFamily: "monospace" }}>
                  Searching for opponent… {elapsed}s
                </span>
              );
            })()}
          </div>
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
