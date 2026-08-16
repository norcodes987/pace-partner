# Phase 2: Matching Service — Design

## Context

RunPartner SG matches runners by pace and shared MRT station. Phase 0 delivered the monorepo skeleton; Phase 1 (merged) delivered `services/auth` — Singpass login against mockpass, session issuance as an HS256 JWT (`{ sub: userId }`), and a `User { id, singpassSub, createdAt, updatedAt }` model in `packages/shared/prisma/schema.prisma`. `services/matching` currently only exposes the Phase 0 `GET /health` scaffold.

This is Phase 2 of five:

- Phase 0 — Shared foundation (done)
- Phase 1 — Auth service (done)
- **Phase 2 — Matching service** (this spec): pace + MRT station profiles, browsing, mutual-accept matching
- Phase 3 — Chat service (Socket.IO + Redis)
- Phase 4 — Mobile app (Expo, screens per `ui-inspo.png`)

`docs/architecture.md`, referenced by `CLAUDE.md` for the MVP feature list, still doesn't exist (same gap Phase 0 and Phase 1 specs flagged) — the matching flow in this spec was defined directly with the user rather than read from that doc.

Per CLAUDE.md rule 2 ("one microservice at a time"), this phase touches `services/matching`, the parts of `packages/shared` it depends on (schema, env, and a mechanical auth-verification refactor described below), and does not touch `services/auth`'s routes, Singpass integration, or session-issuance logic.

## Scope

Matching owns runner profiles (pace + selected MRT stations), candidate discovery, and mutual-accept match creation. It does not own chat (Phase 3) or any Singpass/identity concerns (Phase 1, unchanged). No mobile UI exists yet (Phase 4); this phase's client is `curl`/Postman, same as Phase 1.

**Flow:** a user who has already authenticated via `services/auth` completes a `RunnerProfile` (pace, MRT stations) in matching, browses candidates filtered by the compatibility rule, and accepts or passes on each. A `Match` is created only when both users have accepted each other — this gates Phase 3's chat access to mutual matches, and mirrors a simplified swipe flow.

## Cross-Service Auth Refactor

Both `services/auth` and `services/matching` need to verify the same session JWT. Phase 1 put `verifySessionToken` (`services/auth/src/jwt.ts`) and the `requireAuth` middleware (`services/auth/src/middleware/requireAuth.ts`) inside `services/auth`, with no shared home for them.

This phase moves the **verify-only** half to `packages/shared/src/auth/`:

- `packages/shared/src/auth/verifyJwt.ts` — `verifySessionToken(token, secret): SessionTokenPayload`, moved as-is from `services/auth/src/jwt.ts`.
- `packages/shared/src/auth/requireAuth.ts` — `requireAuth(secret): RequestHandler` and the `AuthedRequest` type, moved as-is from `services/auth/src/middleware/requireAuth.ts`.

`signSessionToken` stays in `services/auth` — only auth issues tokens. `services/auth`'s routes and tests are updated to import verification from `@pace-partner/shared` instead of their local copies (mechanical import-path change, no behavior change). `services/matching` imports the same way. `packages/shared` gains `jsonwebtoken` and `express` (for the `RequestHandler` type) as dependencies.

## Data Model

Three additions to `packages/shared/prisma/schema.prisma`, owned by matching:

```prisma
model RunnerProfile {
  id               String   @id @default(uuid())
  userId           String   @unique
  user             User     @relation(fields: [userId], references: [id])
  paceSecondsPerKm Int
  mrtStations      String[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model Swipe {
  id           String        @id @default(uuid())
  userId       String
  targetUserId String
  decision     SwipeDecision
  createdAt    DateTime      @default(now())

  @@unique([userId, targetUserId])
}

enum SwipeDecision {
  ACCEPT
  PASS
}

model Match {
  id        String   @id @default(uuid())
  userAId   String
  userBId   String
  createdAt DateTime @default(now())

  @@unique([userAId, userBId])
}
```

`User` gains the back-relation `runnerProfile RunnerProfile?`. `Match.userAId`/`userBId` are always stored in a canonical order (lower UUID string first) so the unique constraint prevents a duplicate `Match` row regardless of which side accepted second.

**Pace** is stored as `paceSecondsPerKm: Int` (e.g. `330` for 5:30/km), validated by zod to a reasonable range (180–900s/km). The `±30s/km` compatibility rule is plain integer comparison. Any `mm:ss` display formatting is a client concern (Phase 4), not stored or computed server-side.

**MRT stations**: `packages/shared` exports a canonical const list of every current Singapore MRT/LRT station name (`MRT_STATIONS`) plus a zod enum derived from it. `RunnerProfile.mrtStations` is validated as a non-empty array of values from that enum — this guarantees two users' station strings can only match on the compatibility check if they're genuinely the same station, with no typo/case drift.

## Routes

All routes are under `/matching` and require `requireAuth` (imported from `@pace-partner/shared`).

- **`PUT /matching/profile`** — upsert the caller's `RunnerProfile`. Body `{ paceSecondsPerKm, mrtStations }`, zod-validated. Returns the saved profile.
- **`GET /matching/profile`** — returns the caller's own `RunnerProfile`; `404` if none exists yet.
- **`GET /matching/candidates`** — `400` if the caller has no `RunnerProfile` ("complete your profile first"). Otherwise queries other users' `RunnerProfile`s via Prisma: `paceSecondsPerKm` within the caller's ±30s/km window (`gte`/`lte`), `mrtStations` overlapping the caller's (`hasSome`), excluding the caller and anyone the caller has already swiped on (any `Swipe` row with `userId = caller`). Capped at 50 results, no pagination this phase.
- **`POST /matching/candidates/:userId/swipe`** — body `{ decision: "ACCEPT" | "PASS" }`, zod-validated. `400` for swiping on self or a nonexistent `userId`; `409` if the caller already has a `Swipe` row for this target. Creates the `Swipe` row. On `ACCEPT`, checks for a reciprocal `ACCEPT` (`Swipe` where `userId = target, targetUserId = caller, decision = ACCEPT`); if found, creates the `Match` (canonical id ordering as above). Returns the created `Swipe` and, if applicable, the new `Match`.
- **`GET /matching/matches`** — lists the caller's matches: `Match` rows where the caller is `userAId` or `userBId`, returning each match's id, the other user's id, and `createdAt`.

## Error Handling

Same pattern as Phase 1 — no new conventions invented:

- Env validation fails fast at startup, same as Phase 0/1.
- `requireAuth` → `401` for missing/invalid/expired JWT (unchanged behavior, moved location).
- zod validation failures → `400` with a specific message.
- Missing profile on `GET /matching/profile` → `404`; missing profile on `GET /matching/candidates` → `400` (browsing without a profile is a user error, not a "not found").
- Self-swipe or unknown target on `POST .../swipe` → `400`; duplicate swipe → `409`.

## Testing

Vitest, matching Phase 1's per-service pattern:

- Existing `/health` smoke test (unchanged).
- Unit tests for the compatibility query (pace window boundaries, station overlap, exclusion of self/already-swiped).
- Route tests per endpoint: success path and each documented error path (`400`/`401`/`404`/`409`).
- Integration test for the full round trip: two users create profiles, swipe `ACCEPT` on each other, and a `Match` appears in both `GET /matching/matches` responses.
- `services/auth`'s existing JWT/`requireAuth` tests move with the code to `packages/shared` and continue to pass; `services/auth`'s route tests are updated only to import from the new location.

## Out of Scope for Phase 2

Unmatching, blocking/reporting, profile fields beyond pace and MRT stations (photos, bio, name), pagination on candidates, MyInfo-derived profile data, any chat or notification hookup (Phase 3), mobile UI (Phase 4), and `docs/architecture.md`/`docs/api.md` (still deferred, per Phase 0 and Phase 1 specs).
