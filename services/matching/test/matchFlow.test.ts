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
