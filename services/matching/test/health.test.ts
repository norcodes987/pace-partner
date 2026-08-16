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
