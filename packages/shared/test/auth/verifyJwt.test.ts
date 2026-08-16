import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { verifySessionToken } from "../../src/auth/verifyJwt.js";

describe("verifySessionToken", () => {
  it("round-trips a user id from a validly signed token", () => {
    const token = jwt.sign({ sub: "user-123" }, "test-secret", { expiresIn: "1h" });
    const payload = verifySessionToken(token, "test-secret");
    expect(payload.sub).toBe("user-123");
  });

  it("rejects a token signed with a different secret", () => {
    const token = jwt.sign({ sub: "user-123" }, "test-secret", { expiresIn: "1h" });
    expect(() => verifySessionToken(token, "wrong-secret")).toThrow();
  });

  it("rejects a token with no sub claim", () => {
    const token = jwt.sign({}, "test-secret", { expiresIn: "1h" });
    expect(() => verifySessionToken(token, "test-secret")).toThrow();
  });
});
