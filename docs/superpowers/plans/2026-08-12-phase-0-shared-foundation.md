# Phase 0: Shared Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an npm workspaces monorepo skeleton — every package created, linked, buildable, and testable — with zero business logic, so Phases 1-4 can add real features without touching tooling.

**Architecture:** An npm workspaces monorepo with `apps/mobile` (Expo), three independent Express microservices under `services/` (`auth`, `matching`, `chat`), and `packages/shared` providing the one Prisma client and the zod env-validation helper every service imports. Each service exposes only a `GET /health` endpoint. Local infra (Postgres 16, Redis 7, RabbitMQ) runs via `docker-compose.yml`, none of it wired into app code yet except the Postgres connection string, which Prisma is configured against but never queries in this phase.

**Tech Stack:** TypeScript (strict, NodeNext modules), Node 20+, npm workspaces, Express 4, Prisma 5, zod, Vitest, Expo SDK 51+ (blank-typescript template), Zustand, Docker Compose.

## Global Constraints

- TypeScript `strict: true` in every package (CLAUDE.md rule 1); no `any` without a comment justifying it.
- All DB access through Prisma — no raw SQL outside migration files (CLAUDE.md rule 3).
- All external inputs validated with zod (CLAUDE.md rule 4) — environment variables are the only input surface Phase 0 has.
- One microservice per task/commit — never combine changes across two of `auth`/`matching`/`chat` in a single commit (CLAUDE.md rule 2).
- `docker-compose.yml` is created fresh in Task 2 with the user's explicit prior sign-off; do not modify `.env`, `infra/`, or CI config without asking first (CLAUDE.md rule 6).
- No PostGIS — matching is by discrete MRT station, not geo-distance (per spec).
- No feature/business logic beyond what's specified: no Singpass, no domain models, no matching logic, no chat wiring, no mobile screens (CLAUDE.md rule 7; spec's "Out of Scope" section).

---

## Task 1: Root workspace scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Produces: an npm workspaces root recognizing `apps/*`, `services/*`, `packages/*`; every later package's `tsconfig.json` extends `tsconfig.base.json` (`strict: true`, `module`/`moduleResolution: NodeNext`, `target: ES2022`).

- [ ] **Step 1: Write the root `package.json`**

```json
{
  "name": "pace-partner",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "apps/*",
    "services/*",
    "packages/*"
  ],
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
.env
*.log
.expo/
coverage/
```

- [ ] **Step 4: Write `.env.example`**

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pace_partner
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672
```

- [ ] **Step 5: Verify npm accepts the workspace config**

Run: `npm install`
Expected: completes with no errors (no workspace packages exist yet, so nothing to link — this just confirms `package.json` is valid and creates the initial `package-lock.json`).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.base.json .gitignore .env.example package-lock.json
git commit -m "chore: scaffold npm workspaces root"
```

---

## Task 2: Local infra via docker-compose

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Produces: `postgres` (port 5432, user/pass/db `postgres`/`postgres`/`pace_partner`), `redis` (port 6379), `rabbitmq` (ports 5672/15672, user/pass `guest`/`guest`) — matching the credentials in `.env.example`.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: pace_partner
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    restart: unless-stopped
    ports:
      - "6379:6379"

  rabbitmq:
    image: rabbitmq:3-management
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    ports:
      - "5672:5672"
      - "15672:15672"

volumes:
  postgres_data:
```

- [ ] **Step 2: Validate**

Run: `docker compose config --quiet`
Expected: no output, exit code 0 (valid YAML + compose schema).

If Docker isn't available in your environment (it isn't in this devcontainer as of this plan being written), skip execution and instead visually diff the file against the block above to confirm it matches exactly — the credentials must match `.env.example` for later phases to connect without extra config.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add local Postgres, Redis, RabbitMQ via docker-compose"
```

---

## Task 3: packages/shared — env validation + Prisma client

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/prisma/schema.prisma`
- Create: `packages/shared/src/env.ts`
- Create: `packages/shared/src/prisma.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/test/env.test.ts`
- Test: `packages/shared/test/prisma.test.ts`

**Interfaces:**
- Consumes: `tsconfig.base.json` (Task 1).
- Produces: `loadEnv(source?: NodeJS.ProcessEnv): { DATABASE_URL: string; REDIS_URL: string; RABBITMQ_URL: string }` — throws `Error` with message starting `"Invalid environment configuration: "` when a required var is missing/malformed. `prisma: PrismaClient` — a singleton instance. Both exported from `@pace-partner/shared`. Later service tasks (4-6) call `loadEnv(process.env)` at startup for its validation side effect.

Note on `PORT`: the spec describes the shared schema as covering "a per-service PORT," but three services need three different ports running simultaneously against one shared `.env` file, so `PORT` is validated locally in each service (Tasks 4-6) via a one-line zod parse with a per-service default, not centralized in `loadEnv`. `DATABASE_URL`/`REDIS_URL`/`RABBITMQ_URL` remain the shared, strictly-required schema.

- [ ] **Step 1: Write `packages/shared/package.json`**

```json
{
  "name": "@pace-partner/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "generate": "prisma generate --schema=prisma/schema.prisma",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Write `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install zod@^3.23.0 @prisma/client@^5.16.0 --workspace=packages/shared`
Run: `npm install -D prisma@^5.16.0 typescript@^5.5.0 vitest@^2.0.0 --workspace=packages/shared`
Expected: both complete with no errors; `packages/shared/package.json` now has `dependencies` (zod, @prisma/client) and `devDependencies` (prisma, typescript, vitest) sections.

- [ ] **Step 4: Write the failing test for env validation**

```ts
// packages/shared/test/env.test.ts
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";

describe("loadEnv", () => {
  it("parses a valid environment", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      REDIS_URL: "redis://localhost:6379",
      RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
    });
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
  });

  it("throws a specific error when a required variable is missing", () => {
    expect(() => loadEnv({})).toThrowError(/Invalid environment configuration/);
  });
});
```

- [ ] **Step 5: Run the test, verify it fails**

Run: `npm run test --workspace=packages/shared`
Expected: FAIL — Vitest cannot resolve `../src/env.js` because `src/env.ts` doesn't exist yet.

- [ ] **Step 6: Implement env validation**

```ts
// packages/shared/src/env.ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return result.data;
}
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `npm run test --workspace=packages/shared`
Expected: PASS (2 tests).

- [ ] **Step 8: Write the failing test for the Prisma client**

```ts
// packages/shared/test/prisma.test.ts
import { describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";

describe("prisma client", () => {
  it("instantiates without throwing", () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe("function");
  });
});
```

- [ ] **Step 9: Run the test, verify it fails**

Run: `npm run test --workspace=packages/shared`
Expected: FAIL — `src/prisma.ts` doesn't exist yet (and `@prisma/client` has no generated client yet).

- [ ] **Step 10: Write the Prisma schema (no models — Phase 0 owns no domain data)**

```prisma
// packages/shared/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 11: Generate the Prisma client**

Run: `npm run generate --workspace=packages/shared`
Expected: `Generated Prisma Client` success message. First run may take a minute or two while it downloads query-engine binaries.

- [ ] **Step 12: Implement the Prisma client singleton**

```ts
// packages/shared/src/prisma.ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

- [ ] **Step 13: Write the barrel export**

```ts
// packages/shared/src/index.ts
export { loadEnv } from "./env.js";
export type { Env } from "./env.js";
export { prisma } from "./prisma.js";
```

- [ ] **Step 14: Run the tests, verify everything passes**

Run: `npm run test --workspace=packages/shared`
Expected: PASS (3 tests total).

- [ ] **Step 15: Commit**

```bash
git add packages/shared package-lock.json
git commit -m "feat(shared): add env validation and Prisma client singleton"
```

---

## Task 4: services/auth — health check service

**Files:**
- Create: `services/auth/package.json`
- Create: `services/auth/tsconfig.json`
- Create: `services/auth/src/app.ts`
- Create: `services/auth/src/index.ts`
- Test: `services/auth/test/health.test.ts`

**Interfaces:**
- Consumes: `loadEnv` from `@pace-partner/shared` (Task 3).
- Produces: `createApp(): Express` — an Express app with `GET /health` returning `{ status: "ok", service: "auth" }`. Runnable standalone via `npm run dev --workspace=services/auth` on port 4001 (override with `PORT`).

- [ ] **Step 1: Write `services/auth/package.json`**

```json
{
  "name": "@pace-partner/auth",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --env-file=../../.env --import=tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Write `services/auth/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install @pace-partner/shared express@^4.19.2 zod@^3.23.0 --workspace=services/auth`
Run: `npm install -D @types/express@^4.17.21 supertest@^7.0.0 @types/supertest@^6.0.2 tsx@^4.15.0 typescript@^5.5.0 vitest@^2.0.0 --workspace=services/auth`
Expected: both complete with no errors; `@pace-partner/shared` resolves to the local workspace package (npm symlinks it — check `node_modules/@pace-partner/shared` in the repo root is a symlink into `packages/shared`).

- [ ] **Step 4: Write the failing test**

```ts
// services/auth/test/health.test.ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("returns ok status with the service name", async () => {
    const app = createApp();
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "auth" });
  });
});
```

- [ ] **Step 5: Run the test, verify it fails**

Run: `npm run test --workspace=services/auth`
Expected: FAIL — `src/app.ts` doesn't exist yet.

- [ ] **Step 6: Implement the app**

```ts
// services/auth/src/app.ts
import express, { type Express } from "express";

export function createApp(): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "auth" });
  });

  return app;
}
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `npm run test --workspace=services/auth`
Expected: PASS (1 test).

- [ ] **Step 8: Implement the entrypoint**

```ts
// services/auth/src/index.ts
import { z } from "zod";
import { loadEnv } from "@pace-partner/shared";
import { createApp } from "./app.js";

loadEnv(process.env);

const port = z.coerce.number().int().positive().default(4001).parse(process.env.PORT);
const app = createApp();

app.listen(port, () => {
  console.log(`auth service listening on port ${port}`);
});
```

- [ ] **Step 9: Manually verify the service boots end-to-end**

Run: `cp .env.example .env` (repo root, if not already done)
Run: `npm run dev --workspace=services/auth`
In another terminal, run: `curl http://localhost:4001/health`
Expected: `{"status":"ok","service":"auth"}`. Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 10: Commit**

```bash
git add services/auth package-lock.json
git commit -m "feat(auth): scaffold service with health check endpoint"
```

---

## Task 5: services/matching — health check service

**Files:**
- Create: `services/matching/package.json`
- Create: `services/matching/tsconfig.json`
- Create: `services/matching/src/app.ts`
- Create: `services/matching/src/index.ts`
- Test: `services/matching/test/health.test.ts`

**Interfaces:**
- Consumes: `loadEnv` from `@pace-partner/shared` (Task 3).
- Produces: `createApp(): Express` — `GET /health` returns `{ status: "ok", service: "matching" }`. Runs standalone via `npm run dev --workspace=services/matching` on port 4002 (override with `PORT`).

- [ ] **Step 1: Write `services/matching/package.json`**

```json
{
  "name": "@pace-partner/matching",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --env-file=../../.env --import=tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Write `services/matching/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install @pace-partner/shared express@^4.19.2 zod@^3.23.0 --workspace=services/matching`
Run: `npm install -D @types/express@^4.17.21 supertest@^7.0.0 @types/supertest@^6.0.2 tsx@^4.15.0 typescript@^5.5.0 vitest@^2.0.0 --workspace=services/matching`
Expected: both complete with no errors.

- [ ] **Step 4: Write the failing test**

```ts
// services/matching/test/health.test.ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("returns ok status with the service name", async () => {
    const app = createApp();
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "matching" });
  });
});
```

- [ ] **Step 5: Run the test, verify it fails**

Run: `npm run test --workspace=services/matching`
Expected: FAIL — `src/app.ts` doesn't exist yet.

- [ ] **Step 6: Implement the app**

```ts
// services/matching/src/app.ts
import express, { type Express } from "express";

export function createApp(): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "matching" });
  });

  return app;
}
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `npm run test --workspace=services/matching`
Expected: PASS (1 test).

- [ ] **Step 8: Implement the entrypoint**

```ts
// services/matching/src/index.ts
import { z } from "zod";
import { loadEnv } from "@pace-partner/shared";
import { createApp } from "./app.js";

loadEnv(process.env);

const port = z.coerce.number().int().positive().default(4002).parse(process.env.PORT);
const app = createApp();

app.listen(port, () => {
  console.log(`matching service listening on port ${port}`);
});
```

- [ ] **Step 9: Manually verify the service boots end-to-end**

Run: `npm run dev --workspace=services/matching`
In another terminal, run: `curl http://localhost:4002/health`
Expected: `{"status":"ok","service":"matching"}`. Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 10: Commit**

```bash
git add services/matching package-lock.json
git commit -m "feat(matching): scaffold service with health check endpoint"
```

---

## Task 6: services/chat — health check service

**Files:**
- Create: `services/chat/package.json`
- Create: `services/chat/tsconfig.json`
- Create: `services/chat/src/app.ts`
- Create: `services/chat/src/index.ts`
- Test: `services/chat/test/health.test.ts`

**Interfaces:**
- Consumes: `loadEnv` from `@pace-partner/shared` (Task 3).
- Produces: `createApp(): Express` — `GET /health` returns `{ status: "ok", service: "chat" }`. Runs standalone via `npm run dev --workspace=services/chat` on port 4003 (override with `PORT`).

- [ ] **Step 1: Write `services/chat/package.json`**

```json
{
  "name": "@pace-partner/chat",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --env-file=../../.env --import=tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Write `services/chat/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install @pace-partner/shared express@^4.19.2 zod@^3.23.0 --workspace=services/chat`
Run: `npm install -D @types/express@^4.17.21 supertest@^7.0.0 @types/supertest@^6.0.2 tsx@^4.15.0 typescript@^5.5.0 vitest@^2.0.0 --workspace=services/chat`
Expected: both complete with no errors.

- [ ] **Step 4: Write the failing test**

```ts
// services/chat/test/health.test.ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("returns ok status with the service name", async () => {
    const app = createApp();
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "chat" });
  });
});
```

- [ ] **Step 5: Run the test, verify it fails**

Run: `npm run test --workspace=services/chat`
Expected: FAIL — `src/app.ts` doesn't exist yet.

- [ ] **Step 6: Implement the app**

```ts
// services/chat/src/app.ts
import express, { type Express } from "express";

export function createApp(): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "chat" });
  });

  return app;
}
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `npm run test --workspace=services/chat`
Expected: PASS (1 test).

- [ ] **Step 8: Implement the entrypoint**

```ts
// services/chat/src/index.ts
import { z } from "zod";
import { loadEnv } from "@pace-partner/shared";
import { createApp } from "./app.js";

loadEnv(process.env);

const port = z.coerce.number().int().positive().default(4003).parse(process.env.PORT);
const app = createApp();

app.listen(port, () => {
  console.log(`chat service listening on port ${port}`);
});
```

- [ ] **Step 9: Manually verify the service boots end-to-end**

Run: `npm run dev --workspace=services/chat`
In another terminal, run: `curl http://localhost:4003/health`
Expected: `{"status":"ok","service":"chat"}`. Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 10: Commit**

```bash
git add services/chat package-lock.json
git commit -m "feat(chat): scaffold service with health check endpoint"
```

---

## Task 7: apps/mobile — Expo scaffold + Zustand

**Files:**
- Create: `apps/mobile/` (via `create-expo-app`, then modified)
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/src/store/counterStore.ts`
- Test: `apps/mobile/test/counterStore.test.ts`

**Interfaces:**
- Produces: `useCounterStore` — a Zustand store (`{ count: number; increment(): void }`) proving Zustand is correctly wired, importable from `apps/mobile/src/store/counterStore.ts`. No screens/UI beyond the Expo template default.

- [ ] **Step 1: Scaffold the Expo app**

Run: `npx create-expo-app@latest apps/mobile --template blank-typescript`
Expected: creates `apps/mobile/` with `App.tsx`, `package.json`, `tsconfig.json`, `app.json`, `assets/`, etc.

- [ ] **Step 2: Read the generated `apps/mobile/package.json` and rename it into the workspace scope**

Open `apps/mobile/package.json`. Change the `"name"` field from whatever `create-expo-app` set (typically `"mobile"`) to `"@pace-partner/mobile"`. Add a `"test"` entry to the existing `"scripts"` object:

```json
"test": "vitest run"
```

Leave every other generated field (`start`, `android`, `ios`, `web`, `dependencies`, `main`, etc.) untouched.

- [ ] **Step 3: Check TypeScript strict mode**

Open `apps/mobile/tsconfig.json`. It should extend `"expo/tsconfig.base"` and already set `"strict": true` under `compilerOptions` (the current Expo blank-typescript template does this by default). If `"strict": true` is missing, add it explicitly under `compilerOptions`. Do not change `"extends"` away from `expo/tsconfig.base` — Expo's base config carries React Native-specific settings (JSX, module resolution for RN) that `tsconfig.base.json` does not provide.

- [ ] **Step 4: Install Zustand and Vitest**

Run: `npm install zustand@^4.5.0 --workspace=apps/mobile`
Run: `npm install -D vitest@^2.0.0 --workspace=apps/mobile`
Expected: both complete with no errors.

- [ ] **Step 5: Write the failing test**

```ts
// apps/mobile/test/counterStore.test.ts
import { describe, expect, it } from "vitest";
import { useCounterStore } from "../src/store/counterStore.js";

describe("useCounterStore", () => {
  it("increments the count", () => {
    useCounterStore.getState().increment();
    expect(useCounterStore.getState().count).toBe(1);
  });
});
```

- [ ] **Step 6: Run the test, verify it fails**

Run: `npm run test --workspace=apps/mobile`
Expected: FAIL — `src/store/counterStore.ts` doesn't exist yet.

- [ ] **Step 7: Implement the store**

```ts
// apps/mobile/src/store/counterStore.ts
import { create } from "zustand";

interface CounterState {
  count: number;
  increment: () => void;
}

export const useCounterStore = create<CounterState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));
```

- [ ] **Step 8: Run the test, verify it passes**

Run: `npm run test --workspace=apps/mobile`
Expected: PASS (1 test).

- [ ] **Step 9: Confirm the app still type-checks in strict mode**

Run: `npx tsc --noEmit -p apps/mobile/tsconfig.json`
Expected: no output, exit code 0.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile package-lock.json
git commit -m "feat(mobile): scaffold Expo app with Zustand"
```

---

## Task 8: Full workspace verification

**Files:** none (verification only)

**Interfaces:** none — this task confirms Tasks 1-7 compose correctly as a whole.

- [ ] **Step 1: Build every package from the root**

Run: `npm run build --workspaces --if-present`
Expected: exits 0; `dist/` created under `packages/shared`, `services/auth`, `services/matching`, `services/chat` (Expo has no `build` script — it's skipped via `--if-present`).

- [ ] **Step 2: Test every package from the root**

Run: `npm run test --workspaces --if-present`
Expected: exits 0; all suites report PASS — 3 tests in `packages/shared`, 1 each in `services/auth`, `services/matching`, `services/chat`, 1 in `apps/mobile` (7 total).

- [ ] **Step 3: Confirm a clean working tree**

Run: `git status`
Expected: `nothing to commit, working tree clean` (everything from Tasks 1-7 was already committed per-task).

- [ ] **Step 4: Commit (only if Step 1 or 2 touched anything, e.g. lockfile drift)**

```bash
git add -A
git commit -m "chore: verify full workspace build and test pass"
```

If `git status` in Step 3 was already clean, skip this step — there's nothing to commit.
