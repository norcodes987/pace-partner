import { Router } from "express";
import { getPrisma, type AuthedRequest } from "@pace-partner/shared";
import type { MatchingEnv } from "../env.js";

export function createMatchesRouter(env: MatchingEnv): Router {
  const router = Router();
  const prisma = getPrisma(env.DATABASE_URL);

  router.get("/matches", async (req: AuthedRequest, res) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    try {
      const matches = await prisma.match.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
      });
      res.json(
        matches.map((match) => ({
          id: match.id,
          otherUserId: match.userAId === userId ? match.userBId : match.userAId,
          createdAt: match.createdAt,
        })),
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}
