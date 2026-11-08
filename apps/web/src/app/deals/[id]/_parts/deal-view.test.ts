import { describe, expect, it } from "vitest";
import { GeolocationError } from "@/app/_components/geolocation";
import { ru } from "@/i18n/ru";
import { disputeFacts, estimateRows, gpsNote, heroImage, needsPosition, orderFacts, readyFarWarning, readyWaitText } from "./deal-view";

const plain = (s: string) => s.replace(/ /g, " ");

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
      ["Гарантия оплаты и клиента (4%)", "−4 000 ₸"],
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

describe("«Подробнее о заказе» — строки фактов", () => {
  const base = { executorLabel: "Исполнитель №7", city: null, plannedReadyAt: null, signedAt: null, durationDays: 30, warrantyMonths: 12 };

  it("покупатель видит мастера, мастер — покупателя; без дат — только срок и гарантия", () => {
    expect(orderFacts({ ...base, viewer: "CLIENT" }).map((f) => [f.label, plain(f.value)])).toEqual([
      ["Мастер", "Исполнитель №7"],
      ["Срок изготовления", "30 дней"],
      ["Гарантия", "12 месяцев"],
    ]);
    expect(orderFacts({ ...base, viewer: "EXECUTOR" })[0]).toEqual({ label: "Покупатель", value: "Покупатель" });
  });

  it("город, плановая готовность и дата оферты — когда известны", () => {
    const facts = orderFacts({ ...base, viewer: "OPERATOR", city: "Астана", plannedReadyAt: new Date("2026-12-10T07:00:00Z"), signedAt: new Date("2026-11-03T07:00:00Z") });
    expect(facts.map((f) => f.label)).toEqual(["Мастер", "Город", "Плановая готовность", "Срок изготовления", "Гарантия", "Оферта заключена"]);
    expect(facts[2]?.value).toBe("10 декабря 2026");
  });
});

describe("спор на карточке сделки", () => {
  const open = { reason: "QUALITY" as const, createdAt: new Date("2026-11-03T07:00:00Z"), description: "Фасады с зазором", clientPosition: "Переделать фасады", executorPosition: null, outcome: null, masterShareTiyn: null, rationale: null };

  it("открытый спор — причина, дата, описание и позиции (нет позиции — так и сказано)", () => {
    expect(disputeFacts(open).map((f) => [f.label, f.value])).toEqual([
      ["Причина спора", "Качество работы"],
      ["Открыт", "3 ноября 2026, 12:00"],
      ["Опишите ситуацию", "Фасады с зазором"],
      ["Позиция покупателя", "Переделать фасады"],
      ["Позиция мастера", "Позиция ещё не отправлена"],
    ]);
  });

  it("решённый частичным разделом — итог, доля мастера и обоснование", () => {
    const facts = disputeFacts({ ...open, outcome: "PARTIAL_SPLIT", masterShareTiyn: 5_000_000n, rationale: "Половина работ выполнена" });
    expect(facts.slice(5).map((f) => [f.label, plain(f.value)])).toEqual([
      ["Спор решён", "Частичный раздел"],
      ["Мастеру из цены заказа", "50 000 ₸"],
      ["Обоснование решения", "Половина работ выполнена"],
    ]);
  });

  it("форма позиции — стороне без своей позиции, пока спор открыт; оператору — никогда", () => {
    const d = { status: "OPEN" as const, clientPosition: "Есть", executorPosition: null };
    expect(needsPosition("CLIENT", d)).toBe(false);
    expect(needsPosition("EXECUTOR", d)).toBe(true);
    expect(needsPosition("OPERATOR", d)).toBe(false);
    expect(needsPosition("EXECUTOR", { ...d, status: "RESOLVED" })).toBe(false);
  });
});
