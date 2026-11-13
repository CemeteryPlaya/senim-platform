import { describe, expect, it } from "vitest";
import { disputeFacts, needsPosition, orderFacts } from "./facts";

const plain = (s: string) => s.replace(/ /g, " ");

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
