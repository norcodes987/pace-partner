import type { MatchingEnv } from "../../src/env.js";

export const testEnv: MatchingEnv = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/pace_partner",
  REDIS_URL: "redis://localhost:6379",
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  JWT_SECRET: "test-secret",
};
