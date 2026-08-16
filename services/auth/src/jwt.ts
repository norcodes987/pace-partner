import jwt from "jsonwebtoken";

const SESSION_TOKEN_EXPIRY = "1h";

export function signSessionToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: SESSION_TOKEN_EXPIRY });
}
