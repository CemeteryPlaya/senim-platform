import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { handPayload, PNG_DATA_URL } from "./hand-state";

const png = "data:image/png;base64,iVBORw0KGgo=";

describe("handPayload — что отправить на сервер", () => {
  it("рисунок: только если на холсте что-то нарисовано", () => {
    expect(handPayload({ mode: "draw", hasInk: true, dataUrl: png, typedName: "" })).toEqual({ ok: true, payload: { imageDataUrl: png } });
    expect(handPayload({ mode: "draw", hasInk: false, dataUrl: png, typedName: "" })).toEqual({ ok: false, error: ru.documents.hand.empty });
  });

  it("напечатанное имя — обрезанное, от 2 символов (клавиатурная альтернатива холсту)", () => {
    expect(handPayload({ mode: "type", hasInk: false, dataUrl: null, typedName: "  Айгерим Сапарова " })).toEqual({ ok: true, payload: { typedName: "Айгерим Сапарова" } });
    expect(handPayload({ mode: "type", hasInk: true, dataUrl: png, typedName: " А " })).toEqual({ ok: false, error: ru.documents.errors.typedNameLength });
  });

  it("границы длины имени: 2 и 120 символов — можно, 1 и 121 — нельзя", () => {
    const typed = (name: string) => handPayload({ mode: "type", hasInk: false, dataUrl: null, typedName: name }).ok;
    expect([typed("Аа"), typed("А"), typed("я".repeat(120)), typed("я".repeat(121))]).toEqual([true, false, true, false]);
  });

  it("формат data URL рисунка проверяется по шаблону PNG", () => {
    expect(PNG_DATA_URL.test(png)).toBe(true);
    expect(PNG_DATA_URL.test("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(PNG_DATA_URL.test(`x${png}`)).toBe(false);
    expect(PNG_DATA_URL.test(`${png}<script>`)).toBe(false);
    expect(PNG_DATA_URL.test("data:image/png;base64,iVBORw0KGgo==")).toBe(true);
  });
});
