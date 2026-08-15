import jwt from "jsonwebtoken";

const SESSION_TOKEN_EXPIRY = "1h";

export function signSessionToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: SESSION_TOKEN_EXPIRY });
}

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
