import express, { Router, type Express } from "express";
import { requireAuth } from "@pace-partner/shared";
import type { MatchingEnv } from "./env.js";

export function createApp(env: MatchingEnv): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "matching" });
  });

  const matchingRouter = Router();
  matchingRouter.use(requireAuth(env.JWT_SECRET));
  app.use("/matching", matchingRouter);

  return app;
}
