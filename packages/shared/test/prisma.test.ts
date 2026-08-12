import { describe, expect, it } from "vitest";
import { prisma } from "../src/prisma.js";

describe("prisma client", () => {
  it("instantiates without throwing", () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe("function");
  });
});
