import { describe, expect, it } from "vitest";
import { checkGps, haversineMeters } from "./geo";

// Байтерек (Астана) и точка в 0,01° к северу: ≈ 1112 м по меридиану.
const BAITEREK = { lat: 51.128207, lng: 71.430411 };
const NORTH = { lat: 51.138207, lng: 71.430411 };

describe("haversineMeters", () => {
  it("ноль для одной точки", () => {
    expect(haversineMeters(BAITEREK, BAITEREK)).toBe(0);
  });

  it("0,01° широты ≈ 1112 м", () => {
    expect(haversineMeters(BAITEREK, NORTH)).toBeCloseTo(1112, -1);
  });

  it("Астана — Алматы ≈ 970 км", () => {
    const almaty = { lat: 43.238949, lng: 76.889709 };
    expect(haversineMeters(BAITEREK, almaty) / 1000).toBeCloseTo(970, -1);
  });

  it("симметрично", () => {
    expect(haversineMeters(BAITEREK, NORTH)).toBe(haversineMeters(NORTH, BAITEREK));
  });

  it("антиподы — половина окружности, без NaN", () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(d).toBeCloseTo(Math.PI * 6_371_008.8, 0);
  });
});

describe("checkGps", () => {
  it("в радиусе и за радиусом — граница включительно", () => {
    expect(checkGps(BAITEREK, NORTH, 1500)).toEqual({ distanceM: 1112, withinRadius: true });
    expect(checkGps(BAITEREK, NORTH, 1112)).toEqual({ distanceM: 1112, withinRadius: true });
    expect(checkGps(BAITEREK, NORTH, 500)).toEqual({ distanceM: 1112, withinRadius: false });
  });

  it("нет координат мастера или адреса — проверить нечем", () => {
    expect(checkGps(null, NORTH, 500)).toEqual({ distanceM: null, withinRadius: null });
    expect(checkGps(BAITEREK, null, 500)).toEqual({ distanceM: null, withinRadius: null });
  });
});
