import { verifySessionToken } from "@pace-partner/shared";
import { describe, expect, it } from "vitest";
import { signSessionToken } from "../src/jwt.js";

describe("signSessionToken", () => {
  it("produces a token that verifySessionToken accepts and round-trips the user id", () => {
    const token = signSessionToken("user-123", "test-secret");
    const payload = verifySessionToken(token, "test-secret");
    expect(payload.sub).toBe("user-123");
  });
});
