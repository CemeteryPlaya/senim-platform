import { describe, expect, it } from "vitest";
import { forgetDraft, memoryKey, mergeSaved } from "./wizard-memory";

describe("память ввода шага", () => {
  const initial = { city: "Астана", address: "", location: null as { lat: number; lng: number } | null };

  it("сохранённое ложится поверх начального: только известные ключи того же типа", () => {
    expect(mergeSaved(initial, { city: "Алматы", address: "пр. Абая, 10", location: { lat: 1, lng: 2 } })).toEqual({
      city: "Алматы",
      address: "пр. Абая, 10",
      location: { lat: 1, lng: 2 },
    });
    expect(mergeSaved({ ...initial, location: { lat: 1, lng: 2 } }, { location: null })).toMatchObject({ location: null });
    expect(mergeSaved(initial, { city: 5, extra: "x", location: "строка" })).toEqual(initial);
  });

  it("испорченное или чужое — начальное значение", () => {
    for (const saved of [null, "строка", 7, ["city"]]) expect(mergeSaved(initial, saved)).toEqual(initial);
  });

  it("без sessionStorage (сервер, запрет) — ключ всё равно строится, забывание не падает", () => {
    expect(memoryKey("d1", "place")).toBe("senim.request-wizard:d1:place");
    expect(memoryKey(null, "start")).toMatch(/^senim\.request-wizard:new.*:start$/);
    expect(() => forgetDraft("d1")).not.toThrow();
  });
});
