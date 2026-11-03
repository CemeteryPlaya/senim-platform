import { afterEach, describe, expect, it, vi } from "vitest";
import { db, transaction } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { getOwnPayout, payoutRecipientOf, setPayoutIban } from "./payout";

/** Реквизиты выплаты мастера: KZ IBAN зашифрован (encryptPii), в интерфейсе — последние 4, журнал — без значения. */
const IBAN = "KZ86125KZT5004100100";
const OTHER = "KZ75125KZT2069100100";
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));
const audit = (profileId: string) => db.auditEvent.findMany({ where: { entityId: profileId, action: "executor.payout_iban_changed" } });

afterEach(() => vi.restoreAllMocks());

describe("мастер указывает счёт для выплаты", () => {
  it("IBAN хранится зашифрованным, мастер видит последние 4", async () => {
    const executor = await makeExecutor();
    expect(await getOwnPayout(executor)).toEqual({ last4: null });

    expect(await setPayoutIban(executor, { iban: "kz86 125k zt50 0410 0100" })).toEqual({ last4: "0100" });

    const row = await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } });
    expect(row.payoutIbanLast4).toBe("0100");
    expect(row.payoutIbanEnc).not.toContain("KZ86");
    expect(row.payoutIbanEnc).not.toContain("5004100100");
    expect(await getOwnPayout(executor)).toEqual({ last4: "0100" });
  });

  it("смена — запись в журнале без значения; тот же IBAN ещё раз — без второй записи", async () => {
    const executor = await makeExecutor();
    await setPayoutIban(executor, { iban: IBAN });
    await setPayoutIban(executor, { iban: IBAN });
    await setPayoutIban(executor, { iban: OTHER });
    const events = await audit(executor.executor.id);
    expect(events.map((e) => [e.before, e.after])).toEqual([
      [{ set: false }, { set: true }],
      [{ set: true }, { set: true }],
    ]);
    const text = JSON.stringify(events.map((e) => [e.before, e.after, e.meta]));
    for (const part of ["KZ", "0100", "5004", "2069"]) expect(text).not.toContain(part);
  });

  it("указание и смена счёта — уведомление мастеру и операторам с последними 4; повтор того же — без уведомлений", async () => {
    const operator = await makeOperator();
    const executor = await makeExecutor();
    await setPayoutIban(executor, { iban: IBAN });
    await setPayoutIban(executor, { iban: IBAN });
    await setPayoutIban(executor, { iban: OTHER });
    const notes = await db.notification.findMany({ where: { kind: "executor.payout_iban_changed" }, orderBy: { createdAt: "asc" } });
    expect(notes.filter((x) => x.userId === executor.id).map((x) => x.title)).toEqual(["Счёт для выплаты указан", "Счёт для выплаты изменён"]);
    expect(notes.filter((x) => x.userId === operator.id)).toHaveLength(2);
    const text = JSON.stringify(notes.map((x) => [x.title, x.body]));
    expect(text).toContain("KZ… 0100");
    for (const part of ["KZ86", "KZ75", "5004", "2069"]) expect(text).not.toContain(part);
  });

  it("неверный IBAN — VALIDATION, прежний счёт не меняется", async () => {
    const executor = await makeExecutor();
    await setPayoutIban(executor, { iban: IBAN });
    expect(await code(setPayoutIban(executor, { iban: "KZ86125KZT5004100101" }))).toBe("VALIDATION");
    expect(await code(setPayoutIban(executor, { iban: "KZ86" }))).toBe("VALIDATION");
    expect(await getOwnPayout(executor)).toEqual({ last4: "0100" });
  });

  it("заказчик и оператор счёт мастера не задают и не читают — FORBIDDEN", async () => {
    for (const user of [await makeClient(), await makeOperator()]) {
      expect(await code(setPayoutIban(user, { iban: IBAN }))).toBe("FORBIDDEN");
      expect(await code(getOwnPayout(user))).toBe("FORBIDDEN");
    }
  });
});

describe("payoutRecipientOf — получатель выплаты для deal-core и payments", () => {
  it("расшифрованный IBAN и наименование; счёт не указан — iban: null", async () => {
    const executor = await makeExecutor({ legalName: "ИП «Дала»" });
    expect(await transaction((tx) => payoutRecipientOf(tx, executor.executor.id))).toEqual({ iban: null, name: "ИП «Дала»" });
    await setPayoutIban(executor, { iban: IBAN });
    expect(await transaction((tx) => payoutRecipientOf(tx, executor.executor.id))).toEqual({ iban: IBAN, name: "ИП «Дала»" });
  });

  it("IBAN не попадает в логи", async () => {
    const out = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    out.forEach((spy) => spy.mockImplementation(() => undefined));
    const executor = await makeExecutor();
    await setPayoutIban(executor, { iban: IBAN });
    await transaction((tx) => payoutRecipientOf(tx, executor.executor.id));
    const printed = out.flatMap((spy) => spy.mock.calls.flat()).map(String).join("\n");
    expect(printed).not.toContain("5004100100");
  });
});
