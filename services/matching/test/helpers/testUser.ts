import { randomUUID } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import jwt from "jsonwebtoken";

export async function createTestUser(prisma: PrismaClient): Promise<User> {
  return prisma.user.create({ data: { singpassSub: randomUUID() } });
}

export function signTestToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "1h" });
}
