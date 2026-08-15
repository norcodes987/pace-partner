import express, { type Express } from "express";
import type { AuthEnv } from "./env.js";
import { createSingpassAuthRouter } from "./routes/singpassAuth.js";

export function createApp(env: AuthEnv): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "auth" });
  });

  app.use("/auth", createSingpassAuthRouter(env));

  return app;
}
