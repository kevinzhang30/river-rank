<img width="2000" height="2000" alt="RiverRank.io" src="https://github.com/user-attachments/assets/4f8b2206-3653-469c-ab57-3d0f457a8455" />

# [RiverRank.io](https://riverrank.io/)

RiverRank.io is a real-time multiplayer heads-up poker platform featuring ranked Elo matchmaking, server-authoritative game logic, and authenticated user accounts.

The application is designed as a production-style system demonstrating real-time communication, distributed state management, and secure backend validation.

<!-- USER_COUNT_START -->
**1,109** users | **642** matches completed

*Last updated: 2026-03-23*
<!-- USER_COUNT_END -->

---

## Description

RiverRank.io allows users to:

- Play real-time heads-up No-Limit Texas Hold’em
- Compete in ranked or unranked matches
- Gain or lose Elo rating based on match results
- View a personal match history and leaderboard standings
- Authenticate via secure email magic link login

All game logic is enforced server-side. Clients submit actions only; the server validates legality, manages betting rounds, handles all-in runouts, resolves showdowns, and updates ratings atomically.

The system is built with production principles in mind:
- Server-authoritative state transitions
- Authenticated WebSocket connections
- Atomic rating updates
- Deterministic match lifecycle handling

---

## Technologies

### Frontend
- Next.js (React)
- TypeScript
- CSS variables-based theming (light/dark mode)
- Socket.IO client for real-time updates
- Supabase client for authentication and profile data

### Backend
- Node.js
- TypeScript
- Socket.IO for real-time multiplayer communication
- Server-authoritative poker engine
- Elo rating system (K-factor based)

### Database & Authentication
- Supabase Auth
- PostgreSQL (Supabase)
- Row-Level Security policies
- RPC function for atomic match + rating updates

### Deployment
- Frontend: Vercel
- Backend: Railway
- Database & Auth: Supabase

---

## Core Concepts Implemented

- Real-time state synchronization
- Turn timers with automatic enforcement
- All-in runout handling
- Match persistence
- Rating delta tracking
- Leaderboard queries
- First-login username onboarding
- Secure JWT verification for socket connections

---

## Status

Active development. Designed as a long-term platform project. Version 1 release is underway.

---

## Stretch Goals

- Mobile App support
- Increase User count
- Paid cosmetics and battle pass subscription paywall for advanced features
- Sound
