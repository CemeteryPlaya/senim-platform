import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { AuditView } from "@/modules/operator";
import type { MoneyBlock, MoneyHistoryItem } from "@/modules/payments";
import { disputeMoney, disputeTone, entityLabel, historyTimeline, moneyTimeline, openedLine } from "./dispute-view";
import { hoursOptions } from "../requests/hours";
import { previewState } from "./[id]/preview";

const m = ru.app.operatorDisputes.money;
const bank = { bankBalanceTiyn: 12_000_00n, isTest: false };
const at = new Date("2026-11-10T10:00:00+05:00");

describe("disputeMoney: блок денег по журналу", () => {
  const cases: [string, MoneyBlock, { tone: string; title: string; amount: bigint }][] = [
    ["оплаты нет", { kind: "awaiting", payment: "none", ...bank }, { tone: "awaiting", title: m.awaiting, amount: 0n }],
    ["деньги под защитой", { kind: "protected", amountTiyn: 1_000_00n, reservedAt: at, operationRef: null, ...bank }, { tone: "protected", title: m.protected, amount: 1_000_00n }],
    ["выплата заморожена", { kind: "frozen", amountTiyn: 2_000_00n, frozenAt: at, ...bank }, { tone: "frozen", title: m.frozen, amount: 2_000_00n }],
    [
      "выплачено мастеру",
      { kind: "completed", paidToMasterTiyn: 3_000_00n, protectionTiyn: 0n, refundedTiyn: 0n, settled: true, completedAt: at, ...bank },
      { tone: "completed", title: m.completed, amount: 3_000_00n },
    ],
    [
      "выплата ждёт банка",
      { kind: "completed", paidToMasterTiyn: 3_000_00n, protectionTiyn: 0n, refundedTiyn: 0n, settled: false, completedAt: null, ...bank },
      { tone: "completed", title: m.completedPending, amount: 3_000_00n },
    ],
    ["возврат ждёт банка", { kind: "refunded", amountTiyn: 4_000_00n, settled: false, refundedAt: null, ...bank }, { tone: "refunded", title: m.refundedPending, amount: 4_000_00n }],
  ];

  it.each(cases)("%s", (_name, block, expected) => {
    expect(disputeMoney(block)).toMatchObject({ ...expected, rows: [{ label: m.bankBalance, amount: 12_000_00n }] });
  });

  it("тестовые деньги — пометка только в панели оператора", () => {
    expect(disputeMoney({ kind: "frozen", amountTiyn: 1n, frozenAt: at, bankBalanceTiyn: 1n, isTest: true }).note).toBe(m.test);
    expect(disputeMoney({ kind: "frozen", amountTiyn: 1n, frozenAt: at, ...bank }).note).toBeUndefined();
  });
});

describe("ленты", () => {
  it("журнал денег: тип и статус, сумма в тиынах, пометка «тестовая» только у тестовой операции", () => {
    const item = (over: Partial<MoneyHistoryItem>): MoneyHistoryItem => ({
      id: "1",
      type: "HOLD",
      status: "SUCCEEDED",
      amountTiyn: 500_00n,
      at,
      basisDocumentId: null,
      operationRef: null,
      isTest: false,
      ...over,
    });
    const [plain, test] = moneyTimeline([item({}), item({ id: "2", type: "FREEZE", status: "PENDING", isTest: true })]);
    expect(plain).toMatchObject({ title: `${m.types.HOLD}, ${m.status.SUCCEEDED}`, amount: 500_00n });
    expect(plain?.text).toBeUndefined();
    expect(test).toMatchObject({ title: `${m.types.FREEZE}, ${m.status.PENDING}`, text: m.testMark });
  });

  it("история сделки: название события из текстов сделки, неизвестный код — как есть; автор и сущность по-русски, неизвестная сущность не показывается", () => {
    const event = (action: string, actorRole: string, entityType = "Dispute"): AuditView => ({
      seq: "1",
      createdAt: at,
      actorId: null,
      actorRole,
      action,
      entityType,
      entityId: "d1",
      scope: "deal:x",
      before: null,
      after: null,
      meta: null,
      ip: null,
      userAgent: null,
    });
    const [known, unknown] = historyTimeline([event("dispute.opened", "CLIENT"), event("some.new_code", "ROBOT", "SomethingNew")]);
    expect(known).toMatchObject({ title: ru.deal.history.action["dispute.opened"], text: `${ru.deal.history.actor.CLIENT} · спор` });
    expect(unknown).toMatchObject({ title: "some.new_code", text: "ROBOT" });
  });
});

describe("entityLabel: тип записи журнала по-русски", () => {
  it("известные типы — словом (регистр и «_» не важны); неизвестный — null, сырое имя не показывается", () => {
    expect(entityLabel("Dispute")).toBe("спор");
    expect(entityLabel("deal")).toBe("сделка");
    expect(entityLabel("MoneyTransaction")).toBe("операция с деньгами");
    expect(entityLabel("money_transaction")).toBe("операция с деньгами");
    expect(entityLabel("SomethingNew")).toBeNull();
  });
});

describe("мелочи экрана", () => {
  it("открытый спор — warn, решённый — нейтрально", () => {
    expect(disputeTone("OPEN")).toBe("warn");
    expect(disputeTone("RESOLVED")).toBe("neutral");
  });

  it("строка «открыт …»: дата и этап сделки со строчной буквы", () => {
    expect(openedLine(at, "IN_PROGRESS")).toBe(`Открыт 10 ноября 2026. Этап сделки при открытии: ${ru.app.operatorDisputes.dealStatus.IN_PROGRESS.toLowerCase()}`);
  });
});

describe("previewState: расчёт раздела актуален, только пока сумма в поле та же", () => {
  const preview = { shareTiyn: 60_000_00n, masterTiyn: 1n, platformTiyn: 2n, refundTiyn: 3n };
  it("нет расчёта, свежий, устаревший (сумму правили, очистили)", () => {
    expect(previewState(null, 60_000_00n)).toBe("none");
    expect(previewState(preview, 60_000_00n)).toBe("fresh");
    expect(previewState(preview, 61_000_00n)).toBe("stale");
    expect(previewState(preview, null)).toBe("stale");
  });
});

describe("hoursOptions: чипы фильтра часов", () => {
  const values = (current: number) => hoursOptions(current).map((o) => o.value);
  it("сутки — без параметра в адресе; остальные — своим значением", () => {
    expect(values(24)).toEqual([null, "72", "168", "720"]);
    expect(values(72)).toEqual([null, "72", "168", "720"]);
  });
  it("значение не из списка — отдельный чип в конце", () => {
    expect(values(5)).toEqual([null, "72", "168", "720", "5"]);
    expect(hoursOptions(5).at(-1)?.label).toBe(ru.app.operatorDisputes.requests.custom(5));
  });
});
