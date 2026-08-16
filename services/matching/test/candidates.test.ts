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

  it("excludes a candidate the caller has already swiped on", async () => {
    const caller = await createTestUser(prisma);
    const callerToken = signTestToken(caller.id, testEnv.JWT_SECRET);
    await setProfile(callerToken, 330, ["Bishan"]);

    const candidate = await createTestUser(prisma);
    const candidateToken = signTestToken(candidate.id, testEnv.JWT_SECRET);
    await setProfile(candidateToken, 330, ["Bishan"]);

    await request(app)
      .post(`/matching/candidates/${candidate.id}/swipe`)
      .set("Authorization", `Bearer ${callerToken}`)
      .send({ decision: "PASS" });

    const response = await request(app)
      .get("/matching/candidates")
      .set("Authorization", `Bearer ${callerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.map((c: { userId: string }) => c.userId)).not.toContain(candidate.id);
  });

  it("includes a candidate exactly at the +/-30s pace boundary and excludes one second past it", async () => {
    const caller = await createTestUser(prisma);
    const callerToken = signTestToken(caller.id, testEnv.JWT_SECRET);
    await setProfile(callerToken, 330, ["Bishan"]);

    const atBoundary = await createTestUser(prisma);
    const atBoundaryToken = signTestToken(atBoundary.id, testEnv.JWT_SECRET);
    await setProfile(atBoundaryToken, 360, ["Bishan"]);

    const pastBoundary = await createTestUser(prisma);
    const pastBoundaryToken = signTestToken(pastBoundary.id, testEnv.JWT_SECRET);
    await setProfile(pastBoundaryToken, 361, ["Bishan"]);

    const response = await request(app)
      .get("/matching/candidates")
      .set("Authorization", `Bearer ${callerToken}`);
    expect(response.status).toBe(200);
    const ids = response.body.map((c: { userId: string }) => c.userId);
    expect(ids).toContain(atBoundary.id);
    expect(ids).not.toContain(pastBoundary.id);
  });
});
