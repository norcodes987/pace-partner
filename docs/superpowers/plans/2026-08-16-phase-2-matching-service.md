# Phase 2: Matching Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `services/matching` — runner profiles (pace + MRT stations), candidate discovery filtered by the compatibility rule, and mutual-accept match creation.

**Architecture:** Express router-per-resource inside `services/matching`, mirroring `services/auth`'s established shape (`env.ts` loads a zod-validated env, `app.ts` wires routers, each route file is a `createXRouter(env)` factory that grabs the shared Prisma client). Session-JWT verification is extracted from `services/auth` into `packages/shared` first, so both services use one implementation. Three new Prisma models (`RunnerProfile`, `Swipe`, `Match`) are added to the single shared schema, plus a canonical MRT station list used for input validation.

**Tech Stack:** TypeScript strict mode, Express 4, Prisma 5 (Postgres), zod, Vitest + Supertest, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-16-phase-2-matching-service-design.md`

## Global Constraints

- TypeScript strict mode; no `any` without justification (CLAUDE.md rule 1).
- Only `services/matching` and the parts of `packages/shared` it depends on may change (CLAUDE.md rule 2) — this plan also touches `services/auth` only for the mechanical JWT-verification relocation described in the spec's "Cross-Service Auth Refactor" section, not its Singpass logic.
- All DB access through Prisma, no raw SQL outside migration files (CLAUDE.md rule 3).
- All external input validated with zod (CLAUDE.md rule 4).
- Compatibility rule: pace within 30s/km **and** at least one shared selected MRT station (CLAUDE.md "Key Decisions").
- Do not touch `docker-compose.yml`, `.env`, `infra/`, CI config without asking first (CLAUDE.md rule 6).
- Every task's tests are run against the local Postgres started by `docker-compose.yml` (`postgres` service, `pace_partner` database) — start it with `docker compose up -d postgres` before running any task's tests if it isn't already running. This plan does not modify `docker-compose.yml`.

---

## File Structure

```
packages/shared/src/
  auth/
    verifyJwt.ts        # moved from services/auth/src/jwt.ts (verify half only)
    requireAuth.ts       # moved from services/auth/src/middleware/requireAuth.ts
  mrtStations.ts          # new: canonical MRT_STATIONS list + zod schema
  index.ts                 # extended with the above exports
  env.ts, prisma.ts        # unchanged
packages/shared/prisma/
  schema.prisma             # + RunnerProfile, Swipe, Match, SwipeDecision
  migrations/<ts>_add_matching_models/migration.sql

services/auth/src/
  jwt.ts                    # trimmed to sign-only
  routes/singpassAuth.ts    # imports requireAuth/AuthedRequest from @pace-partner/shared
  middleware/requireAuth.ts # deleted

services/matching/src/
  env.ts                    # new: MatchingEnv (adds JWT_SECRET requirement)
  app.ts                     # extended: express.json(), mounts matching router behind requireAuth
  index.ts                   # extended: loads MatchingEnv, passes to createApp
  routes/
    profile.ts                # PUT/GET /matching/profile
    candidates.ts             # GET /matching/candidates, POST /matching/candidates/:userId/swipe
    matches.ts                 # GET /matching/matches
services/matching/test/
  fixtures/testEnv.ts
  helpers/testUser.ts         # creates a real User row (FK target) + signs a test JWT
  health.test.ts               # updated for new createApp(env) signature
  profile.test.ts
  candidates.test.ts
  matches.test.ts
  matchFlow.test.ts             # full round-trip integration test
```

---

## Task 1: Move JWT verification and `requireAuth` middleware into `packages/shared`

**Files:**
- Create: `packages/shared/src/auth/verifyJwt.ts`
- Create: `packages/shared/src/auth/requireAuth.ts`
- Create: `packages/shared/test/auth/verifyJwt.test.ts`
- Create: `packages/shared/test/auth/requireAuth.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`
- Modify: `services/auth/src/jwt.ts`
- Modify: `services/auth/src/routes/singpassAuth.ts:7`
- Modify: `services/auth/test/jwt.test.ts`
- Delete: `services/auth/src/middleware/requireAuth.ts`
- Delete: `services/auth/test/requireAuth.test.ts`

**Interfaces:**
- Produces: `verifySessionToken(token: string, secret: string): SessionTokenPayload` (`SessionTokenPayload = { sub: string }`), `requireAuth(secret: string): RequestHandler`, `AuthedRequest extends Request { userId?: string }` — all exported from `@pace-partner/shared`. Every later task imports `requireAuth` and `AuthedRequest` from `@pace-partner/shared`, never re-implements them.

- [ ] **Step 1: Add `jsonwebtoken` and `express` to `packages/shared`'s dependencies**

Edit `packages/shared/package.json` — add to `"dependencies"`:

```json
"jsonwebtoken": "^9.0.3",
```

Add to `"devDependencies"`:

```json
"@types/express": "^4.17.25",
"@types/jsonwebtoken": "^9.0.10",
"express": "^4.22.2",
```

(`express` is a devDependency here — `packages/shared` only needs its `RequestHandler`/`Request` **types**, and every consumer of `requireAuth` already depends on `express` itself at runtime.)

- [ ] **Step 2: Write the failing test for `verifySessionToken`**

Create `packages/shared/test/auth/verifyJwt.test.ts`:

```ts
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { verifySessionToken } from "../../src/auth/verifyJwt.js";

describe("verifySessionToken", () => {
  it("round-trips a user id from a validly signed token", () => {
    const token = jwt.sign({ sub: "user-123" }, "test-secret", { expiresIn: "1h" });
    const payload = verifySessionToken(token, "test-secret");
    expect(payload.sub).toBe("user-123");
  });

  it("rejects a token signed with a different secret", () => {
    const token = jwt.sign({ sub: "user-123" }, "test-secret", { expiresIn: "1h" });
    expect(() => verifySessionToken(token, "wrong-secret")).toThrow();
  });

  it("rejects a token with no sub claim", () => {
    const token = jwt.sign({}, "test-secret", { expiresIn: "1h" });
    expect(() => verifySessionToken(token, "test-secret")).toThrow();
  });
});
```

- [ ] **Step 2b: Run it to confirm it fails**

Run: `npm run test --workspace=packages/shared`
Expected: FAIL — `Cannot find module '../../src/auth/verifyJwt.js'`

- [ ] **Step 3: Implement `verifySessionToken`**

Create `packages/shared/src/auth/verifyJwt.ts` (moved from `services/auth/src/jwt.ts`, verify half only):

```ts
import jwt from "jsonwebtoken";

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

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm run test --workspace=packages/shared`
Expected: PASS (3 tests in `verifyJwt.test.ts`)

- [ ] **Step 5: Write the failing test for `requireAuth`**

Create `packages/shared/test/auth/requireAuth.test.ts`:

```ts
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requireAuth, type AuthedRequest } from "../../src/auth/requireAuth.js";

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
    const token = jwt.sign({ sub: "user-123" }, "test-secret", { expiresIn: "1h" });
    const response = await request(buildTestApp("test-secret"))
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: "user-123" });
  });
});
```

- [ ] **Step 5b: Run it to confirm it fails**

Run: `npm run test --workspace=packages/shared`
Expected: FAIL — `Cannot find module '../../src/auth/requireAuth.js'`

- [ ] **Step 6: Implement `requireAuth`**

Create `packages/shared/src/auth/requireAuth.ts` (moved from `services/auth/src/middleware/requireAuth.ts`):

```ts
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifySessionToken } from "./verifyJwt.js";

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

- [ ] **Step 7: Run it to confirm it passes**

Run: `npm run test --workspace=packages/shared`
Expected: PASS (all `packages/shared` tests, including the 3 new ones)

- [ ] **Step 8: Export the new modules from `packages/shared`**

Replace the contents of `packages/shared/src/index.ts`:

```ts
export { loadEnv } from "./env.js";
export type { Env } from "./env.js";
export { getPrisma } from "./prisma.js";
export { verifySessionToken } from "./auth/verifyJwt.js";
export type { SessionTokenPayload } from "./auth/verifyJwt.js";
export { requireAuth } from "./auth/requireAuth.js";
export type { AuthedRequest } from "./auth/requireAuth.js";
```

- [ ] **Step 9: Build `packages/shared` to confirm the new exports compile**

Run: `npm run build --workspace=packages/shared`
Expected: exit code 0

- [ ] **Step 10: Trim `services/auth/src/jwt.ts` to sign-only**

Replace the contents of `services/auth/src/jwt.ts`:

```ts
import jwt from "jsonwebtoken";

const SESSION_TOKEN_EXPIRY = "1h";

export function signSessionToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: SESSION_TOKEN_EXPIRY });
}
```

- [ ] **Step 11: Delete the now-duplicated auth files**

```bash
rm services/auth/src/middleware/requireAuth.ts
rm services/auth/test/requireAuth.test.ts
rmdir services/auth/src/middleware
```

- [ ] **Step 12: Update `services/auth/test/jwt.test.ts` to test sign-only, verifying via shared**

Replace the contents of `services/auth/test/jwt.test.ts`:

```ts
import { verifySessionToken } from "@pace-partner/shared";
import { describe, expect, it } from "vitest";
import { signSessionToken } from "../src/jwt.js";

describe("signSessionToken", () => {
  it("produces a token that verifySessionToken accepts and round-trips the user id", () => {
    const token = signSessionToken("user-123", "test-secret");
    const payload = verifySessionToken(token, "test-secret");
    expect(payload.sub).toBe("user-123");
  });
});
```

- [ ] **Step 13: Update `services/auth/src/routes/singpassAuth.ts`'s import**

In `services/auth/src/routes/singpassAuth.ts`, replace line 7:

```ts
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
```

with:

```ts
import { requireAuth, type AuthedRequest } from "@pace-partner/shared";
```

- [ ] **Step 14: Rebuild and re-run the full `services/auth` suite**

Run: `npm run build --workspace=services/auth && npm run test --workspace=services/auth`
Expected: all tests pass (the pre-existing `me.test.ts` "returns 401 for a user that no longer exists" test requires Postgres reachable at `localhost:5432` — start it first if needed: `docker compose up -d postgres`)

- [ ] **Step 15: Commit**

```bash
git add packages/shared services/auth
git commit -m "refactor(shared): move JWT verification and requireAuth into packages/shared"
```

---

## Task 2: Extend the Prisma schema with matching models and the MRT station list

**Files:**
- Modify: `packages/shared/prisma/schema.prisma`
- Create: `packages/shared/prisma/migrations/<timestamp>_add_matching_models/migration.sql` (generated by Prisma, not hand-written)
- Create: `packages/shared/src/mrtStations.ts`
- Create: `packages/shared/test/mrtStations.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: none (foundational for Tasks 4-7).
- Produces: Prisma models `RunnerProfile { id, userId, paceSecondsPerKm: number, mrtStations: string[], createdAt, updatedAt }`, `Swipe { id, userId, targetUserId, decision: "ACCEPT"|"PASS", createdAt }` (unique on `[userId, targetUserId]`, Prisma unique-input key `userId_targetUserId`), `Match { id, userAId, userBId, createdAt }` (unique on `[userAId, userBId]`, Prisma unique-input key `userAId_userBId`). `MRT_STATIONS: readonly string[]` and `mrtStationSchema: z.ZodEnum<...>` exported from `@pace-partner/shared`.

- [ ] **Step 1: Write the failing test for the MRT station list**

Create `packages/shared/test/mrtStations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MRT_STATIONS, mrtStationSchema } from "../src/mrtStations.js";

describe("mrtStationSchema", () => {
  it("accepts a known station", () => {
    expect(mrtStationSchema.parse("Bishan")).toBe("Bishan");
  });

  it("rejects an unknown station", () => {
    expect(() => mrtStationSchema.parse("Not A Real Station")).toThrow();
  });

  it("contains no duplicates", () => {
    expect(new Set(MRT_STATIONS).size).toBe(MRT_STATIONS.length);
  });
});
```

- [ ] **Step 1b: Run it to confirm it fails**

Run: `npm run test --workspace=packages/shared`
Expected: FAIL — `Cannot find module '../src/mrtStations.js'`

- [ ] **Step 2: Implement the canonical MRT station list**

Create `packages/shared/src/mrtStations.ts`:

```ts
import { z } from "zod";

export const MRT_STATIONS = [
  "Admiralty", "Aljunied", "Ang Mo Kio", "Bakau", "Bangkit", "Bartley", "Bayfront",
  "Bayshore", "Beauty World", "Bedok", "Bedok North", "Bedok Reservoir", "Bedok South",
  "Bencoolen", "Bendemeer", "Bishan", "Boon Keng", "Boon Lay", "Botanic Gardens",
  "Braddell", "Bras Basah", "Bright Hill", "Buangkok", "Bugis", "Bukit Batok",
  "Bukit Gombak", "Bukit Panjang", "Buona Vista", "Caldecott", "Cashew",
  "Changi Airport", "Cheng Lim", "Chinatown", "Chinese Garden", "Choa Chu Kang",
  "City Hall", "Clarke Quay", "Clementi", "Compassvale", "Coral Edge", "Cove",
  "Dakota", "Damai", "Dhoby Ghaut", "Downtown", "Dover", "Esplanade", "Eunos",
  "Expo", "Fajar", "Farmway", "Farrer Park", "Farrer Road", "Fernvale",
  "Fort Canning", "Gardens by the Bay", "Geylang Bahru", "Great World",
  "Gul Circle", "HarbourFront", "Havelock", "Haw Par Villa", "Holland Village",
  "Hougang", "Jalan Besar", "Joo Koon", "Jurong East", "Kadaloor", "Kaki Bukit",
  "Kallang", "Kangkar", "Katong Park", "Keat Hong", "Kembangan", "Kent Ridge",
  "Khatib", "King Albert Park", "Kovan", "Kranji", "Kupang", "Labrador Park",
  "Lakeside", "Lavender", "Layar", "Lentor", "Little India", "Lorong Chuan",
  "MacPherson", "Marina Bay", "Marina South Pier", "Marine Parade",
  "Marine Terrace", "Marsiling", "Marymount", "Mattar", "Maxwell", "Mayflower",
  "Meridian", "Mountbatten", "Napier", "Newton", "Nibong", "Nicoll Highway",
  "Novena", "Oasis", "one-north", "Orchard", "Orchard Boulevard", "Outram Park",
  "Pasir Panjang", "Pasir Ris", "Paya Lebar", "Pending", "Petir", "Phoenix",
  "Pioneer", "Potong Pasir", "Promenade", "Punggol", "Punggol Point",
  "Queenstown", "Raffles Place", "Ranggung", "Redhill", "Renjong", "Riviera",
  "Rochor", "Rumbia", "Sam Kee", "Samudera", "Segar", "Sembawang", "Sengkang",
  "Senja", "Serangoon", "Shenton Way", "Siglap", "Simei", "Sixth Avenue",
  "Somerset", "Soo Teck", "South View", "Springleaf", "Stadium", "Stevens",
  "Sumang", "Sungei Bedok", "Tai Seng", "Tampines", "Tampines East",
  "Tampines West", "Tan Kah Kee", "Tanah Merah", "Tanjong Katong",
  "Tanjong Pagar", "Tanjong Rhu", "Teck Lee", "Teck Whye", "Telok Ayer",
  "Telok Blangah", "Thanggam", "Tiong Bahru", "Toa Payoh", "Tongkang",
  "Tuas Crescent", "Tuas Link", "Tuas West Road", "Ubi", "Upper Changi",
  "Upper Thomson", "Woodlands", "Woodlands North", "Woodlands South",
  "Yew Tee", "Yio Chu Kang", "Yishun",
] as const;

export const mrtStationSchema = z.enum(MRT_STATIONS);
export type MrtStation = z.infer<typeof mrtStationSchema>;
```

Note for whoever reviews this: this list is compiled from public knowledge of the Singapore MRT/LRT network and is meant to be comprehensive, but isn't guaranteed to be pixel-perfect against LTA's current official station list — flag any missing/renamed station and it's a one-line addition to this array, not a schema change.

- [ ] **Step 3: Run it to confirm it passes**

Run: `npm run test --workspace=packages/shared`
Expected: PASS

- [ ] **Step 4: Export the new module from `packages/shared`**

Add to `packages/shared/src/index.ts`:

```ts
export { MRT_STATIONS, mrtStationSchema } from "./mrtStations.js";
export type { MrtStation } from "./mrtStations.js";
```

- [ ] **Step 5: Add the matching models to the Prisma schema**

Replace the contents of `packages/shared/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id             String          @id @default(uuid())
  singpassSub    String          @unique
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  runnerProfile  RunnerProfile?
  swipesGiven    Swipe[]         @relation("SwipeInitiator")
  swipesReceived Swipe[]         @relation("SwipeTarget")
  matchesAsA     Match[]         @relation("MatchUserA")
  matchesAsB     Match[]         @relation("MatchUserB")
}

model RunnerProfile {
  id               String   @id @default(uuid())
  userId           String   @unique
  user             User     @relation(fields: [userId], references: [id])
  paceSecondsPerKm Int
  mrtStations      String[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

enum SwipeDecision {
  ACCEPT
  PASS
}

model Swipe {
  id           String        @id @default(uuid())
  userId       String
  user         User          @relation("SwipeInitiator", fields: [userId], references: [id])
  targetUserId String
  target       User          @relation("SwipeTarget", fields: [targetUserId], references: [id])
  decision     SwipeDecision
  createdAt    DateTime      @default(now())

  @@unique([userId, targetUserId])
}

model Match {
  id        String   @id @default(uuid())
  userAId   String
  userA     User     @relation("MatchUserA", fields: [userAId], references: [id])
  userBId   String
  userB     User     @relation("MatchUserB", fields: [userBId], references: [id])
  createdAt DateTime @default(now())

  @@unique([userAId, userBId])
}
```

- [ ] **Step 6: Generate and apply the migration**

Requires Postgres reachable — start it first if needed: `docker compose up -d postgres`

Run (from `packages/shared`):

```bash
cd packages/shared
npx prisma migrate dev --name add_matching_models
cd ../..
```

Expected: a new `packages/shared/prisma/migrations/<timestamp>_add_matching_models/migration.sql` is generated and applied; command exits 0.

- [ ] **Step 7: Regenerate the Prisma client and rebuild**

Run: `npm run build --workspace=packages/shared`
Expected: exit code 0 (this also runs `prisma generate` via the `postinstall`/`generate` script picking up the new models — if the generated client doesn't reflect the new models, run `npm run generate --workspace=packages/shared` explicitly first)

- [ ] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add RunnerProfile, Swipe, and Match models plus canonical MRT station list"
```

---

## Task 3: Scaffold `services/matching`'s env loader and app wiring

**Files:**
- Create: `services/matching/src/env.ts`
- Create: `services/matching/test/fixtures/testEnv.ts`
- Modify: `services/matching/src/app.ts`
- Modify: `services/matching/src/index.ts`
- Modify: `services/matching/test/health.test.ts`
- Modify: `services/matching/package.json`

**Interfaces:**
- Consumes: `requireAuth` from `@pace-partner/shared` (Task 1).
- Produces: `MatchingEnv = Env & { JWT_SECRET: string }`, `loadMatchingEnv(source?): MatchingEnv`, `createApp(env: MatchingEnv): Express` with `/health` public and everything under `/matching` behind `requireAuth`. Tasks 4-7 import `MatchingEnv` from `../env.js` and mount their routers via `app.use("/matching", ...)`-equivalent composition inside `app.ts`.

- [ ] **Step 1: Write the failing test for `loadMatchingEnv`**

Create `services/matching/test/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadMatchingEnv } from "../src/env.js";

const validEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  JWT_SECRET: "test-secret",
};

describe("loadMatchingEnv", () => {
  it("parses a valid environment", () => {
    const env = loadMatchingEnv(validEnv);
    expect(env.JWT_SECRET).toBe("test-secret");
  });

  it("throws a specific error when JWT_SECRET is missing", () => {
    const { JWT_SECRET: _unused, ...rest } = validEnv;
    expect(() => loadMatchingEnv(rest)).toThrowError(/Invalid environment configuration/);
  });
});
```

- [ ] **Step 1b: Run it to confirm it fails**

Run: `npm run test --workspace=services/matching`
Expected: FAIL — `Cannot find module '../src/env.js'`

- [ ] **Step 2: Implement `loadMatchingEnv`**

Create `services/matching/src/env.ts`:

```ts
import { z } from "zod";
import { loadEnv, type Env } from "@pace-partner/shared";

const matchingEnvSchema = z.object({
  JWT_SECRET: z.string().min(1),
});

export type MatchingEnv = Env & z.infer<typeof matchingEnvSchema>;

export function loadMatchingEnv(source: NodeJS.ProcessEnv = process.env): MatchingEnv {
  const shared = loadEnv(source);
  const result = matchingEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return { ...shared, ...result.data };
}
```

- [ ] **Step 3: Run it to confirm it passes**

Run: `npm run test --workspace=services/matching`
Expected: PASS (`env.test.ts`); `health.test.ts` still fails/errors at this point since `createApp()` doesn't take an env yet — that's expected, fixed in Step 5.

- [ ] **Step 4: Create the test env fixture**

Create `services/matching/test/fixtures/testEnv.ts`:

```ts
import type { MatchingEnv } from "../../src/env.js";

export const testEnv: MatchingEnv = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/pace_partner",
  REDIS_URL: "redis://localhost:6379",
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  JWT_SECRET: "test-secret",
};
```

- [ ] **Step 5: Update `app.ts` to accept `MatchingEnv` and require auth on `/matching`**

Replace the contents of `services/matching/src/app.ts`:

```ts
import express, { Router, type Express } from "express";
import { requireAuth } from "@pace-partner/shared";
import type { MatchingEnv } from "./env.js";

export function createApp(env: MatchingEnv): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "matching" });
  });

  const matchingRouter = Router();
  matchingRouter.use(requireAuth(env.JWT_SECRET));
  app.use("/matching", matchingRouter);

  return app;
}
```

(Tasks 4-7 each add one `matchingRouter.use(createXRouter(env));` line here.)

- [ ] **Step 6: Update `health.test.ts` for the new `createApp(env)` signature**

Replace the contents of `services/matching/test/health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { testEnv } from "./fixtures/testEnv.js";

describe("GET /health", () => {
  it("returns ok status with the service name", async () => {
    const app = createApp(testEnv);
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "matching" });
  });
});
```

- [ ] **Step 7: Update `index.ts` to load `MatchingEnv` and pass it to `createApp`**

Replace the contents of `services/matching/src/index.ts`:

```ts
import { z } from "zod";
import { createApp } from "./app.js";
import { loadMatchingEnv } from "./env.js";

const env = loadMatchingEnv(process.env);
const port = z.coerce
  .number()
  .int()
  .positive()
  .default(4002)
  .parse(process.env.MATCHING_PORT ?? process.env.PORT);
const app = createApp(env);

app.listen(port, () => {
  console.log(`matching service listening on port ${port}`);
});
```

- [ ] **Step 8: Add `jsonwebtoken` as a devDependency (for signing test tokens)**

Edit `services/matching/package.json` — add to `"devDependencies"`:

```json
"@types/jsonwebtoken": "^9.0.10",
"jsonwebtoken": "^9.0.3",
```

Run: `npm install`

- [ ] **Step 9: Run the full `services/matching` suite to confirm it passes**

Run: `npm run build --workspace=services/matching && npm run test --workspace=services/matching`
Expected: PASS (`env.test.ts`, `health.test.ts`)

- [ ] **Step 10: Commit**

```bash
git add services/matching
git commit -m "feat(matching): add env loader, require auth on /matching, update health test"
```

---

## Task 4: `PUT /matching/profile` and `GET /matching/profile`

**Files:**
- Create: `services/matching/src/routes/profile.ts`
- Create: `services/matching/test/helpers/testUser.ts`
- Create: `services/matching/test/profile.test.ts`
- Modify: `services/matching/src/app.ts`

**Interfaces:**
- Consumes: `MatchingEnv` (Task 3), `AuthedRequest` + `getPrisma` + `mrtStationSchema` from `@pace-partner/shared` (Tasks 1-2).
- Produces: `createProfileRouter(env: MatchingEnv): Router`. Later tasks reuse the `createTestUser`/`signTestToken` helpers created here.

- [ ] **Step 1: Create the shared test helper for a real `User` row + signed token**

Create `services/matching/test/helpers/testUser.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import jwt from "jsonwebtoken";

export async function createTestUser(prisma: PrismaClient): Promise<User> {
  return prisma.user.create({ data: { singpassSub: randomUUID() } });
}

export function signTestToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "1h" });
}
```

- [ ] **Step 2: Write the failing tests for the profile routes**

Create `services/matching/test/profile.test.ts`:

```ts
import { getPrisma } from "@pace-partner/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { testEnv } from "./fixtures/testEnv.js";
import { createTestUser, signTestToken } from "./helpers/testUser.js";

const prisma = getPrisma(testEnv.DATABASE_URL);
const app = createApp(testEnv);

describe("PUT /matching/profile", () => {
  it("returns 401 without a token", async () => {
    const response = await request(app)
      .put("/matching/profile")
      .send({ paceSecondsPerKm: 330, mrtStations: ["Bishan"] });
    expect(response.status).toBe(401);
  });

  it("returns 400 for an unknown MRT station", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const response = await request(app)
      .put("/matching/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ paceSecondsPerKm: 330, mrtStations: ["Not A Real Station"] });
    expect(response.status).toBe(400);
  });

  it("returns 400 for a pace outside the valid range", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const response = await request(app)
      .put("/matching/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ paceSecondsPerKm: 60, mrtStations: ["Bishan"] });
    expect(response.status).toBe(400);
  });

  it("creates and returns the profile on valid input", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const response = await request(app)
      .put("/matching/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ paceSecondsPerKm: 330, mrtStations: ["Bishan", "Toa Payoh"] });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      userId: user.id,
      paceSecondsPerKm: 330,
      mrtStations: ["Bishan", "Toa Payoh"],
    });
  });

  it("updates an existing profile on a second call", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    await request(app)
      .put("/matching/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ paceSecondsPerKm: 330, mrtStations: ["Bishan"] });
    const response = await request(app)
      .put("/matching/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ paceSecondsPerKm: 300, mrtStations: ["Novena"] });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ paceSecondsPerKm: 300, mrtStations: ["Novena"] });
  });
});

describe("GET /matching/profile", () => {
  it("returns 404 when the caller has no profile", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const response = await request(app).get("/matching/profile").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(404);
  });

  it("returns the caller's profile after it's been set", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    await request(app)
      .put("/matching/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ paceSecondsPerKm: 330, mrtStations: ["Bishan"] });
    const response = await request(app).get("/matching/profile").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ paceSecondsPerKm: 330, mrtStations: ["Bishan"] });
  });
});
```

- [ ] **Step 2b: Run it to confirm it fails**

Run: `docker compose up -d postgres && npm run test --workspace=services/matching`
Expected: FAIL — `Cannot find module '../src/routes/profile.js'` (and/or `helpers/testUser.js` unresolved)

- [ ] **Step 3: Implement the profile router**

Create `services/matching/src/routes/profile.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { getPrisma, mrtStationSchema, type AuthedRequest } from "@pace-partner/shared";
import type { MatchingEnv } from "../env.js";

const MIN_PACE_SECONDS_PER_KM = 180;
const MAX_PACE_SECONDS_PER_KM = 900;

const profileBodySchema = z.object({
  paceSecondsPerKm: z.number().int().min(MIN_PACE_SECONDS_PER_KM).max(MAX_PACE_SECONDS_PER_KM),
  mrtStations: z.array(mrtStationSchema).nonempty(),
});

export function createProfileRouter(env: MatchingEnv): Router {
  const router = Router();
  const prisma = getPrisma(env.DATABASE_URL);

  router.put("/profile", async (req: AuthedRequest, res) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    const parseResult = profileBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid profile data" });
      return;
    }
    const { paceSecondsPerKm, mrtStations } = parseResult.data;

    try {
      const profile = await prisma.runnerProfile.upsert({
        where: { userId },
        create: { userId, paceSecondsPerKm, mrtStations },
        update: { paceSecondsPerKm, mrtStations },
      });
      res.json(profile);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.get("/profile", async (req: AuthedRequest, res) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    try {
      const profile = await prisma.runnerProfile.findUnique({ where: { userId } });
      if (!profile) {
        res.status(404).json({ error: "Profile not found" });
        return;
      }
      res.json(profile);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}
```

- [ ] **Step 4: Mount the profile router in `app.ts`**

In `services/matching/src/app.ts`, add the import:

```ts
import { createProfileRouter } from "./routes/profile.js";
```

and add, right after `matchingRouter.use(requireAuth(env.JWT_SECRET));`:

```ts
  matchingRouter.use(createProfileRouter(env));
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npm run test --workspace=services/matching`
Expected: PASS (all `profile.test.ts` cases)

- [ ] **Step 6: Commit**

```bash
git add services/matching
git commit -m "feat(matching): add PUT/GET /matching/profile"
```

---

## Task 5: `GET /matching/candidates`

**Files:**
- Create: `services/matching/src/routes/candidates.ts`
- Create: `services/matching/test/candidates.test.ts`
- Modify: `services/matching/src/app.ts`

**Interfaces:**
- Consumes: `createTestUser`/`signTestToken` (Task 4), `MatchingEnv`, `mrtStationSchema`/`getPrisma`/`AuthedRequest` from `@pace-partner/shared`.
- Produces: `createCandidatesRouter(env: MatchingEnv): Router` exposing `GET /candidates` (mounted under `/matching`). The `POST /candidates/:userId/swipe` route is added to this same router in Task 6 — this task only adds `GET /candidates`.

- [ ] **Step 1: Write the failing tests for candidate discovery**

Create `services/matching/test/candidates.test.ts`:

```ts
import { getPrisma } from "@pace-partner/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { testEnv } from "./fixtures/testEnv.js";
import { createTestUser, signTestToken } from "./helpers/testUser.js";

const prisma = getPrisma(testEnv.DATABASE_URL);
const app = createApp(testEnv);

async function setProfile(token: string, paceSecondsPerKm: number, mrtStations: string[]) {
  await request(app)
    .put("/matching/profile")
    .set("Authorization", `Bearer ${token}`)
    .send({ paceSecondsPerKm, mrtStations });
}

describe("GET /matching/candidates", () => {
  it("returns 401 without a token", async () => {
    const response = await request(app).get("/matching/candidates");
    expect(response.status).toBe(401);
  });

  it("returns 400 when the caller has no profile", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const response = await request(app).get("/matching/candidates").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(400);
  });

  it("includes a candidate within pace tolerance sharing a station", async () => {
    const caller = await createTestUser(prisma);
    const callerToken = signTestToken(caller.id, testEnv.JWT_SECRET);
    await setProfile(callerToken, 330, ["Bishan"]);

    const compatible = await createTestUser(prisma);
    const compatibleToken = signTestToken(compatible.id, testEnv.JWT_SECRET);
    await setProfile(compatibleToken, 350, ["Bishan", "Novena"]);

    const response = await request(app)
      .get("/matching/candidates")
      .set("Authorization", `Bearer ${callerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.map((c: { userId: string }) => c.userId)).toContain(compatible.id);
  });

  it("excludes a candidate outside pace tolerance", async () => {
    const caller = await createTestUser(prisma);
    const callerToken = signTestToken(caller.id, testEnv.JWT_SECRET);
    await setProfile(callerToken, 330, ["Bishan"]);

    const tooSlow = await createTestUser(prisma);
    const tooSlowToken = signTestToken(tooSlow.id, testEnv.JWT_SECRET);
    await setProfile(tooSlowToken, 400, ["Bishan"]);

    const response = await request(app)
      .get("/matching/candidates")
      .set("Authorization", `Bearer ${callerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.map((c: { userId: string }) => c.userId)).not.toContain(tooSlow.id);
  });

  it("excludes a candidate with no shared station", async () => {
    const caller = await createTestUser(prisma);
    const callerToken = signTestToken(caller.id, testEnv.JWT_SECRET);
    await setProfile(callerToken, 330, ["Bishan"]);

    const noOverlap = await createTestUser(prisma);
    const noOverlapToken = signTestToken(noOverlap.id, testEnv.JWT_SECRET);
    await setProfile(noOverlapToken, 330, ["Yishun"]);

    const response = await request(app)
      .get("/matching/candidates")
      .set("Authorization", `Bearer ${callerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.map((c: { userId: string }) => c.userId)).not.toContain(noOverlap.id);
  });

  it("excludes the caller from their own candidate list", async () => {
    const caller = await createTestUser(prisma);
    const callerToken = signTestToken(caller.id, testEnv.JWT_SECRET);
    await setProfile(callerToken, 330, ["Bishan"]);

    const response = await request(app)
      .get("/matching/candidates")
      .set("Authorization", `Bearer ${callerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.map((c: { userId: string }) => c.userId)).not.toContain(caller.id);
  });
});
```

- [ ] **Step 1b: Run it to confirm it fails**

Run: `npm run test --workspace=services/matching`
Expected: FAIL — `Cannot find module '../src/routes/candidates.js'`

- [ ] **Step 2: Implement the candidates router (GET only)**

Create `services/matching/src/routes/candidates.ts`:

```ts
import { Router } from "express";
import { getPrisma, type AuthedRequest } from "@pace-partner/shared";
import type { MatchingEnv } from "../env.js";

const PACE_TOLERANCE_SECONDS = 30;
const CANDIDATE_LIMIT = 50;

export function createCandidatesRouter(env: MatchingEnv): Router {
  const router = Router();
  const prisma = getPrisma(env.DATABASE_URL);

  router.get("/candidates", async (req: AuthedRequest, res) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    try {
      const ownProfile = await prisma.runnerProfile.findUnique({ where: { userId } });
      if (!ownProfile) {
        res.status(400).json({ error: "Complete your profile before browsing candidates" });
        return;
      }

      const alreadySwiped = await prisma.swipe.findMany({
        where: { userId },
        select: { targetUserId: true },
      });
      const excludedUserIds = [userId, ...alreadySwiped.map((swipe) => swipe.targetUserId)];

      const candidates = await prisma.runnerProfile.findMany({
        where: {
          userId: { notIn: excludedUserIds },
          paceSecondsPerKm: {
            gte: ownProfile.paceSecondsPerKm - PACE_TOLERANCE_SECONDS,
            lte: ownProfile.paceSecondsPerKm + PACE_TOLERANCE_SECONDS,
          },
          mrtStations: { hasSome: ownProfile.mrtStations },
        },
        take: CANDIDATE_LIMIT,
      });

      res.json(
        candidates.map((candidate) => ({
          userId: candidate.userId,
          paceSecondsPerKm: candidate.paceSecondsPerKm,
          mrtStations: candidate.mrtStations,
        })),
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}
```

- [ ] **Step 3: Mount the candidates router in `app.ts`**

In `services/matching/src/app.ts`, add the import:

```ts
import { createCandidatesRouter } from "./routes/candidates.js";
```

and add, after `matchingRouter.use(createProfileRouter(env));`:

```ts
  matchingRouter.use(createCandidatesRouter(env));
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm run test --workspace=services/matching`
Expected: PASS (all `candidates.test.ts` cases)

- [ ] **Step 5: Commit**

```bash
git add services/matching
git commit -m "feat(matching): add GET /matching/candidates"
```

---

## Task 6: `POST /matching/candidates/:userId/swipe`

**Files:**
- Modify: `services/matching/src/routes/candidates.ts`
- Create: `services/matching/test/swipe.test.ts`

**Interfaces:**
- Consumes: everything from Task 5, plus the `Swipe`/`Match` Prisma models (Task 2).
- Produces: `POST /matching/candidates/:userId/swipe` returning `{ swipe, match }` (`match` is `null` unless this swipe completed a mutual accept). Task 7 depends on `Match` rows this route creates.

- [ ] **Step 1: Write the failing tests for swiping**

Create `services/matching/test/swipe.test.ts`:

```ts
import { getPrisma } from "@pace-partner/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { testEnv } from "./fixtures/testEnv.js";
import { createTestUser, signTestToken } from "./helpers/testUser.js";

const prisma = getPrisma(testEnv.DATABASE_URL);
const app = createApp(testEnv);

describe("POST /matching/candidates/:userId/swipe", () => {
  it("returns 401 without a token", async () => {
    const target = await createTestUser(prisma);
    const response = await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .send({ decision: "ACCEPT" });
    expect(response.status).toBe(401);
  });

  it("returns 400 when swiping on yourself", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const response = await request(app)
      .post(`/matching/candidates/${user.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "ACCEPT" });
    expect(response.status).toBe(400);
  });

  it("returns 400 for an unknown target user", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const response = await request(app)
      .post("/matching/candidates/nonexistent-user-id/swipe")
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "ACCEPT" });
    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid decision value", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const target = await createTestUser(prisma);
    const response = await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "MAYBE" });
    expect(response.status).toBe(400);
  });

  it("records a PASS with no match created", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const target = await createTestUser(prisma);
    const response = await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "PASS" });
    expect(response.status).toBe(201);
    expect(response.body.swipe).toMatchObject({ userId: user.id, targetUserId: target.id, decision: "PASS" });
    expect(response.body.match).toBeNull();
  });

  it("returns 409 when swiping on the same target twice", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const target = await createTestUser(prisma);
    await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "PASS" });
    const response = await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "ACCEPT" });
    expect(response.status).toBe(409);
  });

  it("creates no match on a one-sided ACCEPT", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const target = await createTestUser(prisma);
    const response = await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "ACCEPT" });
    expect(response.status).toBe(201);
    expect(response.body.match).toBeNull();
  });

  it("creates a match when both sides ACCEPT", async () => {
    const userA = await createTestUser(prisma);
    const tokenA = signTestToken(userA.id, testEnv.JWT_SECRET);
    const userB = await createTestUser(prisma);
    const tokenB = signTestToken(userB.id, testEnv.JWT_SECRET);

    await request(app)
      .post(`/matching/candidates/${userB.id}/swipe`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ decision: "ACCEPT" });

    const response = await request(app)
      .post(`/matching/candidates/${userA.id}/swipe`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ decision: "ACCEPT" });

    expect(response.status).toBe(201);
    expect(response.body.match).not.toBeNull();
    expect([userA.id, userB.id]).toContain(response.body.match.userAId);
    expect([userA.id, userB.id]).toContain(response.body.match.userBId);
  });
});
```

- [ ] **Step 1b: Run it to confirm it fails**

Run: `npm run test --workspace=services/matching`
Expected: FAIL — 404s from the nonexistent `/swipe` route

- [ ] **Step 2: Add the swipe route to `services/matching/src/routes/candidates.ts`**

In `services/matching/src/routes/candidates.ts`, add the `z` import at the top:

```ts
import { z } from "zod";
```

and add, inside `createCandidatesRouter`, after the `GET /candidates` handler and before `return router;`:

```ts
  const swipeBodySchema = z.object({
    decision: z.enum(["ACCEPT", "PASS"]),
  });

  router.post("/candidates/:userId/swipe", async (req: AuthedRequest, res) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    const targetUserId = req.params.userId;
    if (targetUserId === userId) {
      res.status(400).json({ error: "Cannot swipe on yourself" });
      return;
    }

    const parseResult = swipeBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid swipe decision" });
      return;
    }
    const { decision } = parseResult.data;

    try {
      const target = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        res.status(400).json({ error: "Unknown candidate" });
        return;
      }

      const existingSwipe = await prisma.swipe.findUnique({
        where: { userId_targetUserId: { userId, targetUserId } },
      });
      if (existingSwipe) {
        res.status(409).json({ error: "Already swiped on this candidate" });
        return;
      }

      const swipe = await prisma.swipe.create({ data: { userId, targetUserId, decision } });

      let match = null;
      if (decision === "ACCEPT") {
        const reciprocal = await prisma.swipe.findUnique({
          where: { userId_targetUserId: { userId: targetUserId, targetUserId: userId } },
        });
        if (reciprocal && reciprocal.decision === "ACCEPT") {
          const [userAId, userBId] = [userId, targetUserId].sort();
          match = await prisma.match.create({ data: { userAId, userBId } });
        }
      }

      res.status(201).json({ swipe, match });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  });
```

- [ ] **Step 3: Run the tests to confirm they pass**

Run: `npm run test --workspace=services/matching`
Expected: PASS (all `swipe.test.ts` cases)

- [ ] **Step 4: Commit**

```bash
git add services/matching
git commit -m "feat(matching): add POST /matching/candidates/:userId/swipe with mutual-match creation"
```

---

## Task 7: `GET /matching/matches`

**Files:**
- Create: `services/matching/src/routes/matches.ts`
- Create: `services/matching/test/matches.test.ts`
- Modify: `services/matching/src/app.ts`

**Interfaces:**
- Consumes: `Match` rows created by Task 6's swipe route.
- Produces: `createMatchesRouter(env: MatchingEnv): Router` exposing `GET /matches`, returning `{ id, otherUserId, createdAt }[]`.

- [ ] **Step 1: Write the failing tests for listing matches**

Create `services/matching/test/matches.test.ts`:

```ts
import { getPrisma } from "@pace-partner/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { testEnv } from "./fixtures/testEnv.js";
import { createTestUser, signTestToken } from "./helpers/testUser.js";

const prisma = getPrisma(testEnv.DATABASE_URL);
const app = createApp(testEnv);

describe("GET /matching/matches", () => {
  it("returns 401 without a token", async () => {
    const response = await request(app).get("/matching/matches");
    expect(response.status).toBe(401);
  });

  it("returns an empty list when the caller has no matches", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const response = await request(app).get("/matching/matches").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("lists a match regardless of which side of userA/userB the caller is", async () => {
    const userA = await createTestUser(prisma);
    const tokenA = signTestToken(userA.id, testEnv.JWT_SECRET);
    const userB = await createTestUser(prisma);
    const tokenB = signTestToken(userB.id, testEnv.JWT_SECRET);

    await request(app)
      .post(`/matching/candidates/${userB.id}/swipe`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ decision: "ACCEPT" });
    await request(app)
      .post(`/matching/candidates/${userA.id}/swipe`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ decision: "ACCEPT" });

    const responseA = await request(app).get("/matching/matches").set("Authorization", `Bearer ${tokenA}`);
    expect(responseA.status).toBe(200);
    expect(responseA.body).toHaveLength(1);
    expect(responseA.body[0].otherUserId).toBe(userB.id);

    const responseB = await request(app).get("/matching/matches").set("Authorization", `Bearer ${tokenB}`);
    expect(responseB.status).toBe(200);
    expect(responseB.body).toHaveLength(1);
    expect(responseB.body[0].otherUserId).toBe(userA.id);
  });
});
```

- [ ] **Step 1b: Run it to confirm it fails**

Run: `npm run test --workspace=services/matching`
Expected: FAIL — `Cannot find module '../src/routes/matches.js'`

- [ ] **Step 2: Implement the matches router**

Create `services/matching/src/routes/matches.ts`:

```ts
import { Router } from "express";
import { getPrisma, type AuthedRequest } from "@pace-partner/shared";
import type { MatchingEnv } from "../env.js";

export function createMatchesRouter(env: MatchingEnv): Router {
  const router = Router();
  const prisma = getPrisma(env.DATABASE_URL);

  router.get("/matches", async (req: AuthedRequest, res) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    try {
      const matches = await prisma.match.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
      });
      res.json(
        matches.map((match) => ({
          id: match.id,
          otherUserId: match.userAId === userId ? match.userBId : match.userAId,
          createdAt: match.createdAt,
        })),
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}
```

- [ ] **Step 3: Mount the matches router in `app.ts`**

In `services/matching/src/app.ts`, add the import:

```ts
import { createMatchesRouter } from "./routes/matches.js";
```

and add, after `matchingRouter.use(createCandidatesRouter(env));`:

```ts
  matchingRouter.use(createMatchesRouter(env));
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm run test --workspace=services/matching`
Expected: PASS (all `matches.test.ts` cases)

- [ ] **Step 5: Commit**

```bash
git add services/matching
git commit -m "feat(matching): add GET /matching/matches"
```

---

## Task 8: Full round-trip integration test and final verification

**Files:**
- Create: `services/matching/test/matchFlow.test.ts`

**Interfaces:**
- Consumes: every route from Tasks 4-7. Produces nothing further — this is the plan's final task.

- [ ] **Step 1: Write the end-to-end round-trip test**

Create `services/matching/test/matchFlow.test.ts`:

```ts
import { getPrisma } from "@pace-partner/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { testEnv } from "./fixtures/testEnv.js";
import { createTestUser, signTestToken } from "./helpers/testUser.js";

const prisma = getPrisma(testEnv.DATABASE_URL);
const app = createApp(testEnv);

describe("full matching round trip", () => {
  it("takes two compatible runners from profile setup through to a mutual match", async () => {
    const alice = await createTestUser(prisma);
    const aliceToken = signTestToken(alice.id, testEnv.JWT_SECRET);
    const bob = await createTestUser(prisma);
    const bobToken = signTestToken(bob.id, testEnv.JWT_SECRET);

    await request(app)
      .put("/matching/profile")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ paceSecondsPerKm: 330, mrtStations: ["Bishan", "Novena"] });
    await request(app)
      .put("/matching/profile")
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ paceSecondsPerKm: 340, mrtStations: ["Novena", "Newton"] });

    const aliceCandidates = await request(app)
      .get("/matching/candidates")
      .set("Authorization", `Bearer ${aliceToken}`);
    expect(aliceCandidates.body.map((c: { userId: string }) => c.userId)).toContain(bob.id);

    await request(app)
      .post(`/matching/candidates/${bob.id}/swipe`)
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ decision: "ACCEPT" });
    const bobSwipeResponse = await request(app)
      .post(`/matching/candidates/${alice.id}/swipe`)
      .set("Authorization", `Bearer ${bobToken}`)
      .send({ decision: "ACCEPT" });
    expect(bobSwipeResponse.body.match).not.toBeNull();

    const aliceMatches = await request(app).get("/matching/matches").set("Authorization", `Bearer ${aliceToken}`);
    expect(aliceMatches.body.map((m: { otherUserId: string }) => m.otherUserId)).toContain(bob.id);

    const bobMatches = await request(app).get("/matching/matches").set("Authorization", `Bearer ${bobToken}`);
    expect(bobMatches.body.map((m: { otherUserId: string }) => m.otherUserId)).toContain(alice.id);
  });
});
```

- [ ] **Step 2: Run it to confirm it passes**

Run: `npm run test --workspace=services/matching`
Expected: PASS

- [ ] **Step 3: Run the full monorepo build and test suite**

Run: `npm run build && npm run test`
Expected: all workspaces build and pass (Postgres must be running via `docker compose up -d postgres`; the mockpass-dependent `services/auth` integration test skips itself if mockpass isn't running, same as the Task 1 baseline)

- [ ] **Step 4: Commit**

```bash
git add services/matching
git commit -m "test(matching): add full profile-to-match round trip integration test"
```

---

## Self-Review Notes

- **Spec coverage:** Cross-service auth refactor (Task 1), data model incl. MRT list (Task 2), `PUT`/`GET /matching/profile` (Task 4), `GET /matching/candidates` (Task 5), `POST .../swipe` (Task 6), `GET /matching/matches` (Task 7), error handling (400/401/404/409 covered across Tasks 4-6), testing incl. full round trip (Task 8). All spec sections have a corresponding task.
- One deliberate refinement beyond the spec's literal schema sketch: `Swipe` and `Match` gained explicit Prisma `@relation` fields to `User` (named relations, since each model has two foreign keys into the same table) so the foreign keys are enforced at the database level. This doesn't change the API shape, the compatibility rule, or any documented field — it only completes the relational integrity the spec's simpler sketch left implicit.
