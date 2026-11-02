import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeOfferThread } from "../../../test/factories/companies";
import { closeChat, getChat, reopenChat, sendMessage } from "./index";

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));
const REASON = "Сделка завершена, гарантийные вопросы — через поддержку";

/** Завершённая сделка: чат по умолчанию открыт (гарантия), закрывает его оператор (ответ №19). */
const completedDeal = () => makeOfferThread({ dealStatus: "SPLIT_PAYOUT", requestStatus: "CLOSED" });

describe("закрытие чата оператором (№19): разрешённые переходы", () => {
  it("после завершения сделки чат открыт; оператор закрывает — стороны только читают и видят причину", async () => {
    const t = await completedDeal();
    const operator = await makeOperator();
    expect((await getChat(t.client, t.offerId)).canWrite).toBe(true);

    await closeChat(operator, t.offerId, `  ${REASON}  `);

    for (const party of [t.client, t.executor]) {
      const chat = await getChat(party, t.offerId);
      expect(chat).toMatchObject({ canWrite: false, closedByOperator: { reason: REASON } });
      expect(await code(sendMessage(party, t.offerId, "Ещё вопрос", []))).toBe("CONFLICT");
    }
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "chat.closed" } })).toMatchObject({
      actorId: operator.id,
      actorRole: "OPERATOR",
      entityType: "offer",
      entityId: t.offerId,
      scope: `deal:${t.dealId}`,
      after: { reason: REASON },
    });
    const notices = await db.notification.findMany({ where: { kind: "chat.closed" } });
    expect(notices.map((n) => n.userId).sort()).toEqual([t.client.id, t.executor.id].sort());
  });

  it("оператор открывает чат снова — стороны снова пишут; в журнале — прежняя причина", async () => {
    const t = await completedDeal();
    const operator = await makeOperator();
    await closeChat(operator, t.offerId, REASON);

    await reopenChat(operator, t.offerId);

    const chat = await getChat(t.client, t.offerId);
    expect(chat).toMatchObject({ canWrite: true, closedByOperator: null });
    expect(await code(sendMessage(t.client, t.offerId, "Спасибо!", []))).toBe("OK");
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "chat.reopened" } })).toMatchObject({
      actorId: operator.id,
      before: { reason: REASON },
    });
    expect(await db.offer.findUniqueOrThrow({ where: { id: t.offerId } })).toMatchObject({ chatClosedAt: null, chatClosedReason: null });
  });

  it("закрыть можно и чат отклика до сделки; оператор видит кнопки управления, стороны — нет", async () => {
    const t = await makeOfferThread();
    const operator = await makeOperator();
    expect((await getChat(operator, t.offerId)).canModerate).toBe(true);
    expect((await getChat(t.client, t.offerId)).canModerate).toBe(false);

    await closeChat(operator, t.offerId, REASON);

    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "chat.closed" } })).toMatchObject({ scope: `request:${t.requestId}` });
  });
});

describe("закрытие чата оператором (№19): запрещённые переходы", () => {
  it("закрыть закрытый и открыть открытый — CONFLICT, без записей в журнал", async () => {
    const t = await completedDeal();
    const operator = await makeOperator();
    expect(await code(reopenChat(operator, t.offerId))).toBe("CONFLICT");
    await closeChat(operator, t.offerId, REASON);
    expect(await code(closeChat(operator, t.offerId, "Другая причина"))).toBe("CONFLICT");

    expect(await db.auditEvent.count({ where: { action: { in: ["chat.closed", "chat.reopened"] } } })).toBe(1);
    expect((await db.offer.findUniqueOrThrow({ where: { id: t.offerId } })).chatClosedReason).toBe(REASON);
  });

  it("стороны отклика не закрывают и не открывают чат; посторонние его не видят", async () => {
    const t = await completedDeal();
    const operator = await makeOperator();
    expect(await code(closeChat(t.client, t.offerId, REASON))).toBe("FORBIDDEN");
    expect(await code(closeChat(t.executor, t.offerId, REASON))).toBe("FORBIDDEN");
    expect(await code(closeChat(await makeClient(), t.offerId, REASON))).toBe("FORBIDDEN");

    await closeChat(operator, t.offerId, REASON);
    expect(await code(reopenChat(t.client, t.offerId))).toBe("FORBIDDEN");
    expect(await code(reopenChat(await makeExecutor(), t.offerId))).toBe("FORBIDDEN");
    expect((await db.offer.findUniqueOrThrow({ where: { id: t.offerId } })).chatClosedAt).not.toBeNull();
  });

  it("без причины или с неизвестным откликом — ошибка, состояние не меняется", async () => {
    const t = await completedDeal();
    const operator = await makeOperator();
    expect(await code(closeChat(operator, t.offerId, "  "))).toBe("VALIDATION");
    expect(await code(closeChat(operator, "nope", REASON))).toBe("NOT_FOUND");
    expect((await db.offer.findUniqueOrThrow({ where: { id: t.offerId } })).chatClosedAt).toBeNull();
  });

  it("двойной клик «Закрыть» и «Открыть снова» — ровно один успех и одна запись в журнале", async () => {
    const t = await completedDeal();
    const operator = await makeOperator();

    const closing = await Promise.allSettled([closeChat(operator, t.offerId, REASON), closeChat(operator, t.offerId, REASON)]);
    expect(closing.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const reopening = await Promise.allSettled([reopenChat(operator, t.offerId), reopenChat(operator, t.offerId)]);
    expect(reopening.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    expect(await db.auditEvent.count({ where: { action: "chat.closed" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "chat.reopened" } })).toBe(1);
  });
});
