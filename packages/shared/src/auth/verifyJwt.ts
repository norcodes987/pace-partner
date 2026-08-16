import jwt from "jsonwebtoken";

export interface SessionTokenPayload {
  sub: string;
}

export function verifySessionToken(token: string, secret: string): SessionTokenPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === "string" || typeof decoded.sub !== "string") {
    throw new Error("Invalid session token payload");
  }
  return { sub: decoded.sub };
}
