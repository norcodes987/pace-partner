import { describe, expect, it } from "vitest";
import { createSingpassClient } from "../src/singpassClient.js";

describe("createSingpassClient", () => {
  it("constructs without throwing given valid config", () => {
    const client = createSingpassClient({
      oidcConfigUrl: "http://localhost:5156/singpass/v2/.well-known/openid-configuration",
      clientId: "test-client",
      redirectUri: "http://localhost:4001/auth/singpass/callback",
    });
    expect(client).toBeDefined();
    expect(typeof client.getTokens).toBe("function");
  });
});
