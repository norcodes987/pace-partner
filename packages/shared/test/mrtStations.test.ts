import { describe, expect, it } from "vitest";
import { MRT_STATIONS, mrtStationSchema } from "../src/mrtStations.js";

describe("mrtStationSchema", () => {
  it("accepts a known station", () => {
    expect(mrtStationSchema.parse("Bishan")).toBe("Bishan");
  });

  it("rejects an unknown station", () => {
    expect(() => mrtStationSchema.parse("Not A Real Station")).toThrow();
  });

  it("contains no duplicates", () => {
    expect(new Set(MRT_STATIONS).size).toBe(MRT_STATIONS.length);
  });

  it("contains the full set of operating stations", () => {
    expect(MRT_STATIONS.length).toBe(183);
  });
});
