import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { testEnv } from "./fixtures/testEnv.js";

describe("GET /auth/singpass/callback", () => {
  it("returns 400 when code and state query params are missing", async () => {
    const response = await request(createApp(testEnv)).get("/auth/singpass/callback");
    expect(response.status).toBe(400);
  });

  it("returns 400 when state was never issued via /auth/singpass/login", async () => {
    const response = await request(createApp(testEnv)).get(
      "/auth/singpass/callback?code=test-code&state=unknown-state",
    );
    expect(response.status).toBe(400);
  });
});
