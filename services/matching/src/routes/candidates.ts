import { Router } from "express";
import { getPrisma, withUser } from "@pace-partner/shared";
import { Prisma } from "@prisma/client";
import type { Match } from "@prisma/client";
import { z } from "zod";
import type { MatchingEnv } from "../env.js";

const PACE_TOLERANCE_SECONDS = 30;
const CANDIDATE_LIMIT = 50;

export function createCandidatesRouter(env: MatchingEnv): Router {
  const router = Router();
  const prisma = getPrisma(env.DATABASE_URL);

  router.get("/candidates", withUser(async (req, res) => {
    const userId = req.userId;

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
        orderBy: { createdAt: "desc" },
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
  }));

  const swipeBodySchema = z.object({
    decision: z.enum(["ACCEPT", "PASS"]),
  });

  router.post("/candidates/:userId/swipe", withUser(async (req, res) => {
    const userId = req.userId;

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

      const [userAId, userBId] = [userId, targetUserId].sort();

      try {
        const result = await prisma.$transaction(async (tx) => {
          const swipe = await tx.swipe.create({ data: { userId, targetUserId, decision } });

          let match: Match | null = null;
          if (decision === "ACCEPT") {
            const reciprocal = await tx.swipe.findUnique({
              where: { userId_targetUserId: { userId: targetUserId, targetUserId: userId } },
            });
            if (reciprocal && reciprocal.decision === "ACCEPT") {
              match = await tx.match.create({ data: { userAId, userBId } });
            }
          }

          return { swipe, match };
        });

        res.status(201).json(result);
      } catch (transactionError) {
        if (
          transactionError instanceof Prisma.PrismaClientKnownRequestError &&
          transactionError.code === "P2002"
        ) {
          const rawTarget = transactionError.meta?.target;
          const targetStr = Array.isArray(rawTarget) ? rawTarget.join(",") : String(rawTarget ?? "");
          const isSwipeConflict = /targetuserid/i.test(targetStr);

          if (isSwipeConflict) {
            res.status(409).json({ error: "Already swiped on this candidate" });
            return;
          }

          // Match already exists — the other side's concurrent accept created it first.
          // The swipe itself succeeded, so re-fetch the match and report success.
          const existingMatch = await prisma.match.findUnique({
            where: { userAId_userBId: { userAId, userBId } },
          });
          const swipe = await prisma.swipe.findUnique({
            where: { userId_targetUserId: { userId, targetUserId } },
          });
          res.status(201).json({ swipe, match: existingMatch });
          return;
        }
        throw transactionError;
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  }));

  return router;
}
