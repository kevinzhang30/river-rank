<img width="2000" height="2000" alt="RiverRank.io" src="https://github.com/user-attachments/assets/4f8b2206-3653-469c-ab57-3d0f457a8455" />

# [RiverRank.io](https://riverrank.io/)

RiverRank.io is a real-time multiplayer heads-up poker platform featuring ranked Elo matchmaking, server-authoritative game logic, and authenticated user accounts.

The application is designed as a production-style system demonstrating real-time communication, distributed state management, and secure backend validation.

<!-- USER_COUNT_START -->
**1,132** users | **977** matches completed

*Last updated: 2026-04-06*
<!-- USER_COUNT_END -->

---

## About

RiverRank.io is a real-time multiplayer heads-up No-Limit Texas Hold’em platform with Elo-rated matchmaking, single-elimination tournaments, and a tiered bot ladder. All game logic is server-authoritative — clients submit actions, and the server validates legality, manages betting rounds, resolves showdowns, and updates ratings atomically.

### Game Modes

- **Ranked** — Elo on the line with K-factor 32 and a minimum +5 Elo gain per win
- **Unranked** — Casual play, no rating impact
- **Bullet** — Accelerated blinds (every 2 hands), 10-second turn timers, 4-second inter-hand delay

### Tournaments

Single-elimination brackets for 4 or 8 players. Host creates a lobby with a join code, players ready up, and matches play out round by round with real-time bracket updates broadcast to all participants.

### Social

Friends list via unique friend codes with head-to-head record tracking, direct challenges (ranked or unranked) with 30-second expiration, live spectating of any active match, and a persistent notification inbox for friend requests, challenges, achievement unlocks, and milestone announcements.

### Progression & Cosmetics

Emote system with 4 equippable slots, 7-second in-match cooldown, and optional sound effects. Emotes span three tiers — free, achievement, and premium.

### Player Profiles

Elo rating with peak Elo tracking, career win/loss record, country flag (194 countries), match history with per-match rating deltas, and a top-50 leaderboard.

---

## Architecture

### Frontend
- **Next.js 14** (React 18) with TypeScript
- Socket.IO client for real-time state synchronization
- Supabase JS client for auth and profile queries
- CSS custom properties theming with light/dark mode

### Backend
- **Node.js** with Express and TypeScript
- **Socket.IO 4** — 30+ event types across match, tournament, social, and spectator channels
- Server-authoritative poker engine: betting validation, showdown evaluation, all-in runout sequencing, blind escalation
- Elo rating engine with atomic post-match updates
- Multi-tab presence tracking and 30-second disconnect grace with automatic reconnection

### Database & Auth
- **Supabase Auth** email/user + passord login
- **PostgreSQL** with Row-Level Security across all tables
- `security definer` RPCs for atomic match resolution, emote claims, and achievement unlocks
- Advisory locks for serialization of concurrent operations (early adopter claims, tournament advancement)
- Separate Prisma-managed PostgreSQL instance for real-time game session state

### Infrastructure
- **Vercel** (frontend) / **Railway** (backend) / **Supabase** (database + auth)
- GitHub Actions cron for automated README stat updates

---

## Roadmap

- Mobile app support
- Paid cosmetics store and battle pass
- Multi-table tournaments
