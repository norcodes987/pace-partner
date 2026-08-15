import axios from "axios";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { testEnv } from "./fixtures/testEnv.js";

let mockpassReachable = false;

beforeAll(async () => {
  try {
    await axios.get(testEnv.SINGPASS_OIDC_CONFIG_URL, { timeout: 2000 });
    mockpassReachable = true;
  } catch {
    mockpassReachable = false;
    console.warn("mockpass not reachable at " + testEnv.SINGPASS_OIDC_CONFIG_URL + " -- skipping singpassFlow integration test");
  }
});

describe("Singpass login -> callback round trip", () => {
  it("issues a session token for a mockpass login", async () => {
    if (!mockpassReachable) {
      return;
    }

    const app = createApp(testEnv);
    const loginResponse = await request(app).get("/auth/singpass/login");
    expect(loginResponse.status).toBe(302);

    const authorizeUrl = new URL(loginResponse.headers.location);
    const authorizeResponse = await axios.get(authorizeUrl.toString(), {
      maxRedirects: 0,
      validateStatus: (status) => status === 302,
    });
    const callbackUrl = new URL(authorizeResponse.headers.location);

    const callbackResponse = await request(app).get(
      "/auth/singpass/callback" + callbackUrl.search,
    );
    expect(callbackResponse.status).toBe(200);
    expect(callbackResponse.body.accessToken).toBeTypeOf("string");
    expect(callbackResponse.body.user.id).toBeTypeOf("string");
  });
});
