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
