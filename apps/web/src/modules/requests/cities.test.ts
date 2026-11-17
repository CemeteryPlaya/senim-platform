import { describe, expect, it } from "vitest";
import { DISTRICTS, districtsOf, SUGGESTED_CITIES } from "./cities";
import { mockGeocoder } from "./geocoder";

describe("города-подсказки", () => {
  it("каждый узнаёт геокодер (список не разошёлся с CITY_CENTERS)", async () => {
    for (const city of SUGGESTED_CITIES) expect(await mockGeocoder.geocode({ city, address: "" }), city).not.toBeNull();
  });

  it("названия без лишних пробелов и повторов", () => {
    expect(new Set(SUGGESTED_CITIES).size).toBe(SUGGESTED_CITIES.length);
    for (const city of SUGGESTED_CITIES) expect(city).toBe(city.trim());
  });

  it("DISTRICTS: у Астаны 5 районов, у другого города списка нет", () => {
    expect(DISTRICTS["Астана"]).toEqual(["Алматы", "Байконыр", "Есиль", "Нура", "Сарыарка"]);
    expect(DISTRICTS["Алматы"]).toHaveLength(8);
    expect(DISTRICTS["Шымкент"]).toBeUndefined();
  });

  it("districtsOf: города без списка и имена из прототипа — null", () => {
    expect(districtsOf("constructor")).toBeNull();
    expect(districtsOf("__proto__")).toBeNull();
    expect(districtsOf("toString")).toBeNull();
    expect(districtsOf(" Астана ")).toHaveLength(5);
  });
});
