import type { AuthEnv } from "../../src/env.js";

export const testEnv: AuthEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  JWT_SECRET: "test-secret",
  SINGPASS_CLIENT_ID: "test-client",
  SINGPASS_REDIRECT_URI: "http://localhost:4001/auth/singpass/callback",
  SINGPASS_OIDC_CONFIG_URL: "http://localhost:5156/singpass/v2/.well-known/openid-configuration",
};
