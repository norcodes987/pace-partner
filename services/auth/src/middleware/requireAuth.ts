import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifySessionToken } from "../jwt.js";

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
