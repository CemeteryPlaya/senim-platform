import { describe, expect, it } from "vitest";
import { GeolocationError } from "@/app/(legacy)/_components/geolocation";
import { ru } from "@/i18n/ru";
import { gpsNote, heroImage, readyFarWarning, readyWaitText } from "./deal-view";

describe("главное фото заказа", () => {
  const room = [{ src: "/room.jpg" }];
  it("свежее фото сдачи, иначе последний отчёт «Хода работ», иначе фото помещения, иначе иллюстрация", () => {
    expect(heroImage({ ready: [{ src: "/ready.jpg" }], progress: [[{ src: "/p1.jpg" }]], room, illustration: "/img/k.svg" })).toBe("/ready.jpg");
    expect(heroImage({ ready: [], progress: [[{ src: "/p1.jpg" }], [], [{ src: "/p3.jpg" }]], room, illustration: null })).toBe("/p3.jpg");
    expect(heroImage({ ready: [], progress: [[]], room, illustration: null })).toBe("/room.jpg");
    expect(heroImage({ ready: [], progress: [], room: [], illustration: "/img/k.svg" })).toBe("/img/k.svg");
    expect(heroImage({ ready: [], progress: [], room: [], illustration: null })).toBeNull();
  });
});

describe("геолокация при сдаче — мягкая проверка", () => {
  it("в радиусе — спокойная строка, дальше — предупреждение, без координат — честно «без геолокации»", () => {
    expect(gpsNote({ distanceM: 120, withinRadius: true, radiusM: 500 })).toEqual({ tone: "ok", text: "У адреса заказа (120 м)." });
    expect(gpsNote({ distanceM: 1800, withinRadius: false, radiusM: 500 })).toEqual({ tone: "warning", text: "Сдано в 1800 м от адреса заказа — дальше 500 м." });
    expect(gpsNote({ distanceM: null, withinRadius: null, radiusM: 500 })).toEqual({ tone: "unknown", text: "Без геолокации: расстояние до адреса в акте не указано." });
  });
});

describe("сдача вне радиуса — предупреждение мастеру в «Что дальше»", () => {
  const ready = { distanceM: 1800, withinRadius: false, radiusM: 500 };

  it("мастер сдал дальше радиуса — сказать, что расстояние попадёт в акт", () => {
    expect(readyFarWarning({ viewer: "EXECUTOR", status: "READY", ready })).toBe(ru.deal.ready.gpsWarning(1800, 500));
  });

  it("в радиусе, без координат, не мастер или уже не сдача — молчим", () => {
    expect(readyFarWarning({ viewer: "EXECUTOR", status: "READY", ready: { ...ready, distanceM: 100, withinRadius: true } })).toBeNull();
    expect(readyFarWarning({ viewer: "EXECUTOR", status: "READY", ready: { distanceM: null, withinRadius: null, radiusM: 500 } })).toBeNull();
    expect(readyFarWarning({ viewer: "CLIENT", status: "READY", ready })).toBeNull();
    expect(readyFarWarning({ viewer: "EXECUTOR", status: "ACCEPTED", ready })).toBeNull();
    expect(readyFarWarning({ viewer: "EXECUTOR", status: "IN_PROGRESS", ready: null })).toBeNull();
  });
});

describe("строка под «Сдать работу» (aria-live)", () => {
  it("ждём фото, затем определяем место; отказ в геопозиции — с причиной, а не молча", () => {
    expect(readyWaitText({ uploading: true, geo: { status: "locating" } })).toBe(ru.deal.ready.waitPhotos);
    expect(readyWaitText({ uploading: false, geo: { status: "locating" } })).toBe(ru.deal.ready.locating);
    expect(readyWaitText({ uploading: false, geo: { status: "failed", error: new GeolocationError("denied") } })).toBe(ru.files.geolocation.errors.denied);
  });

  it("место определено или ещё не спрашивали — пусто", () => {
    expect(readyWaitText({ uploading: false, geo: { status: "idle" } })).toBe("");
    expect(readyWaitText({ uploading: false, geo: { status: "located", fix: { lat: 1, lng: 2, accuracyM: 3 } } })).toBe("");
  });
});
