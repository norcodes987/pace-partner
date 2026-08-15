import { Router } from "express";
import { generators } from "openid-client";
import { getPrisma } from "@pace-partner/shared";
import type { AuthEnv } from "../env.js";
import { signSessionToken } from "../jwt.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { createSingpassClient } from "../singpassClient.js";
import { StateStore } from "../stateStore.js";

export function createSingpassAuthRouter(env: AuthEnv): Router {
  const router = Router();
  const prisma = getPrisma();
  const singpassClient = createSingpassClient({
    oidcConfigUrl: env.SINGPASS_OIDC_CONFIG_URL,
    clientId: env.SINGPASS_CLIENT_ID,
    redirectUri: env.SINGPASS_REDIRECT_URI,
  });
  const stateStore = new StateStore();

  router.get("/singpass/login", async (_req, res) => {
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
  });

  router.get("/singpass/callback", async (req, res) => {
    const { code, state } = req.query;
    if (typeof code !== "string" || typeof state !== "string") {
      res.status(400).json({ error: "Missing code or state" });
      return;
    }

    const stored = stateStore.consume(state);
    if (!stored) {
      res.status(400).json({ error: "Unknown or expired state" });
      return;
    }

    try {
      const tokens = await singpassClient.getTokens(code, stored.codeVerifier);
      const payload = await singpassClient.getIdTokenPayload(tokens);
      if (payload.nonce !== stored.nonce) {
        res.status(400).json({ error: "Nonce mismatch" });
        return;
      }

      const { uuid } = singpassClient.extractNricAndUuidFromPayload(payload);
      const user = await prisma.user.upsert({
        where: { singpassSub: uuid },
        create: { singpassSub: uuid },
        update: {},
      });

      const accessToken = signSessionToken(user.id, env.JWT_SECRET);
      res.json({ accessToken, user: { id: user.id } });
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "Singpass token exchange failed",
      });
    }
  });

  router.get("/me", requireAuth(env.JWT_SECRET), async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json({ id: user.id, singpassSub: user.singpassSub, createdAt: user.createdAt });
  });

  return router;
}
