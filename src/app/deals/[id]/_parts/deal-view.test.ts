import { describe, expect, it } from "vitest";
import { dealStep, estimateRows, gpsNote, heroImage } from "./deal-view";

const plain = (s: string) => s.replace(/ /g, " ");

describe("шкала хода сделки в «Подробнее о заказе»", () => {
  it("оферта, оплата, работа, сдача, приёмка, выплата — по статусу и подписи оферты", () => {
    expect(dealStep("CREATED", false)).toBe(0);
    expect(dealStep("CREATED", true)).toBe(1);
    expect(dealStep("PAID_HOLD", true)).toBe(2);
    expect(dealStep("IN_PROGRESS", true)).toBe(3);
    expect(dealStep("READY", true)).toBe(4);
    expect(dealStep("ACCEPTED", true)).toBe(5);
    expect(dealStep("SPLIT_PAYOUT", true)).toBe(5);
  });

  it("отменённая сделка и возврат — без шкалы", () => {
    expect(dealStep("CANCELLED", false)).toBeNull();
    expect(dealStep("REFUNDED", true)).toBeNull();
  });
});

describe("смета до оплаты (ТЗ п. 5)", () => {
  it("покупатель: стоимость заказа, защита сделки 2%, итого к оплате", () => {
    const rows = estimateRows({ party: "CLIENT", priceTiyn: 10_000_000n, extraTiyn: 200_000n, totalTiyn: 10_200_000n });
    expect(rows.map((r) => [r.label, plain(r.value), r.total])).toEqual([
      ["Стоимость заказа", "100 000 ₸", false],
      ["Защита сделки (2%)", "2 000 ₸", false],
      ["Итого к оплате", "102 000 ₸", true],
    ]);
  });

  it("мастер: сумма заказа, гарантия оплаты 4%, к выплате", () => {
    const rows = estimateRows({ party: "EXECUTOR", priceTiyn: 10_000_000n, extraTiyn: 400_000n, totalTiyn: 9_600_000n });
    expect(rows.map((r) => [r.label, plain(r.value)])).toEqual([
      ["Сумма заказа", "100 000 ₸"],
      ["Гарантия оплаты (4%)", "−4 000 ₸"],
      ["К выплате", "96 000 ₸"],
    ]);
  });
});

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
