import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeOfferThread } from "../../../test/factories/companies";
import { getChat, revokeClientPhone, sendMessage, shareClientPhone } from "./index";

/**
 * Телефон заказчика исполнителю (ответ №21, ADR-008): по согласию заказчика и только после
 * переписки в чате отклика. Видит только исполнитель этого отклика, пока согласие действует.
 */
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));
const digits = (phone: string) => phone.replace(/\D/g, "");

/** Отклик, где заказчик и исполнитель уже обменялись сообщениями. */
async function talkedThread(opts: Parameters<typeof makeOfferThread>[0] = {}) {
  const t = await makeOfferThread(opts);
  await sendMessage(t.executor, t.offerId, "Здравствуйте! Когда удобно приехать на замер?", []);
  await sendMessage(t.client, t.offerId, "Добрый день, в субботу после обеда", []);
  return t;
}

const sharedAudit = (offerId: string) => db.auditEvent.findMany({ where: { entityId: offerId, action: { startsWith: "offer.client_phone" } } });

afterEach(() => vi.restoreAllMocks());

describe("показать телефон: правило «поговорили»", () => {
  it("без переписки показать нельзя, кнопки нет", async () => {
    const t = await makeOfferThread();
    expect((await getChat(t.client, t.offerId)).clientPhone).toBeNull();
    expect(await code(shareClientPhone(t.client, t.offerId))).toBe("CONFLICT");
  });

  it("писал только один — нельзя; ответила вторая сторона — можно", async () => {
    const t = await makeOfferThread();
    await sendMessage(t.client, t.offerId, "Здравствуйте!", []);
    await sendMessage(t.client, t.offerId, "Вы тут?", []);
    expect(await code(shareClientPhone(t.client, t.offerId))).toBe("CONFLICT");
    expect((await getChat(t.client, t.offerId)).clientPhone).toBeNull();

    await sendMessage(t.executor, t.offerId, "Да, добрый день", []);
    expect((await getChat(t.client, t.offerId)).clientPhone).toEqual({ for: "client", shared: false });
    expect(await code(shareClientPhone(t.client, t.offerId))).toBe("OK");
  });
});

describe("показать телефон: кто видит", () => {
  it("после согласия номер видит только исполнитель этого отклика; журнал и уведомление — без номера", async () => {
    const t = await talkedThread();
    const rival = await makeExecutor();
    const rivalOffer = await db.offer.create({
      data: { requestId: t.requestId, executorId: rival.executor.id, price: 800_000, durationDays: 15, warrantyMonths: 12, measurementTerms: "FREE" },
    });
    const operator = await makeOperator();
    expect((await getChat(t.executor, t.offerId)).clientPhone).toBeNull();

    await shareClientPhone(t.client, t.offerId);

    expect((await getChat(t.executor, t.offerId)).clientPhone).toEqual({ for: "executor", phone: t.client.phone, display: expect.any(String) });
    expect((await getChat(t.client, t.offerId)).clientPhone).toEqual({ for: "client", shared: true });
    expect((await getChat(rival, rivalOffer.id)).clientPhone).toBeNull();
    expect((await getChat(operator, t.offerId)).clientPhone).toBeNull();
    expect(await code(getChat(rival, t.offerId))).toBe("NOT_FOUND");

    const [audit] = await sharedAudit(t.offerId);
    expect(audit).toMatchObject({ action: "offer.client_phone_shared", actorId: t.client.id, actorRole: "CLIENT", entityType: "offer", scope: `request:${t.requestId}` });
    expect(JSON.stringify(audit, (_, v: unknown) => (typeof v === "bigint" ? String(v) : v))).not.toContain(digits(t.client.phone));
    const notice = await db.notification.findFirstOrThrow({ where: { kind: "offer.client_phone_shared" } });
    expect(notice.userId).toBe(t.executor.id);
    expect(notice.title).toBe("Заказчик открыл вам свой телефон");
    expect(`${notice.title} ${notice.body}`).not.toContain(digits(t.client.phone).slice(-7));
  });

  it("в сделке номер тоже виден исполнителю (тот же чат отклика)", async () => {
    const t = await talkedThread({ dealStatus: "IN_PROGRESS", requestStatus: "CLOSED" });
    await shareClientPhone(t.client, t.offerId);
    expect((await getChat(t.executor, t.offerId)).clientPhone).toMatchObject({ for: "executor", phone: t.client.phone });
    expect((await sharedAudit(t.offerId))[0]?.scope).toBe(`deal:${t.dealId}`);
  });

  it("скрыть — номер исчезает у исполнителя; показать снова можно", async () => {
    const t = await talkedThread();
    await shareClientPhone(t.client, t.offerId);

    await revokeClientPhone(t.client, t.offerId);

    expect((await getChat(t.executor, t.offerId)).clientPhone).toBeNull();
    expect((await getChat(t.client, t.offerId)).clientPhone).toEqual({ for: "client", shared: false });
    expect((await db.offer.findUniqueOrThrow({ where: { id: t.offerId } })).clientPhoneSharedAt).toBeNull();
    expect((await sharedAudit(t.offerId)).map((a) => a.action).sort()).toEqual(["offer.client_phone_revoked", "offer.client_phone_shared"]);
    expect(await code(shareClientPhone(t.client, t.offerId))).toBe("OK");
  });
});

describe("показать телефон: доступ", () => {
  it("исполнитель и оператор — FORBIDDEN; чужой заказчик и чужой исполнитель — NOT_FOUND; состояние не меняется", async () => {
    const t = await talkedThread();
    expect(await code(shareClientPhone(t.executor, t.offerId))).toBe("FORBIDDEN");
    expect(await code(shareClientPhone(await makeOperator(), t.offerId))).toBe("FORBIDDEN");
    expect(await code(shareClientPhone(await makeClient(), t.offerId))).toBe("NOT_FOUND");
    expect(await code(shareClientPhone(await makeExecutor(), t.offerId))).toBe("NOT_FOUND");
    expect(await code(shareClientPhone(t.client, "nope"))).toBe("NOT_FOUND");

    await shareClientPhone(t.client, t.offerId);
    expect(await code(revokeClientPhone(t.executor, t.offerId))).toBe("FORBIDDEN");
    expect(await code(revokeClientPhone(await makeClient(), t.offerId))).toBe("NOT_FOUND");
    expect((await db.offer.findUniqueOrThrow({ where: { id: t.offerId } })).clientPhoneSharedAt).not.toBeNull();
    expect(await sharedAudit(t.offerId)).toHaveLength(1);
  });

  it.each([
    ["отклик отозван", { offerStatus: "WITHDRAWN" }],
    ["отклик отклонён", { offerStatus: "DECLINED" }],
    ["заявка отменена", { requestStatus: "CANCELLED" }],
  ] as const)("%s — показать нельзя (CONFLICT)", async (_, closed) => {
    const t = await talkedThread();
    await db.offer.update({ where: { id: t.offerId }, data: { status: "offerStatus" in closed ? closed.offerStatus : undefined } });
    if ("requestStatus" in closed) await db.request.update({ where: { id: t.requestId }, data: { status: closed.requestStatus } });

    expect(await code(shareClientPhone(t.client, t.offerId))).toBe("CONFLICT");
    expect((await getChat(t.client, t.offerId)).clientPhone).toBeNull();
  });

  it("показанный номер скрывается, когда отклик отклонён или чат закрыт оператором; заказчик может скрыть его и тогда", async () => {
    const t = await talkedThread();
    await shareClientPhone(t.client, t.offerId);

    await db.offer.update({ where: { id: t.offerId }, data: { status: "DECLINED" } });

    expect((await getChat(t.executor, t.offerId)).clientPhone).toBeNull();
    expect((await getChat(t.client, t.offerId)).clientPhone).toEqual({ for: "client", shared: true });
    expect(await code(revokeClientPhone(t.client, t.offerId))).toBe("OK");
  });
});

describe("показать телефон: повтор и двойной клик", () => {
  it("повтор — CONFLICT; двойной клик — один успех и одна запись в журнале", async () => {
    const t = await talkedThread();

    const sharing = await Promise.allSettled([shareClientPhone(t.client, t.offerId), shareClientPhone(t.client, t.offerId)]);
    expect(sharing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await code(shareClientPhone(t.client, t.offerId))).toBe("CONFLICT");

    const revoking = await Promise.allSettled([revokeClientPhone(t.client, t.offerId), revokeClientPhone(t.client, t.offerId)]);
    expect(revoking.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await code(revokeClientPhone(t.client, t.offerId))).toBe("CONFLICT");

    expect(await db.auditEvent.count({ where: { action: "offer.client_phone_shared" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "offer.client_phone_revoked" } })).toBe(1);
    expect(await db.notification.count({ where: { kind: "offer.client_phone_shared" } })).toBe(1);
  });
});

describe("показать телефон: номер не попадает в логи", () => {
  it("весь путь, включая отказы, не пишет номер в консоль", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    for (const method of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, method).mockImplementation(capture);

    const t = await talkedThread();
    await code(shareClientPhone(t.executor, t.offerId));
    await shareClientPhone(t.client, t.offerId);
    await code(shareClientPhone(t.client, t.offerId));
    await getChat(t.executor, t.offerId);
    await revokeClientPhone(t.client, t.offerId);

    expect(lines.join("\n")).not.toContain(digits(t.client.phone).slice(-7));
    vi.unstubAllEnvs();
  });
});
