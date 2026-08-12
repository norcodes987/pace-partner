# Phase 0: Shared Foundation — Design

## Context

RunPartner SG is a running partner matchmaking app for Singapore, matching runners by pace and shared MRT station, with Singpass auth. The system is built as an npm workspaces monorepo of independent microservices plus a mobile app, developed one service/feature per conversation (see `CLAUDE.md`).

This is the first of five phases:

- **Phase 0 — Shared foundation** (this spec): monorepo layout, shared config, local infra. No business logic.
- Phase 1 — Auth service (Singpass, TEST environment)
- Phase 2 — Matching service (pace + MRT station compatibility)
- Phase 3 — Chat service (Socket.IO + Redis)
- Phase 4 — Mobile app (Expo, screens per `ui-inspo.png`)

The goal of Phase 0 is a monorepo skeleton where every package is wired, builds, and boots — nothing more. Later phases build features on top of this without needing to touch tooling again.

## Repo Layout

```
apps/
  mobile/              # Expo SDK 51+, TypeScript, Zustand installed
services/
  auth/                # Express (Phase 1)
  matching/            # Express (Phase 2)
  chat/                # Express + Socket.IO (Phase 3)
packages/
  shared/              # Prisma client, zod env-config helper, shared TS types
docker-compose.yml     # Postgres 16, Redis 7, RabbitMQ
tsconfig.base.json     # strict: true — extended by every package
package.json           # npm workspaces root
.env.example
.gitignore
```

Each package under `apps/`, `services/`, and `packages/` has its own `package.json` with a scoped name (`@pace-partner/shared`, `@pace-partner/auth`, `@pace-partner/matching`, `@pace-partner/chat`, `@pace-partner/mobile`) and its own `tsconfig.json` extending the root `tsconfig.base.json`.

No monorepo task runner (e.g. Turborepo) — at this package count, plain npm workspace scripts are sufficient. The root `package.json` exposes scripts like `"build": "npm run build -ws --if-present"` and `"test": "npm test -ws --if-present"` that fan out to every package.

## Database

A single `schema.prisma` lives in `packages/shared`, targeting Postgres 16 (no PostGIS — matching is by discrete MRT station, not geo-distance, so there's no spatial query need). Phase 0 defines no domain models (no `User`, `Match`, etc.); each later phase adds the models it owns to this shared schema when that phase is implemented. Every service imports the generated Prisma client from `@pace-partner/shared` rather than instantiating its own — this is the mechanism for CLAUDE.md's "all DB access through Prisma" rule.

Migrations are managed via `prisma migrate` from `packages/shared`; no raw SQL outside of migration files.

## Local Infrastructure

`docker-compose.yml` (recreated fresh — confirmed with user since CLAUDE.md flags this file) runs three services for local development:

- **Postgres 16** — plain image, one database, connected to by Prisma.
- **Redis 7** — running, not yet used by any service (Phase 3 will use it for chat message storage with 24h TTL).
- **RabbitMQ** — running, not yet used by any service. No shared connection helper is built in Phase 0; that gets added in whichever later phase first needs a queue.

## Config and Environment

`packages/shared` exports a zod schema describing required environment variables (`DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`, and a per-service `PORT`). Each service validates `process.env` against this schema at startup and fails fast with a clear, specific error if a required variable is missing or malformed. This is the one input surface Phase 0 has, and it satisfies CLAUDE.md's "validate all inputs with zod" rule.

`.env.example` at the repo root documents every variable the schema expects.

## Proof-of-Life Per Package

Each package includes just enough code to prove the wiring works, with no real feature logic:

- **`services/auth`, `services/matching`, `services/chat`**: a minimal Express app exposing `GET /health`, returning `{ status: "ok", service: "<name>" }`. This proves TypeScript strict mode compiles, the service boots, reads its env config, and (where applicable) connects to Postgres via the shared Prisma client.
- **`apps/mobile`**: the default Expo TypeScript template, with Zustand added as a dependency. No real screens — that's Phase 4.
- **`packages/shared`**: the Prisma schema/client and the zod env-config helper described above.

## Testing

Vitest is the test runner for every package (chosen over Jest for faster, simpler ESM/TS-strict setup). Each service gets one smoke test that hits `/health` and asserts a 200 response. `packages/shared` gets tests asserting that the env schema rejects a missing/malformed variable and that the Prisma client can be instantiated. The root `package.json` runs all package tests via `npm test -ws --if-present`.

## Error Handling

- Env validation (zod) fails fast at process startup with a specific, actionable error — never a silent default or a runtime crash deep in request handling.
- TypeScript strict mode catches type errors at compile time across all packages.
- No CI config is added in this phase (CLAUDE.md flags CI config as requiring sign-off first, and it's out of scope here).

## Out of Scope for Phase 0

Singpass integration, any domain models (`User`, `Match`, etc.), matching compatibility logic, chat/Socket.IO wiring, mobile screens/UI, CI configuration, RabbitMQ connection helpers, and `docs/architecture.md` / `docs/api.md` (to be written later, once real services exist for them to document).
