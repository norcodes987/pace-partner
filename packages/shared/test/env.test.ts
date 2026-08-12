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
