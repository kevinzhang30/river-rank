"use client";

import type { TournamentMatchInfo } from "./types";

interface BracketViewProps {
  matches: TournamentMatchInfo[];
  size: 4 | 8;
  currentUserId: string | null;
  participants: { userId: string; username: string; seed: number | null }[];
  onSpectate?: (tournamentMatchId: string) => void;
}

function MatchCard({
  match,
  currentUserId,
  onSpectate,
}: {
  match: TournamentMatchInfo;
  currentUserId: string | null;
  onSpectate?: (tournamentMatchId: string) => void;
}) {
  const isUserMatch =
    match.p1?.userId === currentUserId || match.p2?.userId === currentUserId;

  const statusColor =
    match.status === "completed"
      ? "var(--success)"
      : match.status === "in_progress"
      ? "#F59E0B"
      : match.status === "ready"
      ? "#60A5FA"
      : match.status === "bye"
      ? "var(--text3)"
      : "var(--border)";

  function playerRow(
    player: { userId: string; username: string } | null,
    isWinner: boolean,
    isLoser: boolean,
  ) {
    return (
      <div
        style={{
          padding: "0.4rem 0.6rem",
          fontSize: 12,
          fontWeight: isWinner ? 700 : 400,
          color: isWinner
            ? "var(--success)"
            : isLoser
            ? "var(--text3)"
            : "var(--text)",
          opacity: isLoser ? 0.5 : 1,
          borderBottom: "1px solid var(--border)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {player?.username ?? (match.status === "bye" ? "BYE" : "TBD")}
      </div>
    );
  }

  const p1Winner = match.winnerId === match.p1?.userId;
  const p2Winner = match.winnerId === match.p2?.userId;
  const canSpectate = match.status === "in_progress" && !isUserMatch && !!onSpectate;

  return (
    <div
      onClick={canSpectate ? () => onSpectate!(match.id) : undefined}
      style={{
        background: "var(--surface)",
        border: `1px solid ${isUserMatch ? "var(--primaryBtn)" : "var(--border)"}`,
        borderRadius: 6,
        overflow: "hidden",
        minWidth: 120,
        borderLeft: `3px solid ${statusColor}`,
        cursor: canSpectate ? "pointer" : undefined,
        position: "relative",
      }}
    >
      {canSpectate && (
        <div
          style={{
            position: "absolute",
            top: 2,
            right: 4,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: 1,
            color: "#F59E0B",
            textTransform: "uppercase",
          }}
        >
          LIVE
        </div>
      )}
      {playerRow(match.p1, p1Winner, p2Winner)}
      {playerRow(match.p2, p2Winner, p1Winner)}
    </div>
  );
}

export function BracketView({ matches, size, currentUserId, onSpectate }: BracketViewProps) {
  const totalRounds = Math.log2(size);
  const rounds: TournamentMatchInfo[][] = [];

  for (let r = 1; r <= totalRounds; r++) {
    rounds.push(
      matches
        .filter((m) => m.round === r)
        .sort((a, b) => a.position - b.position),
    );
  }

  const roundLabels =
    size === 4
      ? ["Semifinals", "Final"]
      : ["Quarterfinals", "Semifinals", "Final"];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${totalRounds}, 1fr)`,
        gap: "1.5rem",
        overflowX: "auto",
        padding: "0.5rem 0",
      }}
    >
      {rounds.map((roundMatches, ri) => (
        <div key={ri} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2,
              color: "var(--text3)",
              textTransform: "uppercase",
              textAlign: "center",
              marginBottom: "0.5rem",
            }}
          >
            {roundLabels[ri] ?? `Round ${ri + 1}`}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-around",
              flex: 1,
              gap: "0.75rem",
            }}
          >
            {roundMatches.map((match) => (
              <MatchCard key={match.id} match={match} currentUserId={currentUserId} onSpectate={onSpectate} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
