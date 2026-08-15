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
