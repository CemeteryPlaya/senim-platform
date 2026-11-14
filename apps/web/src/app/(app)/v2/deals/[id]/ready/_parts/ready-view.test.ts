import { describe, expect, it } from "vitest";
import { GeolocationError, type GeoErrorCode } from "@/features/delivery/request-location";
import { ru } from "@/i18n/ru";
import { doneToast, placeView, readyInput } from "./ready-view";

const t = ru.app.masterSteps.ready;
const p = t.place;
const fix = { lat: 51.128207, lng: 71.430411, accuracyM: 18 };
const failed = (code: GeoErrorCode) => ({ status: "failed" as const, error: new GeolocationError(code) });

describe("место сдачи: все состояния геолокации честно", () => {
  it.each([
    ["не запрошено", { status: "idle" as const }, "idle", p.idle, p.mark],
    ["ждём ответа", { status: "locating" as const }, "locating", p.locating, p.mark],
    ["получено — без цифр координат", { status: "located" as const, fix }, "located", p.located, p.again],
    ["отказ в доступе", failed("denied"), "denied", p.denied, p.retry],
    ["таймаут", failed("timeout"), "timeout", p.timeout, p.retry],
    ["место не определилось", failed("unavailable"), "unavailable", p.unavailable, p.retry],
    ["нет API геолокации — кнопки нет", failed("unsupported"), "unsupported", p.unsupported, null],
    ["нет https — кнопки нет", failed("insecure"), "unsupported", p.unsupported, null],
  ])("%s", (_name, state, kind, text, button) => {
    const view = placeView(state);
    expect(view).toEqual({ kind, text, button });
    expect(view.text).not.toMatch(/\d/);
  });
});

describe("вход «Сдать работу»", () => {
  it("место отмечено — координаты и точность; иначе только фото (сдача без места)", () => {
    expect(readyInput("d1", ["f1"], { status: "located", fix })).toEqual({ dealId: "d1", photoIds: ["f1"], lat: fix.lat, lng: fix.lng, accuracyM: 18 });
    for (const state of [{ status: "idle" as const }, { status: "locating" as const }, failed("denied"), failed("timeout"), failed("insecure")]) {
      expect(readyInput("d1", ["f1"], state)).toEqual({ dealId: "d1", photoIds: ["f1"] });
    }
  });
});

describe("тост после сдачи — как решил модуль", () => {
  it("дальше радиуса — с расстоянием; у адреса и без места — обычный", () => {
    expect(doneToast({ distanceM: 4800, withinRadius: false, radiusM: 500 })).toEqual({ text: t.doneFar("4800", "500"), far: true });
    expect(doneToast({ distanceM: 20, withinRadius: true, radiusM: 500 })).toEqual({ text: t.done, far: false });
    expect(doneToast({ distanceM: null, withinRadius: null, radiusM: 500 })).toEqual({ text: t.done, far: false });
  });
});
