import { describe, expect, it } from "vitest";
import { getPrisma } from "../src/prisma.js";

describe("prisma client", () => {
  it("instantiates without throwing", () => {
    const prisma = getPrisma();
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe("function");
  });
});
