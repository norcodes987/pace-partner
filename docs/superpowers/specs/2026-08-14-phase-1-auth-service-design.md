# Phase 1: Auth Service — Design

## Context

RunPartner SG matches runners by pace and shared MRT station, with identity verified via Singpass. Phase 0 (merged into this branch) delivered the monorepo skeleton: `services/auth` currently exposes only `GET /health`, `packages/shared` exports a Prisma client and a zod env-loader, and local infra (Postgres 16, Redis 7, RabbitMQ) runs via `docker-compose.yml`.

This is Phase 1 of five:

- Phase 0 — Shared foundation (done)
- **Phase 1 — Auth service** (this spec): Singpass login, TEST environment, session issuance
- Phase 2 — Matching service (pace + MRT station compatibility)
- Phase 3 — Chat service (Socket.IO + Redis)
- Phase 4 — Mobile app (Expo, screens per `ui-inspo.png`)

`CLAUDE.md` names `docs/singpass-integration.md` as the source of truth for the integration, but that file doesn't exist yet — this spec designs the integration from Singpass's public NDI documentation and becomes that reference.

Per CLAUDE.md rule 2 ("one microservice at a time"), this phase touches only `services/auth` and the parts of `packages/shared` (schema, env) that `auth` depends on.

## Scope

Auth owns identity only: proving a user is a real, unique Singpass holder and issuing a session token. It does **not** own profile data — pace and MRT station preferences belong to Phase 2's `User` extensions, not this phase. No mobile UI exists yet (Phase 4), so this phase's client is `curl`/Postman hitting the service directly; the login/callback routes return JSON rather than performing a browser redirect back to an app.

## Singpass Integration

Real Singpass NDI staging requires relying-party onboarding (registered client ID, hosted JWKS) that this project doesn't have yet. Rather than stub the integration or block on onboarding, this phase runs the real OIDC protocol against **`@opengovsg/mockpass`** — a local mock Singpass/MyInfo IdP that exposes the same OIDC endpoints (`.well-known/openid-configuration`, `/authorize`, `/token`) real NDI staging would. `services/auth` talks to it via **`@govtechsg/singpass-myinfo-oidc-helper`**'s `NdiOidcHelper`, the official Node helper for NDI's OIDC flow (PKCE, `private_key_jwt` client assertion, ID-token JWE decryption).

Because the helper is configured entirely via env vars (`SINGPASS_OIDC_CONFIG_URL`, client ID, redirect URI, keys), switching from mockpass to real NDI staging later is a config change, not a code change — the route handlers don't know which one they're talking to.

`mockpass` joins `docker-compose.yml` as a fourth local service (port 5156), configured with `SP_RP_JWKS_ENDPOINT` pointing at the auth service's own `/.well-known/jwks.json`.

### Local dev key material

The OIDC flow needs an EC keypair: one key signs the client-assertion JWT, the other decrypts the ID-token JWE. A one-time setup script (`services/auth/scripts/generate-dev-keys.ts`) generates this pair into `services/auth/keys/` (gitignored — never real NDI keys, regenerable by anyone via the script). `services/auth` serves the public half at `GET /.well-known/jwks.json` for mockpass to fetch.

## Data Model

One addition to `packages/shared/prisma/schema.prisma`:

```prisma
model User {
  id          String   @id @default(uuid())
  singpassSub String   @unique
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

`singpassSub` is the pairwise identifier NDI issues per relying party — stable per user, not a raw NRIC. No other fields this phase.

## Routes

- **`GET /auth/singpass/login`** — generates a PKCE verifier, `state`, and `nonce`; stores them server-side in an in-memory `Map` keyed by `state` with a 5-minute TTL (single-instance dev service — no Redis dependency introduced this phase); builds the authorization URL via `constructAuthorizationUrlV2()`; redirects to it.
- **`GET /auth/singpass/callback?code&state`** — looks up and deletes the `state` entry (single-use, guards replay; unknown/expired `state` → `400`); exchanges `code` for tokens (`getTokens`); decrypts and verifies the ID token (`getIdTokenPayload`, `extractNricAndUuidFromPayload`); upserts a `User` by `singpassSub`; issues our own JWT (HS256, `JWT_SECRET`, 1h expiry, payload `{ sub: user.id }`); responds `{ accessToken, user: { id } }`.
- **`GET /auth/me`** — middleware verifies the `Authorization: Bearer <jwt>` header (missing/invalid/expired → `401`); loads the `User`; responds `{ id, singpassSub, createdAt }`.

No logout endpoint this phase — the JWT is stateless; the client discards it. A revocation list would need Redis and isn't justified until something actually needs it.

## Config and Environment

New vars in `.env.example`, validated by an auth-specific zod schema (extending, not replacing, `packages/shared`'s `loadEnv`):

```
JWT_SECRET=
SINGPASS_CLIENT_ID=
SINGPASS_REDIRECT_URI=http://localhost:4001/auth/singpass/callback
SINGPASS_OIDC_CONFIG_URL=http://localhost:5156/singpass/v2/.well-known/openid-configuration
```

Key file paths are read from `services/auth/keys/` directly, not from env vars.

## Error Handling

- Env validation fails fast at startup with a specific message, same pattern as Phase 0.
- `/auth/singpass/callback`: `400` for unknown/expired `state`; `502` with `{ error }` if token exchange or ID-token verification fails.
- `/auth/me`: `401` for missing/invalid/expired JWT.
- No new error-handling patterns beyond what Phase 0 established.

## Testing

Vitest, matching Phase 0's per-service pattern:

- Existing `/health` smoke test (unchanged).
- `/auth/me` returns `401` without a token.
- `/auth/me` returns the right user for a hand-crafted valid JWT.
- Integration test for the full login → callback round trip against mockpass, guarded to skip if mockpass isn't reachable (same spirit as Phase 0's Docker-dependent verification steps).

## Out of Scope for Phase 1

Real NDI staging onboarding (config-compatible, not built this phase), MyInfo profile data (name/DOB/etc. — a separate API from Singpass Login), any `User` fields beyond identity (pace, MRT station — Phase 2), logout/session revocation, refresh tokens, mobile UI (Phase 4), and `docs/architecture.md`/`docs/api.md` (still deferred per the Phase 0 spec).
