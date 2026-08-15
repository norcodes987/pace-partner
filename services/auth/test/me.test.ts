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
