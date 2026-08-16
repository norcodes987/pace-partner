import { describe, expect, it } from "vitest";
import { loadMatchingEnv } from "../src/env.js";

const validEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  JWT_SECRET: "test-secret",
};

describe("loadMatchingEnv", () => {
  it("parses a valid environment", () => {
    const env = loadMatchingEnv(validEnv);
    expect(env.JWT_SECRET).toBe("test-secret");
  });

  it("throws a specific error when JWT_SECRET is missing", () => {
    const { JWT_SECRET: _unused, ...rest } = validEnv;
    expect(() => loadMatchingEnv(rest)).toThrowError(/Invalid environment configuration/);
  });
});
