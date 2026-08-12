import { describe, expect, it } from "vitest";
import { useCounterStore } from "../src/store/counterStore.js";

describe("useCounterStore", () => {
  it("increments the count", () => {
    useCounterStore.getState().increment();
    expect(useCounterStore.getState().count).toBe(1);
  });
});
