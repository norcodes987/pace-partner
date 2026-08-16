# RunPartner SG — Architecture

## Overview

RunPartner SG is a running partner matchmaking app for Singapore: it matches runners by pace and a shared MRT station, with identity verified via Singpass. The system is an npm workspaces monorepo of independent microservices plus a mobile app, built one service/feature per conversation (see `CLAUDE.md`).

```
apps/
  mobile/        # Expo, TypeScript, Zustand — screens per ui-inspo.png
services/
  auth/          # Singpass login, session JWTs
  matching/      # runner profiles, candidate discovery, mutual-accept matches
  chat/          # Socket.IO messaging between matched users
packages/
  shared/        # Prisma client/schema, zod env config, shared auth verification
```

Every service shares one Postgres database via a single `packages/shared/prisma/schema.prisma` — each phase adds the models it owns to that shared schema rather than running separate databases per service. All DB access goes through the shared Prisma client (CLAUDE.md rule 3); all external input is validated with zod (rule 4).

## Services

- **auth** — Owns identity only. Runs the Singpass OIDC flow (TEST/mockpass environment; see `docs/singpass-integration.md`), issues a session JWT on successful login, and exposes `/auth/me` for looking up the current user. Does not own profile data (pace, MRT stations) or anything past proving "this is a real, unique Singpass holder." *Status: done (Phase 1).*
- **matching** — Owns runner profiles and match formation. A user sets their pace and selected MRT stations, browses candidates filtered by the compatibility rule below, and accepts or passes on each; a match forms only when both sides accept. Gates chat access to mutual matches. *Status: done (Phase 2).*
- **chat** — Owns real-time messaging between matched users, via Socket.IO. Messages are stored in Redis with a 24h TTL, not Postgres — chat history is intentionally ephemeral. *Status: not yet designed (Phase 3).*
- **mobile** — The user-facing Expo app covering the above flows: Singpass login, profile setup, candidate browsing/swiping, and chat. Visual direction follows `ui-inspo.png` (palette, typography, components). *Status: scaffolded only (Phase 0); no real screens yet (Phase 4).*

## Data Flow

1. User logs in via Singpass (auth) → receives a session JWT.
2. User completes a runner profile — pace and selected MRT stations (matching).
3. User browses candidates matching and mutual-accepts to matches (matching).
4. Matched users chat in real time; messages live in Redis for 24h (chat).

Every authenticated request after step 1 carries the same session JWT; auth signs it, and any service that needs to identify the caller verifies it via the shared verification helper in `packages/shared` rather than each service maintaining its own copy.

## Key Decisions

- **Compatibility rule**: pace within 30s/km *and* at least one shared selected MRT station. Both users must select the same station explicitly — this isn't geo-distance matching, so there's no PostGIS/spatial dependency anywhere in the system.
- **Chat storage**: Socket.IO for transport, Redis for storage with a 24h TTL — chat is treated as ephemeral, not an archived record, so it doesn't live in Postgres.
- **Singpass environment**: TEST/mockpass only for now (see `docs/singpass-integration.md`); real NDI staging requires relying-party onboarding this project doesn't have yet, but the integration is config-compatible so switching later doesn't require route-handler changes.
- **Single shared Postgres schema**: one `schema.prisma` in `packages/shared`, each phase adding the models it owns, rather than a database per service. Chosen for simplicity at this service count over strict per-service data ownership.
- **No monorepo task runner**: plain npm workspace scripts (`npm run build -ws --if-present`, etc.) are sufficient at this package count — no Turborepo/Nx.

## MVP Feature List

This is the scope boundary CLAUDE.md rule 7 ("don't add features outside the MVP") checks against. Anything not listed here is out of scope without an explicit decision to expand it.

**Auth**
- Singpass login (TEST/mockpass), session JWT issuance
- `GET /auth/me` — current user lookup

**Matching**
- Runner profile: pace (seconds/km) + selected MRT stations
- Candidate discovery filtered by the compatibility rule
- Accept/pass on candidates; mutual accept creates a match
- List own matches

**Chat**
- Real-time messaging (Socket.IO) between matched users only
- Redis-backed message storage, 24h TTL
- No message history beyond 24h, no read receipts/typing indicators unless later decided

**Mobile**
- Singpass login screen/flow
- Runner profile setup (pace, MRT station selection)
- Candidate browsing/swipe UI
- Match list
- Chat UI
- Visual direction per `ui-inspo.png`

## Phase Roadmap

- Phase 0 — Shared foundation. Done. [`docs/superpowers/specs/2026-08-12-phase-0-shared-foundation-design.md`](superpowers/specs/2026-08-12-phase-0-shared-foundation-design.md)
- Phase 1 — Auth service. Done. [`docs/superpowers/specs/2026-08-14-phase-1-auth-service-design.md`](superpowers/specs/2026-08-14-phase-1-auth-service-design.md)
- Phase 2 — Matching service. Done. [`docs/superpowers/specs/2026-08-16-phase-2-matching-service-design.md`](superpowers/specs/2026-08-16-phase-2-matching-service-design.md)
- Phase 3 — Chat service (Socket.IO + Redis). Not yet designed.
- Phase 4 — Mobile app (Expo, screens per `ui-inspo.png`). Not yet designed.
