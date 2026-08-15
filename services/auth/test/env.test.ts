import { describe, expect, it } from "vitest";
import { loadAuthEnv } from "../src/env.js";

const validEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  JWT_SECRET: "test-secret",
  SINGPASS_CLIENT_ID: "test-client",
  SINGPASS_REDIRECT_URI: "http://localhost:4001/auth/singpass/callback",
  SINGPASS_OIDC_CONFIG_URL: "http://localhost:5156/singpass/v2/.well-known/openid-configuration",
};

describe("loadAuthEnv", () => {
  it("parses a valid environment", () => {
    const env = loadAuthEnv(validEnv);
    expect(env.JWT_SECRET).toBe("test-secret");
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });

  it("throws when JWT_SECRET is missing", () => {
    const { JWT_SECRET, ...rest } = validEnv;
    expect(() => loadAuthEnv(rest)).toThrowError(/Invalid environment configuration/);
  });
});
