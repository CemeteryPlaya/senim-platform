import { describe, expect, it } from "vitest";
import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { AuditView } from "@/modules/operator";
import type { MoneyBlock, MoneyHistoryItem } from "@/modules/payments";
import { disputeMoney, disputeTone, historyTimeline, moneyTimeline, openedLine } from "./dispute-view";
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

  it("тестовые деньги — без примечания в панели: тестовую сделку называет провайдер в «Сторонах»", () => {
    expect(disputeMoney({ kind: "frozen", amountTiyn: 1n, frozenAt: at, bankBalanceTiyn: 1n, isTest: true })).not.toHaveProperty("note");
  });
});

describe("ленты", () => {
  it("журнал денег: тип и статус, сумма в тиынах; пометки «тестовая» у операции нет (её называет провайдер сделки)", () => {
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
    expect(test).toMatchObject({ title: `${m.types.FREEZE}, ${m.status.PENDING}` });
    expect(test?.text).toBeUndefined();
  });

  it("история сделки: название события из текстов сделки, неизвестный код — как есть; время и автор одной строкой, без сущности", () => {
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
    expect(known).toMatchObject({ title: ru.deal.history.action["dispute.opened"], time: `${formatDateTime(at)} · ${ru.deal.history.actor.CLIENT}` });
    expect(known).not.toHaveProperty("text");
    expect(unknown).toMatchObject({ title: "some.new_code", time: `${formatDateTime(at)} · ROBOT` });
    const [signing, masked] = historyTimeline([event("document.signing.started", "EXECUTOR"), event("chat.contacts_masked", "SYSTEM")]);
    expect(signing?.title).toBe("Сторона начала подпись документа");
    expect(masked?.title).toBe(ru.app.operatorDeals.audit.actions["chat.contacts_masked"]);
  });
});

describe("мелочи экрана", () => {
  it("открытый спор — warn, решённый — нейтрально", () => {
    expect(disputeTone("OPEN")).toBe("warn");
    expect(disputeTone("RESOLVED")).toBe("neutral");
  });

  it("строка «с …»: только дата, пока этап тот же (его говорит чип); сделка ушла дальше — этап при открытии строчными", () => {
    expect(openedLine(at, "READY", "READY")).toBe("С 10 ноября 2026");
    expect(openedLine(at, "IN_PROGRESS", "READY")).toBe(`С 10 ноября 2026. Этап при открытии: ${ru.app.operatorDisputes.dealStatus.IN_PROGRESS.toLowerCase()}`);
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
