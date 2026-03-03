// ── Types ─────────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  rating: number;
}

export interface Match {
  player1: Player; // lower-rated (or first-joined among equals)
  player2: Player; // higher-rated (or second-joined)
  matchId: string;
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export class MatchmakingQueue {
  private queue: Player[] = [];
  private matchCounter = 0;

  /** Number of players currently waiting. */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Add a player to the queue. Throws if the player is already waiting.
   * Returns a Match immediately when a suitable opponent is found, or
   * null if the player is still waiting.
   */
  enqueue(player: Player): Match | null {
    if (this.queue.some(p => p.id === player.id)) {
      throw new Error(`Player "${player.id}" is already in the queue`);
    }

    this.queue.push(player);

    if (this.queue.length < 2) return null;

    return this._pair();
  }

  /**
   * Remove a waiting player from the queue.
   * Returns true if removed, false if they were not in the queue.
   */
  dequeue(playerId: string): boolean {
    const idx = this.queue.findIndex(p => p.id === playerId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  /**
   * Whether a player is currently waiting.
   */
  has(playerId: string): boolean {
    return this.queue.some(p => p.id === playerId);
  }

  /**
   * Find the best match in the queue: the pair with the smallest rating
   * difference. Ties are broken by earliest join order (FIFO).
   * Removes both players from the queue and returns the Match.
   */
  private _pair(): Match {
    let bestDiff = Infinity;
    let bestI = 0;
    let bestJ = 1;

    for (let i = 0; i < this.queue.length - 1; i++) {
      for (let j = i + 1; j < this.queue.length; j++) {
        const diff = Math.abs(this.queue[i].rating - this.queue[j].rating);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestI = i;
          bestJ = j;
        }
      }
    }

    // Remove in reverse-index order so indices stay valid.
    const [a, b] = [this.queue[bestI], this.queue[bestJ]];
    this.queue.splice(bestJ, 1);
    this.queue.splice(bestI, 1);

    const matchId = `match-${++this.matchCounter}`;
    // player1 = lower-rated; player2 = higher-rated (or equal → join order)
    const [player1, player2] = a.rating <= b.rating ? [a, b] : [b, a];
    return { player1, player2, matchId };
  }
}
