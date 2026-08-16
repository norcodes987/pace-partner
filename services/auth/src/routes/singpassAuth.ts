import { Router } from "express";
import { generators } from "openid-client";
import { z } from "zod";
import { getPrisma } from "@pace-partner/shared";
import type { AuthEnv } from "../env.js";
import { signSessionToken } from "../jwt.js";
import { requireAuth, type AuthedRequest } from "@pace-partner/shared";
import { createSingpassClient } from "../singpassClient.js";
import { StateStore } from "../stateStore.js";

const callbackQuerySchema = z.object({
  code: z.string(),
  state: z.string(),
});

export function createSingpassAuthRouter(env: AuthEnv): Router {
  const router = Router();
  const prisma = getPrisma(env.DATABASE_URL);
  const singpassClient = createSingpassClient({
    oidcConfigUrl: env.SINGPASS_OIDC_CONFIG_URL,
    clientId: env.SINGPASS_CLIENT_ID,
    redirectUri: env.SINGPASS_REDIRECT_URI,
  });
  const stateStore = new StateStore();

  router.get("/singpass/login", async (_req, res) => {
    try {
      const state = generators.state();
      const nonce = generators.nonce();
      const codeVerifier = generators.codeVerifier();
      stateStore.save(state, { nonce, codeVerifier });

      const authorizationUrl = await singpassClient.constructAuthorizationUrlV2({
        state,
        nonce,
        userInfoScope: [],
        codeVerifier,
      });
      res.redirect(authorizationUrl);
    } catch (error) {
      console.error(error);
      res.status(502).json({ error: "Singpass authorization unavailable" });
    }
  });

  router.get("/singpass/callback", async (req, res) => {
    const parseResult = callbackQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({ error: "Missing code or state" });
      return;
    }
    const { code, state } = parseResult.data;

    const stored = stateStore.consume(state);
    if (!stored) {
      res.status(400).json({ error: "Unknown or expired state" });
      return;
    }

    let payload: Awaited<ReturnType<typeof singpassClient.getIdTokenPayload>>;
    try {
      const tokens = await singpassClient.getTokens(code, stored.codeVerifier);
      payload = await singpassClient.getIdTokenPayload(tokens);
    } catch (error) {
      console.error(error);
      res.status(502).json({ error: "Token exchange failed" });
      return;
    }

    if (payload.nonce !== stored.nonce) {
      res.status(400).json({ error: "Nonce mismatch" });
      return;
    }

    try {
      const { uuid } = singpassClient.extractNricAndUuidFromPayload(payload);
      const user = await prisma.user.upsert({
        where: { singpassSub: uuid },
        create: { singpassSub: uuid },
        update: {},
      });

      const accessToken = signSessionToken(user.id, env.JWT_SECRET);
      res.json({ accessToken, user: { id: user.id } });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.get("/me", requireAuth(env.JWT_SECRET), async (req: AuthedRequest, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.userId } });
      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }
      res.json({ id: user.id, singpassSub: user.singpassSub, createdAt: user.createdAt });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}
