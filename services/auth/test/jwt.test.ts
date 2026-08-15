import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "../src/jwt.js";

describe("session JWT", () => {
  it("round-trips a user id", () => {
    const token = signSessionToken("user-123", "test-secret");
    const payload = verifySessionToken(token, "test-secret");
    expect(payload.sub).toBe("user-123");
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSessionToken("user-123", "test-secret");
    expect(() => verifySessionToken(token, "wrong-secret")).toThrow();
  });
});
