import { Router } from "express";
import { z } from "zod";
import { getPrisma, mrtStationSchema, withUser } from "@pace-partner/shared";
import type { MatchingEnv } from "../env.js";

const MIN_PACE_SECONDS_PER_KM = 180;
const MAX_PACE_SECONDS_PER_KM = 900;

const profileBodySchema = z.object({
  paceSecondsPerKm: z.number().int().min(MIN_PACE_SECONDS_PER_KM).max(MAX_PACE_SECONDS_PER_KM),
  mrtStations: z.array(mrtStationSchema).nonempty(),
});

export function createProfileRouter(env: MatchingEnv): Router {
  const router = Router();
  const prisma = getPrisma(env.DATABASE_URL);

  router.put("/profile", withUser(async (req, res) => {
    const userId = req.userId;

    const parseResult = profileBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid profile data" });
      return;
    }
    const { paceSecondsPerKm, mrtStations } = parseResult.data;

    try {
      const profile = await prisma.runnerProfile.upsert({
        where: { userId },
        create: { userId, paceSecondsPerKm, mrtStations },
        update: { paceSecondsPerKm, mrtStations },
      });
      res.json(profile);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  }));

  router.get("/profile", withUser(async (req, res) => {
    const userId = req.userId;

    try {
      const profile = await prisma.runnerProfile.findUnique({ where: { userId } });
      if (!profile) {
        res.status(404).json({ error: "Profile not found" });
        return;
      }
      res.json(profile);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  }));

  return router;
}
