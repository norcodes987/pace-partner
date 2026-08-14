# Phase 1: Auth Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `services/auth` a real Singpass Login (NDI OIDC) flow — login, callback, session issuance, `/me` — running against a local mockpass IdP, with a config-only path to swap in real NDI staging later.

**Architecture:** Express routes in `services/auth` drive the OIDC authorization-code + PKCE flow via `@govtechsg/singpass-myinfo-oidc-helper`'s `Singpass.NdiOidcHelper` (the NDI v2 OIDC class — not `NdiOidcHelperV2`, which targets a newer PAR+DPoP profile not needed here), talking to a new `mockpass` service in `docker-compose.yml`. A verified ID token's `sub` claim decodes to both an NRIC and a UUID; only the UUID is persisted, as `User.singpassSub` in a new Prisma model. On success the service issues its own stateless HS256 JWT that the rest of the system verifies independently — nothing downstream needs to know Singpass exists.

**Tech Stack:** `@govtechsg/singpass-myinfo-oidc-helper@^9.1.0`, `openid-client@^5.7.1` (PKCE/state/nonce generators), `jsonwebtoken@^9.0.3`, `opengovsg/mockpass` (Docker image), existing Phase 0 stack (Express 4, Prisma 5, zod, Vitest, TypeScript strict/NodeNext).

**Spec:** `docs/superpowers/specs/2026-08-14-phase-1-auth-service-design.md`

## Global Constraints

- TypeScript `strict: true`; no `any` without a justifying comment (CLAUDE.md rule 1).
- All DB access through Prisma — no raw SQL outside migration files (CLAUDE.md rule 3).
- All external inputs validated with zod (CLAUDE.md rule 4).
- This phase touches only `services/auth` and the parts of `packages/shared` (`schema.prisma`) that `auth` depends on — no changes to `services/matching` or `services/chat` (CLAUDE.md rule 2).
- `docker-compose.yml` changes are in scope per the approved spec (adding `mockpass`) — no other infra/CI changes.
- Only `User.singpassSub` (a UUID) is persisted from Singpass identity data — the `nric` value from `extractNricAndUuidFromPayload` is used transiently during login and never stored.
- No MyInfo profile data, no `User` fields beyond identity, no logout/refresh tokens, no mobile UI this phase (spec's "Out of Scope").

---

## Task 1: `User` model in the shared Prisma schema

**Files:**
- Modify: `packages/shared/prisma/schema.prisma`
- Creates (generated): `packages/shared/prisma/migrations/<timestamp>_add_user_model/migration.sql`

**Interfaces:**
- Produces: `prisma.user.{findUnique,upsert}` on the shared Prisma client, typed with `{ id: string; singpassSub: string; createdAt: Date; updatedAt: Date }`. Task 8 depends on this.

- [ ] **Step 1: Add the `User` model**

```prisma
// packages/shared/prisma/schema.prisma — add below the existing generator/datasource blocks
model User {
  id          String   @id @default(uuid())
  singpassSub String   @unique
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

- [ ] **Step 2: Start local Postgres**

Run: `docker compose up -d postgres` (repo root)
Expected: `postgres` container running. If Docker isn't available in this environment, note that and skip to Step 5 with a manual review of the schema instead — same fallback Phase 0 used for `docker-compose.yml` changes.

- [ ] **Step 3: Generate and apply the migration**

Run: `npm run generate --workspace=packages/shared -- --schema=prisma/schema.prisma` is not needed separately — `migrate dev` runs it. Instead run:
`npx prisma migrate dev --name add_user_model --schema=packages/shared/prisma/schema.prisma`
(run from repo root, or `cd packages/shared && npx prisma migrate dev --name add_user_model`)
Expected: a new `packages/shared/prisma/migrations/<timestamp>_add_user_model/migration.sql` containing `CREATE TABLE "User" (...)`, and "Your database is now in sync with your schema" — this also regenerates the Prisma client.

- [ ] **Step 4: Confirm the shared package still builds**

Run: `npm run build --workspace=packages/shared`
Expected: exits 0, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/prisma
git commit -m "feat(shared): add User model for Singpass identity"
```

---

## Task 2: `mockpass` local Singpass IdP in docker-compose

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Interfaces:**
- Produces: a `mockpass` container on `localhost:5156` exposing `GET /singpass/v2/.well-known/openid-configuration`, `/singpass/v2/auth`, `/singpass/v2/token`. Task 7 consumes this via `SINGPASS_OIDC_CONFIG_URL`.

- [ ] **Step 1: Add the `mockpass` service**

```yaml
# docker-compose.yml — add under the existing `services:` key, alongside postgres/redis/rabbitmq
  mockpass:
    image: opengovsg/mockpass:latest
    restart: unless-stopped
    environment:
      MOCKPASS_PORT: 5156
      SHOW_LOGIN_PAGE: "false"
      MOCKPASS_NRIC: S8979373D
    ports:
      - "5156:5156"
```

- [ ] **Step 2: Add the new env vars to `.env.example`**

```
# services/auth — Singpass (mockpass locally; swap for real NDI staging config later)
JWT_SECRET=dev-only-change-me
SINGPASS_CLIENT_ID=test-client
SINGPASS_REDIRECT_URI=http://localhost:4001/auth/singpass/callback
SINGPASS_OIDC_CONFIG_URL=http://localhost:5156/singpass/v2/.well-known/openid-configuration
```

- [ ] **Step 3: Validate and start**

Run: `docker compose config --quiet`
Expected: exit code 0, no output.
Run: `docker compose up -d mockpass` then `curl http://localhost:5156/singpass/v2/.well-known/openid-configuration`
Expected: a JSON discovery document containing `authorization_endpoint`, `token_endpoint`, `issuer`. If Docker isn't available in this environment, skip execution and visually diff the compose block against the one above instead (same fallback Phase 0 used).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: add mockpass local Singpass IdP for dev/test"
```

---

## Task 3: Vendor mockpass's test keypair + auth env loader

**Files:**
- Create: `services/auth/keys/oidc-v2-rp-secret.json`
- Create: `services/auth/src/env.ts`
- Test: `services/auth/test/env.test.ts`

**Interfaces:**
- Consumes: `loadEnv` from `@pace-partner/shared` (Phase 0).
- Produces: `loadAuthEnv(source?: NodeJS.ProcessEnv): AuthEnv` where `AuthEnv` is the shared env plus `{ JWT_SECRET: string; SINGPASS_CLIENT_ID: string; SINGPASS_REDIRECT_URI: string; SINGPASS_OIDC_CONFIG_URL: string }`. Tasks 6-8 import `AuthEnv` and call `loadAuthEnv`.

- [ ] **Step 1: Vendor mockpass's published test keypair**

This is mockpass's own public, non-secret test fixture (`static/certs/oidc-v2-rp-secret.json` in `github.com/opengovsg/mockpass`) — mockpass trusts it by default with zero extra configuration. It is never valid against real NDI.

```json
// services/auth/keys/oidc-v2-rp-secret.json
{
  "keys": [
    {
      "kty": "EC",
      "d": "AFOzlND2sq43ykty-VZXw-IEIOyHkBsNXUU77o5yEYcktpoMe9Dl3jsaXwzRK6wtDJH_uoz4IG1Uj4J_WyH5O3GS",
      "use": "sig",
      "crv": "P-521",
      "kid": "sig-2022-06-04T09:22:28Z",
      "x": "AAj_CAKL9NmP6agPCMto6_LiYQqko3o3ZWTtBg75bA__Z8yKEv_CwHzaibkVLnJ9XKWxCQeyEk9ROLhJoJuZxnsI",
      "y": "AZeoe0v-EwqD3oo1V5lxUAmC80qHt-ybqOsl1mYKPgE_ctGcD4hj8tVhmD0Of6ARuKVTxNWej-X82hEW_7Aa-XpR",
      "alg": "ES512"
    },
    {
      "kty": "EC",
      "d": "AP7xECOnlKW-FuLpe1h3ULZoqFzScFrbyAEQTFFG49j5HRHl0k13-6_6nWnwJ9Y8sTrGOWH4GszmDBBZGGvESJQr",
      "use": "enc",
      "crv": "P-521",
      "kid": "enc-2022-06-04T13:46:15Z",
      "x": "AB-16HyJwnlSZbQtqhFskADqFrm6rgX9XeaV8FgynX61750GCRbYjoueDosSNt-qzK5QNHskdQw0QZ700YF2JIlb",
      "y": "AZwYlSBSdV-CxGRMz6ovTvWxKJ6e44gaZHf-YfbJV7w9VdAJb3OuzbHNGRuzNDjEa8eH-paLDaAB84ezrEm1SRHq",
      "alg": "ECDH-ES+A256KW"
    }
  ]
}
```

- [ ] **Step 2: Write the failing test for the env loader**

```ts
// services/auth/test/env.test.ts
import { describe, expect, it } from "vitest";
import { loadAuthEnv } from "../src/env.js";

const validEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  JWT_SECRET: "test-secret",
  SINGPASS_CLIENT_ID: "test-client",
  SINGPASS_REDIRECT_URI: "http://localhost:4001/auth/singpass/callback",
  SINGPASS_OIDC_CONFIG_URL: "http://localhost:5156/singpass/v2/.well-known/openid-configuration",
};

describe("loadAuthEnv", () => {
  it("parses a valid environment", () => {
    const env = loadAuthEnv(validEnv);
    expect(env.JWT_SECRET).toBe("test-secret");
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });

  it("throws when JWT_SECRET is missing", () => {
    const { JWT_SECRET, ...rest } = validEnv;
    expect(() => loadAuthEnv(rest)).toThrowError(/Invalid environment configuration/);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npm run test --workspace=services/auth`
Expected: FAIL — `src/env.ts` doesn't exist yet.

- [ ] **Step 4: Implement the auth env loader**

```ts
// services/auth/src/env.ts
import { z } from "zod";
import { loadEnv, type Env } from "@pace-partner/shared";

const authEnvSchema = z.object({
  JWT_SECRET: z.string().min(1),
  SINGPASS_CLIENT_ID: z.string().min(1),
  SINGPASS_REDIRECT_URI: z.string().url(),
  SINGPASS_OIDC_CONFIG_URL: z.string().url(),
});

export type AuthEnv = Env & z.infer<typeof authEnvSchema>;

export function loadAuthEnv(source: NodeJS.ProcessEnv = process.env): AuthEnv {
  const shared = loadEnv(source);
  const result = authEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return { ...shared, ...result.data };
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npm run test --workspace=services/auth`
Expected: PASS (existing health test + 2 new tests).

- [ ] **Step 6: Commit**

```bash
git add services/auth/keys services/auth/src/env.ts services/auth/test/env.test.ts
git commit -m "feat(auth): add env loader and vendor mockpass test keypair"
```

---

## Task 4: Session JWT module

**Files:**
- Create: `services/auth/src/jwt.ts`
- Test: `services/auth/test/jwt.test.ts`

**Interfaces:**
- Produces: `signSessionToken(userId: string, secret: string): string`, `verifySessionToken(token: string, secret: string): { sub: string }` (throws `Error` on invalid/expired). Tasks 6 and 8 depend on both.

- [ ] **Step 1: Install dependencies**

Run: `npm install jsonwebtoken@^9.0.3 --workspace=services/auth`
Run: `npm install -D @types/jsonwebtoken@^9.0.7 --workspace=services/auth`
Expected: both complete with no errors.

- [ ] **Step 2: Write the failing test**

```ts
// services/auth/test/jwt.test.ts
import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "../src/jwt.js";

describe("session JWT", () => {
  it("round-trips a user id", () => {
    const token = signSessionToken("user-123", "test-secret");
    const payload = verifySessionToken(token, "test-secret");
    expect(payload.sub).toBe("user-123");
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSessionToken("user-123", "test-secret");
    expect(() => verifySessionToken(token, "wrong-secret")).toThrow();
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npm run test --workspace=services/auth`
Expected: FAIL — `src/jwt.ts` doesn't exist yet.

- [ ] **Step 4: Implement**

```ts
// services/auth/src/jwt.ts
import jwt from "jsonwebtoken";

const SESSION_TOKEN_EXPIRY = "1h";

export function signSessionToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: SESSION_TOKEN_EXPIRY });
}

export interface SessionTokenPayload {
  sub: string;
}

export function verifySessionToken(token: string, secret: string): SessionTokenPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === "string" || typeof decoded.sub !== "string") {
    throw new Error("Invalid session token payload");
  }
  return { sub: decoded.sub };
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npm run test --workspace=services/auth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/auth/package.json services/auth/src/jwt.ts services/auth/test/jwt.test.ts package-lock.json
git commit -m "feat(auth): add session JWT sign/verify module"
```

---

## Task 5: In-memory PKCE state store

**Files:**
- Create: `services/auth/src/stateStore.ts`
- Test: `services/auth/test/stateStore.test.ts`

**Interfaces:**
- Produces: `class StateStore { save(state: string, entry: { nonce: string; codeVerifier: string }): void; consume(state: string): { nonce: string; codeVerifier: string } | undefined }`. Task 8 depends on this.

- [ ] **Step 1: Write the failing test**

```ts
// services/auth/test/stateStore.test.ts
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/stateStore.js";

describe("StateStore", () => {
  it("returns and clears a saved entry", () => {
    const store = new StateStore();
    store.save("state-1", { nonce: "nonce-1", codeVerifier: "verifier-1" });

    expect(store.consume("state-1")).toEqual({ nonce: "nonce-1", codeVerifier: "verifier-1" });
    expect(store.consume("state-1")).toBeUndefined();
  });

  it("returns undefined for an unknown state", () => {
    const store = new StateStore();
    expect(store.consume("never-saved")).toBeUndefined();
  });

  it("expires entries after the TTL", () => {
    let now = 1_000_000;
    const store = new StateStore(() => now);
    store.save("state-1", { nonce: "nonce-1", codeVerifier: "verifier-1" });

    now += 6 * 60 * 1000; // 6 minutes later, past the 5-minute TTL
    expect(store.consume("state-1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm run test --workspace=services/auth`
Expected: FAIL — `src/stateStore.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// services/auth/src/stateStore.ts
interface StateEntry {
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;

export class StateStore {
  private readonly store = new Map<string, StateEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  save(state: string, entry: { nonce: string; codeVerifier: string }): void {
    this.store.set(state, { ...entry, expiresAt: this.now() + TTL_MS });
  }

  consume(state: string): { nonce: string; codeVerifier: string } | undefined {
    const entry = this.store.get(state);
    this.store.delete(state);
    if (!entry || entry.expiresAt < this.now()) {
      return undefined;
    }
    return { nonce: entry.nonce, codeVerifier: entry.codeVerifier };
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm run test --workspace=services/auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/auth/src/stateStore.ts services/auth/test/stateStore.test.ts
git commit -m "feat(auth): add in-memory PKCE state store with TTL"
```

---

## Task 6: `requireAuth` middleware

**Files:**
- Create: `services/auth/src/middleware/requireAuth.ts`
- Test: `services/auth/test/requireAuth.test.ts`

**Interfaces:**
- Consumes: `verifySessionToken` from `./jwt.js` (Task 4).
- Produces: `requireAuth(secret: string): RequestHandler` — an Express middleware that 401s on a missing/invalid/expired `Authorization: Bearer <jwt>` header, otherwise sets `req.userId` and calls `next()`. Task 8 depends on this.

- [ ] **Step 1: Write the failing test**

```ts
// services/auth/test/requireAuth.test.ts
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { signSessionToken } from "../src/jwt.js";
import { requireAuth, type AuthedRequest } from "../src/middleware/requireAuth.js";

function buildTestApp(secret: string) {
  const app = express();
  app.get("/protected", requireAuth(secret), (req: AuthedRequest, res) => {
    res.json({ userId: req.userId });
  });
  return app;
}

describe("requireAuth", () => {
  it("returns 401 with no Authorization header", async () => {
    const response = await request(buildTestApp("test-secret")).get("/protected");
    expect(response.status).toBe(401);
  });

  it("returns 401 for an invalid token", async () => {
    const response = await request(buildTestApp("test-secret"))
      .get("/protected")
      .set("Authorization", "Bearer not-a-real-token");
    expect(response.status).toBe(401);
  });

  it("passes through with a valid token and sets req.userId", async () => {
    const token = signSessionToken("user-123", "test-secret");
    const response = await request(buildTestApp("test-secret"))
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: "user-123" });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm run test --workspace=services/auth`
Expected: FAIL — `src/middleware/requireAuth.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// services/auth/src/middleware/requireAuth.ts
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifySessionToken } from "../jwt.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(secret: string): RequestHandler {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }
    try {
      const payload = verifySessionToken(header.slice("Bearer ".length), secret);
      req.userId = payload.sub;
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm run test --workspace=services/auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/auth/src/middleware
git add services/auth/test/requireAuth.test.ts
git commit -m "feat(auth): add requireAuth middleware"
```

---

## Task 7: Singpass OIDC client wrapper

**Files:**
- Create: `services/auth/src/singpassClient.ts`
- Test: `services/auth/test/singpassClient.test.ts`

**Interfaces:**
- Consumes: the vendored keyset at `services/auth/keys/oidc-v2-rp-secret.json` (Task 3).
- Produces: `createSingpassClient(config: { oidcConfigUrl: string; clientId: string; redirectUri: string }): Singpass.NdiOidcHelper`. Task 8 depends on this.

- [ ] **Step 1: Install dependencies**

Run: `npm install @govtechsg/singpass-myinfo-oidc-helper@^9.1.0 openid-client@^5.7.1 --workspace=services/auth`
Expected: completes with no errors.

- [ ] **Step 2: Write the failing test**

```ts
// services/auth/test/singpassClient.test.ts
import { describe, expect, it } from "vitest";
import { createSingpassClient } from "../src/singpassClient.js";

describe("createSingpassClient", () => {
  it("constructs without throwing given valid config", () => {
    const client = createSingpassClient({
      oidcConfigUrl: "http://localhost:5156/singpass/v2/.well-known/openid-configuration",
      clientId: "test-client",
      redirectUri: "http://localhost:4001/auth/singpass/callback",
    });
    expect(client).toBeDefined();
    expect(typeof client.getTokens).toBe("function");
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npm run test --workspace=services/auth`
Expected: FAIL — `src/singpassClient.ts` doesn't exist yet.

- [ ] **Step 4: Implement**

```ts
// services/auth/src/singpassClient.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Singpass } from "@govtechsg/singpass-myinfo-oidc-helper";
import type { Algorithm } from "jsonwebtoken";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface VendoredJwk {
  use: string;
  alg: string;
  [key: string]: unknown;
}

// mockpass's own published test keypair (static/certs/oidc-v2-rp-secret.json from
// github.com/opengovsg/mockpass) -- not a secret, and never valid against real NDI.
const keySet = JSON.parse(
  readFileSync(path.join(__dirname, "../keys/oidc-v2-rp-secret.json"), "utf-8"),
) as { keys: VendoredJwk[] };

function findKey(use: "sig" | "enc"): VendoredJwk {
  const jwk = keySet.keys.find((k) => k.use === use);
  if (!jwk) {
    throw new Error(`No "${use}" key found in vendored keyset`);
  }
  return jwk;
}

export interface SingpassClientConfig {
  oidcConfigUrl: string;
  clientId: string;
  redirectUri: string;
}

export function createSingpassClient(config: SingpassClientConfig): Singpass.NdiOidcHelper {
  const sigJwk = findKey("sig");
  const encJwk = findKey("enc");

  return new Singpass.NdiOidcHelper({
    oidcConfigUrl: config.oidcConfigUrl,
    clientID: config.clientId,
    redirectUri: config.redirectUri,
    clientAssertionSignKey: {
      key: JSON.stringify(sigJwk),
      format: "json",
      alg: sigJwk.alg as Algorithm,
    },
    jweDecryptKey: {
      key: JSON.stringify(encJwk),
      format: "json",
    },
  });
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npm run test --workspace=services/auth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/auth/package.json services/auth/src/singpassClient.ts services/auth/test/singpassClient.test.ts package-lock.json
git commit -m "feat(auth): add Singpass OIDC client wrapper"
```

---

## Task 8: Singpass login/callback/me routes

**Files:**
- Create: `services/auth/src/routes/singpassAuth.ts`
- Create: `services/auth/test/fixtures/testEnv.ts`
- Modify: `services/auth/src/app.ts`
- Modify: `services/auth/src/index.ts`
- Modify: `services/auth/test/health.test.ts` (update for `createApp`'s new signature)
- Test: `services/auth/test/me.test.ts`
- Test: `services/auth/test/singpassFlow.test.ts`

**Interfaces:**
- Consumes: `AuthEnv`/`loadAuthEnv` (Task 3), `createSingpassClient` (Task 7), `StateStore` (Task 5), `signSessionToken`/`verifySessionToken` (Task 4), `requireAuth` (Task 6), `prisma` from `@pace-partner/shared` (Phase 0 + Task 1's `User` model).
- Produces: `createApp(env: AuthEnv): Express` (signature change from Phase 0's zero-arg version) mounting `GET /health`, `GET /auth/singpass/login`, `GET /auth/singpass/callback`, `GET /auth/me`.

- [ ] **Step 1: Add the shared test env fixture**

```ts
// services/auth/test/fixtures/testEnv.ts
import type { AuthEnv } from "../../src/env.js";

export const testEnv: AuthEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  JWT_SECRET: "test-secret",
  SINGPASS_CLIENT_ID: "test-client",
  SINGPASS_REDIRECT_URI: "http://localhost:4001/auth/singpass/callback",
  SINGPASS_OIDC_CONFIG_URL: "http://localhost:5156/singpass/v2/.well-known/openid-configuration",
};
```

- [ ] **Step 2: Update the existing health test for `createApp`'s new signature**

```ts
// services/auth/test/health.test.ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { testEnv } from "./fixtures/testEnv.js";

describe("GET /health", () => {
  it("returns ok status with the service name", async () => {
    const app = createApp(testEnv);
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "auth" });
  });
});
```

- [ ] **Step 3: Run the tests, verify the health test fails**

Run: `npm run test --workspace=services/auth`
Expected: FAIL — `createApp` still takes no arguments; type/behavior mismatch.

- [ ] **Step 4: Write the failing `/auth/me` test**

```ts
// services/auth/test/me.test.ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { signSessionToken } from "../src/jwt.js";
import { testEnv } from "./fixtures/testEnv.js";

describe("GET /auth/me", () => {
  it("returns 401 without a token", async () => {
    const response = await request(createApp(testEnv)).get("/auth/me");
    expect(response.status).toBe(401);
  });

  it("returns 401 for a user that no longer exists", async () => {
    const token = signSessionToken("nonexistent-user-id", testEnv.JWT_SECRET);
    const response = await request(createApp(testEnv))
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 5: Implement the routes**

```ts
// services/auth/src/routes/singpassAuth.ts
import { Router } from "express";
import { generators } from "openid-client";
import { prisma } from "@pace-partner/shared";
import type { AuthEnv } from "../env.js";
import { signSessionToken } from "../jwt.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { createSingpassClient } from "../singpassClient.js";
import { StateStore } from "../stateStore.js";

export function createSingpassAuthRouter(env: AuthEnv): Router {
  const router = Router();
  const singpassClient = createSingpassClient({
    oidcConfigUrl: env.SINGPASS_OIDC_CONFIG_URL,
    clientId: env.SINGPASS_CLIENT_ID,
    redirectUri: env.SINGPASS_REDIRECT_URI,
  });
  const stateStore = new StateStore();

  router.get("/singpass/login", async (_req, res) => {
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    stateStore.save(state, { nonce, codeVerifier });

    const authorizationUrl = await singpassClient.constructAuthorizationUrlV2({
      state,
      nonce,
      userInfoScope: [],
      codeVerifier,
    });
    res.redirect(authorizationUrl);
  });

  router.get("/singpass/callback", async (req, res) => {
    const { code, state } = req.query;
    if (typeof code !== "string" || typeof state !== "string") {
      res.status(400).json({ error: "Missing code or state" });
      return;
    }

    const stored = stateStore.consume(state);
    if (!stored) {
      res.status(400).json({ error: "Unknown or expired state" });
      return;
    }

    try {
      const tokens = await singpassClient.getTokens(code, stored.codeVerifier);
      const payload = await singpassClient.getIdTokenPayload(tokens);
      if (payload.nonce !== stored.nonce) {
        res.status(400).json({ error: "Nonce mismatch" });
        return;
      }

      const { uuid } = singpassClient.extractNricAndUuidFromPayload(payload);
      const user = await prisma.user.upsert({
        where: { singpassSub: uuid },
        create: { singpassSub: uuid },
        update: {},
      });

      const accessToken = signSessionToken(user.id, env.JWT_SECRET);
      res.json({ accessToken, user: { id: user.id } });
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "Singpass token exchange failed",
      });
    }
  });

  router.get("/me", requireAuth(env.JWT_SECRET), async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({ id: user.id, singpassSub: user.singpassSub, createdAt: user.createdAt });
  });

  return router;
}
```

- [ ] **Step 6: Wire the router into `app.ts`**

```ts
// services/auth/src/app.ts
import express, { type Express } from "express";
import type { AuthEnv } from "./env.js";
import { createSingpassAuthRouter } from "./routes/singpassAuth.js";

export function createApp(env: AuthEnv): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "auth" });
  });

  app.use("/auth", createSingpassAuthRouter(env));

  return app;
}
```

- [ ] **Step 7: Update the entrypoint**

```ts
// services/auth/src/index.ts
import { z } from "zod";
import { createApp } from "./app.js";
import { loadAuthEnv } from "./env.js";

const env = loadAuthEnv(process.env);
const port = z.coerce.number().int().positive().default(4001).parse(process.env.PORT);
const app = createApp(env);

app.listen(port, () => {
  console.log(`auth service listening on port ${port}`);
});
```

- [ ] **Step 8: Run the tests, verify health and `/auth/me` tests pass**

Run: `npm run test --workspace=services/auth`
Expected: `health.test.ts` and `me.test.ts` PASS. (`prisma.user.findUnique`/`upsert` require a running Postgres from Task 1 with the migration applied — if the DB isn't reachable, these two `/auth/me` cases will fail with a connection error rather than the expected 401s; ensure `docker compose up -d postgres` and the Task 1 migration have run first.)

- [ ] **Step 9: Write the guarded end-to-end integration test**

```ts
// services/auth/test/singpassFlow.test.ts
import axios from "axios";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { testEnv } from "./fixtures/testEnv.js";

let mockpassReachable = false;

beforeAll(async () => {
  try {
    await axios.get(testEnv.SINGPASS_OIDC_CONFIG_URL, { timeout: 2000 });
    mockpassReachable = true;
  } catch {
    mockpassReachable = false;
    console.warn("mockpass not reachable at " + testEnv.SINGPASS_OIDC_CONFIG_URL + " -- skipping singpassFlow integration test");
  }
});

describe("Singpass login -> callback round trip", () => {
  it("issues a session token for a mockpass login", async () => {
    if (!mockpassReachable) {
      return;
    }

    const app = createApp(testEnv);
    const loginResponse = await request(app).get("/auth/singpass/login");
    expect(loginResponse.status).toBe(302);

    const authorizeUrl = new URL(loginResponse.headers.location);
    const authorizeResponse = await axios.get(authorizeUrl.toString(), {
      maxRedirects: 0,
      validateStatus: (status) => status === 302,
    });
    const callbackUrl = new URL(authorizeResponse.headers.location);

    const callbackResponse = await request(app).get(
      "/auth/singpass/callback" + callbackUrl.search,
    );
    expect(callbackResponse.status).toBe(200);
    expect(callbackResponse.body.accessToken).toBeTypeOf("string");
    expect(callbackResponse.body.user.id).toBeTypeOf("string");
  });
});
```

- [ ] **Step 10: Install the test-only `axios` dependency and run the full suite**

Run: `npm install -D axios@^1.7.0 --workspace=services/auth`
Run: `docker compose up -d mockpass postgres` then `npm run test --workspace=services/auth`
Expected: all tests PASS; the integration test either exercises the real round trip against mockpass or prints the skip warning and passes trivially if mockpass/Docker isn't available in this environment.

- [ ] **Step 11: Commit**

```bash
git add services/auth/package.json services/auth/src/app.ts services/auth/src/index.ts
git add services/auth/src/routes services/auth/test package-lock.json
git commit -m "feat(auth): wire Singpass login/callback/me routes"
```

---

## Task 9: Full workspace verification

**Files:** none (verification only)

**Interfaces:** none — confirms Tasks 1-8 compose correctly and the rest of the monorepo (Phase 0's other packages) is unaffected.

- [ ] **Step 1: Start local infra**

Run: `docker compose up -d postgres redis rabbitmq mockpass`
Expected: all four containers running. If Docker isn't available, skip Steps 1 and 4 (DB/mockpass-dependent checks) and note that in the task result.

- [ ] **Step 2: Build every package from the root**

Run: `npm run build --workspaces --if-present`
Expected: exits 0.

- [ ] **Step 3: Test every package from the root**

Run: `npm run test --workspaces --if-present`
Expected: exits 0; `services/auth` now reports 1 (health) + 2 (env) + 2 (jwt) + 3 (stateStore) + 3 (requireAuth) + 1 (singpassClient) + 2 (me) + 1 (singpassFlow) = 15 tests passing, alongside the unchanged Phase 0 suites in `packages/shared`, `services/matching`, `services/chat`, `apps/mobile`.

- [ ] **Step 4: Manually verify the full login flow against a running service**

Run: `npm run dev --workspace=services/auth`
In another terminal: `curl -i http://localhost:4001/auth/singpass/login`
Expected: `302` with a `Location` header pointing at `http://localhost:5156/singpass/v2/auth?...`. Stop the dev server once confirmed.

- [ ] **Step 5: Confirm a clean working tree**

Run: `git status`
Expected: `nothing to commit, working tree clean` (everything from Tasks 1-8 was already committed per-task).

- [ ] **Step 6: Commit (only if Steps 2 or 3 touched anything, e.g. lockfile drift)**

```bash
git add -A
git commit -m "chore: verify Phase 1 auth service end-to-end"
```

If Step 5 was already clean, skip this step.
