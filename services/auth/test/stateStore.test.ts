import { describe, expect, it } from "vitest";
import { StateStore } from "../src/stateStore.js";

describe("StateStore", () => {
  it("returns and clears a saved entry", () => {
    const store = new StateStore();
    store.save("state-1", { nonce: "nonce-1", codeVerifier: "verifier-1" });

    expect(store.consume("state-1")).toEqual({ nonce: "nonce-1", codeVerifier: "verifier-1" });
    expect(store.consume("state-1")).toBeUndefined();
  });

  it("returns undefined for an unknown state", () => {
    const store = new StateStore();
    expect(store.consume("never-saved")).toBeUndefined();
  });

  it("expires entries after the TTL", () => {
    let now = 1_000_000;
    const store = new StateStore(() => now);
    store.save("state-1", { nonce: "nonce-1", codeVerifier: "verifier-1" });

    now += 6 * 60 * 1000; // 6 minutes later, past the 5-minute TTL
    expect(store.consume("state-1")).toBeUndefined();
  });
});
