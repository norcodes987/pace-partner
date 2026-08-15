import type { AuthEnv } from "../../src/env.js";

export const testEnv: AuthEnv = {
  // Matches .env.example's DATABASE_URL: the real Postgres instance this sandbox runs
  // against (Task 1's migration applied). Fix 1 threads this through to getPrisma(), so
  // it must point at a reachable database rather than a placeholder.
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/pace_partner",
  REDIS_URL: "redis://localhost:6379",
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  JWT_SECRET: "test-secret",
  SINGPASS_CLIENT_ID: "test-client",
  SINGPASS_REDIRECT_URI: "http://localhost:4001/auth/singpass/callback",
  SINGPASS_OIDC_CONFIG_URL: "http://localhost:5156/singpass/v2/.well-known/openid-configuration",
};
