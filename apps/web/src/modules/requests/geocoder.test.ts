import { describe, expect, it } from "vitest";
import { geocodeAddress, mockGeocoder } from "./geocoder";

describe("геокодер-мок адреса заявки", () => {
  it("узнаёт только город и честно помечает точность «город»; неизвестный город — null", async () => {
    expect(await mockGeocoder.geocode({ city: " Астана ", address: "ул. Тестовая, 1" })).toEqual({ lat: 51.1282, lng: 71.4305, precision: "city" });
    expect(await mockGeocoder.geocode({ city: "Неизвестноград", address: "" })).toBeNull();
  });

  it("искать точку может только заказчик", async () => {
    const executor = { id: "u1", role: "EXECUTOR" as const, roles: ["EXECUTOR" as const], phone: "+77000000000", fullName: null, iinLast4: null, isDemo: false, executor: null, mfa: { required: false, verifiedAt: null } };
    await expect(geocodeAddress(executor, { city: "Астана", address: "" })).rejects.toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});
