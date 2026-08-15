import { PrismaClient } from "@prisma/client";

let client: PrismaClient | undefined;

export function getPrisma(url?: string): PrismaClient {
  if (!client) {
    client = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  }
  return client;
}
