import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifySessionToken } from "./verifyJwt.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(secret: string): RequestHandler {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }
    try {
      const payload = verifySessionToken(header.slice("Bearer ".length), secret);
      req.userId = payload.sub;
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

/**
 * Wraps a route handler that requires an authenticated user, narrowing
 * `req.userId` from `string | undefined` to `string`. Route handlers using
 * this must be mounted behind `requireAuth`, which guarantees `req.userId`
 * is set — this helper just removes the need for every handler to repeat
 * the same runtime guard to satisfy TypeScript's strict typing.
 */
export function withUser(
  handler: (
    req: AuthedRequest & { userId: string },
    res: Response,
    next: NextFunction,
  ) => void | Promise<void>,
): RequestHandler {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.userId) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }
    Promise.resolve(handler(req as AuthedRequest & { userId: string }, res, next)).catch(next);
  };
}
