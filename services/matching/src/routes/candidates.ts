import { Router } from "express";
import { getPrisma, type AuthedRequest } from "@pace-partner/shared";
import { z } from "zod";
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

  const swipeBodySchema = z.object({
    decision: z.enum(["ACCEPT", "PASS"]),
  });

  router.post("/candidates/:userId/swipe", async (req: AuthedRequest, res) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    const targetUserId = req.params.userId;
    if (targetUserId === userId) {
      res.status(400).json({ error: "Cannot swipe on yourself" });
      return;
    }

    const parseResult = swipeBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid swipe decision" });
      return;
    }
    const { decision } = parseResult.data;

    try {
      const target = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        res.status(400).json({ error: "Unknown candidate" });
        return;
      }

      const existingSwipe = await prisma.swipe.findUnique({
        where: { userId_targetUserId: { userId, targetUserId } },
      });
      if (existingSwipe) {
        res.status(409).json({ error: "Already swiped on this candidate" });
        return;
      }

      const swipe = await prisma.swipe.create({ data: { userId, targetUserId, decision } });

      let match = null;
      if (decision === "ACCEPT") {
        const reciprocal = await prisma.swipe.findUnique({
          where: { userId_targetUserId: { userId: targetUserId, targetUserId: userId } },
        });
        if (reciprocal && reciprocal.decision === "ACCEPT") {
          const [userAId, userBId] = [userId, targetUserId].sort();
          match = await prisma.match.create({ data: { userAId, userBId } });
        }
      }

      res.status(201).json({ swipe, match });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}
