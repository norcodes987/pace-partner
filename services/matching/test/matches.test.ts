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
