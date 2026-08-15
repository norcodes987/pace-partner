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

  it("evicts abandoned (never-consumed) entries once they are past TTL, on the next save", () => {
    let now = 1_000_000;
    const store = new StateStore(() => now);
    store.save("abandoned-1", { nonce: "nonce-1", codeVerifier: "verifier-1" });
    store.save("abandoned-2", { nonce: "nonce-2", codeVerifier: "verifier-2" });
    expect(store.size).toBe(2);

    now += 6 * 60 * 1000; // 6 minutes later, past the 5-minute TTL; neither entry was consumed
    store.save("state-3", { nonce: "nonce-3", codeVerifier: "verifier-3" });

    // The two abandoned entries should have been swept during save(), leaving only the new one.
    expect(store.size).toBe(1);
  });
});
