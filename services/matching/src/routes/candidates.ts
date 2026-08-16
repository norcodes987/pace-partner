import { Router } from "express";
import { getPrisma, type AuthedRequest } from "@pace-partner/shared";
import type { MatchingEnv } from "../env.js";

const PACE_TOLERANCE_SECONDS = 30;
const CANDIDATE_LIMIT = 50;

export function createCandidatesRouter(env: MatchingEnv): Router {
  const router = Router();
  const prisma = getPrisma(env.DATABASE_URL);

  router.get("/candidates", async (req: AuthedRequest, res) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    try {
      const ownProfile = await prisma.runnerProfile.findUnique({ where: { userId } });
      if (!ownProfile) {
        res.status(400).json({ error: "Complete your profile before browsing candidates" });
        return;
      }

      const alreadySwiped = await prisma.swipe.findMany({
        where: { userId },
        select: { targetUserId: true },
      });
      const excludedUserIds = [userId, ...alreadySwiped.map((swipe) => swipe.targetUserId)];

      const candidates = await prisma.runnerProfile.findMany({
        where: {
          userId: { notIn: excludedUserIds },
          paceSecondsPerKm: {
            gte: ownProfile.paceSecondsPerKm - PACE_TOLERANCE_SECONDS,
            lte: ownProfile.paceSecondsPerKm + PACE_TOLERANCE_SECONDS,
          },
          mrtStations: { hasSome: ownProfile.mrtStations },
        },
        take: CANDIDATE_LIMIT,
      });

      res.json(
        candidates.map((candidate) => ({
          userId: candidate.userId,
          paceSecondsPerKm: candidate.paceSecondsPerKm,
          mrtStations: candidate.mrtStations,
        })),
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}
