import { describe, expect, it } from "vitest";
import { MASK } from "@/modules/companies";
import { db } from "@/platform/db";
import { actingAs, makeClient, makeExecutor } from "../../../test/factories";
import { makeOpenRequest, offerInput } from "../../../test/factories/requests";
import {
  cancelRequest,
  declineInvitation,
  getIncomingRequest,
  INVITATIONS_PER_REQUEST,
  inviteExecutor,
  listIncomingRequests,
  listInvitations,
  sendOffer,
} from "./index";

/**
 * Приглашения: покупатель зовёт мастера своей ценовой группы к своему открытому заказу-тендеру. Приглашение не открывает
 * заказ мастеру (видимость прежняя); мастер отвечает откликом (OFFERED) или отказом с причиной (DECLINED, окончательно).
 */

const code = (c: string) => expect.objectContaining({ code: c });
const key = () => crypto.randomUUID();

async function setup(segment: "ECONOMY" | "COMFORT" | "PREMIUM" = "COMFORT") {
  const client = await makeClient();
  const requestId = await makeOpenRequest(client, { segment });
  const master = await makeExecutor({ segment });
  return { client, requestId, master };
}

describe("приглашение мастера", () => {
  it("создаёт приглашение, уведомляет мастера и пишет аудит", async () => {
    const { client, requestId, master } = await setup();

    const r = await inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber, clientKey: key() });

    expect(r.created).toBe(true);
    expect(await db.requestInvitation.findUniqueOrThrow({ where: { id: r.invitationId } })).toMatchObject({
      requestId,
      executorId: master.executor.id,
      status: "INVITED",
      reason: null,
      decidedAt: null,
    });
    const note = await db.notification.findFirstOrThrow({ where: { userId: master.id, kind: "request.invited" } });
    expect(note.link).toBe(`/executor/requests/${requestId}`);
    expect(note.body).not.toMatch(/заказчик|клиент|отклик|платформ/i);
    expect(await db.auditEvent.count({ where: { scope: `request:${requestId}`, action: "request.invitation.sent" } })).toBe(1);
  });

  it("чужой заказ — «не найдено», чужая роль — запрещено", async () => {
    const { requestId, master } = await setup();
    const stranger = await makeClient();

    await expect(inviteExecutor(stranger, { requestId, publicNumber: master.executor.publicNumber })).rejects.toThrow(code("NOT_FOUND"));
    await expect(inviteExecutor(master, { requestId, publicNumber: master.executor.publicNumber })).rejects.toThrow(code("FORBIDDEN"));
    expect(await db.requestInvitation.count({ where: { requestId } })).toBe(0);
  });

  it("заказ не OPEN — отказ", async () => {
    const { client, requestId, master } = await setup();
    await cancelRequest(client, { requestId });

    await expect(inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber })).rejects.toThrow(code("CONFLICT"));
    expect(await db.requestInvitation.count({ where: { requestId } })).toBe(0);
  });

  it("не тендер (прямой запрос) и не путь ТЗ — отказ", async () => {
    const { client, requestId, master } = await setup();
    await db.request.update({ where: { id: requestId }, data: { mode: "DIRECT", targetExecutorId: master.executor.id } });
    await expect(inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber })).rejects.toThrow(code("CONFLICT"));

    await db.request.update({ where: { id: requestId }, data: { mode: "TENDER", targetExecutorId: null, preContractFlow: "CONTRACT_FIRST" } });
    await expect(inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber })).rejects.toThrow(code("CONFLICT"));
    expect(await db.requestInvitation.count({ where: { requestId } })).toBe(0);
  });

  it("мастер другой ценовой группы — VALIDATION otherSegment, приглашения нет", async () => {
    const { client, requestId } = await setup("COMFORT");
    const premium = await makeExecutor({ segment: "PREMIUM" });

    await expect(inviteExecutor(client, { requestId, publicNumber: premium.executor.publicNumber })).rejects.toMatchObject({
      code: "VALIDATION",
      details: { reason: "otherSegment" },
    });
    expect(await db.requestInvitation.count({ where: { requestId } })).toBe(0);
  });

  it("мастер не найден, не подтверждён или заблокирован — «не найдено»", async () => {
    const { client, requestId } = await setup();
    const pending = await makeExecutor({ segment: "COMFORT", status: "PENDING" });
    const blocked = await makeExecutor({ segment: "COMFORT" });
    await db.user.update({ where: { id: blocked.id }, data: { blockedAt: new Date() } });

    await expect(inviteExecutor(client, { requestId, publicNumber: 2_000_000_000 })).rejects.toThrow(code("NOT_FOUND"));
    await expect(inviteExecutor(client, { requestId, publicNumber: pending.executor.publicNumber })).rejects.toThrow(code("NOT_FOUND"));
    await expect(inviteExecutor(client, { requestId, publicNumber: blocked.executor.publicNumber })).rejects.toThrow(code("NOT_FOUND"));
  });

  it("самого себя пригласить нельзя", async () => {
    const me = await makeExecutor({ segment: "COMFORT", roles: ["EXECUTOR", "CLIENT"] });
    const client = actingAs(me, "CLIENT");
    const requestId = await makeOpenRequest(client, { segment: "COMFORT" });

    await expect(inviteExecutor(client, { requestId, publicNumber: me.executor.publicNumber })).rejects.toMatchObject({
      code: "VALIDATION",
      details: { reason: "selfInvite" },
    });
    expect(await db.requestInvitation.count({ where: { requestId } })).toBe(0);
  });

  it("повтор — тот же ответ без второй записи, уведомления и аудита", async () => {
    const { client, requestId, master } = await setup();
    const first = await inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber, clientKey: key() });

    const again = await inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber, clientKey: key() });

    expect(again).toEqual({ invitationId: first.invitationId, created: false });
    expect(await db.requestInvitation.count({ where: { requestId } })).toBe(1);
    expect(await db.notification.count({ where: { userId: master.id, kind: "request.invited" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { scope: `request:${requestId}`, action: "request.invitation.sent" } })).toBe(1);
  });

  it("одновременные два приглашения одного мастера — одна запись, один created", async () => {
    const { client, requestId, master } = await setup();

    const results = await Promise.all([
      inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber, clientKey: key() }),
      inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber, clientKey: key() }),
    ]);

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.invitationId)).size).toBe(1);
    expect(await db.requestInvitation.count({ where: { requestId } })).toBe(1);
    expect(await db.notification.count({ where: { userId: master.id, kind: "request.invited" } })).toBe(1);
  });

  it("11-е приглашение — CONFLICT invitationsLimit; повтор уже приглашённого при полном лимите — не ошибка", async () => {
    const { client, requestId } = await setup();
    const masters = [];
    for (let i = 0; i <= INVITATIONS_PER_REQUEST; i++) masters.push(await makeExecutor({ segment: "COMFORT" }));
    for (const m of masters.slice(0, INVITATIONS_PER_REQUEST)) await inviteExecutor(client, { requestId, publicNumber: m.executor.publicNumber });

    await expect(inviteExecutor(client, { requestId, publicNumber: masters[INVITATIONS_PER_REQUEST]!.executor.publicNumber })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "invitationsLimit" },
    });
    expect(await db.requestInvitation.count({ where: { requestId } })).toBe(INVITATIONS_PER_REQUEST);
    expect(await inviteExecutor(client, { requestId, publicNumber: masters[0]!.executor.publicNumber })).toMatchObject({ created: false });
  });

  it("два параллельных приглашения при девяти уже отправленных — десять записей, второе отказано", async () => {
    const { client, requestId } = await setup();
    const masters = [];
    for (let i = 0; i < INVITATIONS_PER_REQUEST + 1; i++) masters.push(await makeExecutor({ segment: "COMFORT" }));
    for (const m of masters.slice(0, INVITATIONS_PER_REQUEST - 1)) await inviteExecutor(client, { requestId, publicNumber: m.executor.publicNumber });

    const last = masters.slice(INVITATIONS_PER_REQUEST - 1);
    const settled = await Promise.allSettled(last.map((m) => inviteExecutor(client, { requestId, publicNumber: m.executor.publicNumber })));

    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(await db.requestInvitation.count({ where: { requestId } })).toBe(INVITATIONS_PER_REQUEST);
  });

  it("приглашение не открывает заказ: мастер другой группы не видит его, и после отказа в приглашении", async () => {
    const { client, requestId, master } = await setup("COMFORT");
    await inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber });
    const premium = await makeExecutor({ segment: "PREMIUM" });

    await expect(inviteExecutor(client, { requestId, publicNumber: premium.executor.publicNumber })).rejects.toThrow(code("VALIDATION"));
    expect(await listIncomingRequests(premium)).toEqual([]);
    await expect(getIncomingRequest(premium, requestId)).rejects.toThrow(code("NOT_FOUND"));
    await expect(sendOffer(premium, offerInput(requestId))).rejects.toThrow(code("NOT_FOUND"));
  });
});

describe("ответ мастера на приглашение", () => {
  it("отказ: причина через маску контактов, DECLINED, уведомление покупателю без SMS, аудит", async () => {
    const { client, requestId, master } = await setup();
    await inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber });

    await declineInvitation(master, { requestId, reason: "  Занят до весны, звоните +7 701 123 45 67  " });

    const row = await db.requestInvitation.findFirstOrThrow({ where: { requestId, executorId: master.executor.id } });
    expect(row.status).toBe("DECLINED");
    expect(row.decidedAt).not.toBeNull();
    expect(row.reason).toContain("Занят до весны");
    expect(row.reason).toContain(MASK);
    expect(row.reason).not.toMatch(/701|123/);
    const note = await db.notification.findFirstOrThrow({ where: { userId: client.id, kind: "request.invitation_declined" } });
    expect(note.link).toBe(`/requests/${requestId}`);
    expect(note.body).toContain("Занят до весны");
    expect(await db.auditEvent.count({ where: { scope: `request:${requestId}`, action: "request.invitation.declined" } })).toBe(1);
    expect(await db.job.count({ where: { kind: "notifications.sendSms", payload: { path: ["notificationId"], equals: note.id } } })).toBe(0);
  });

  it("причина: короче 3 и длиннее 300 знаков — VALIDATION; без приглашения — «не найдено»", async () => {
    const { client, requestId, master } = await setup();
    await inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber });
    const other = await makeExecutor({ segment: "COMFORT" });

    await expect(declineInvitation(master, { requestId, reason: " ок " })).rejects.toThrow(code("VALIDATION"));
    await expect(declineInvitation(master, { requestId, reason: "я".repeat(301) })).rejects.toThrow(code("VALIDATION"));
    await expect(declineInvitation(other, { requestId, reason: "Нет времени" })).rejects.toThrow(code("NOT_FOUND"));
    await expect(declineInvitation(client, { requestId, reason: "Нет времени" })).rejects.toThrow(code("FORBIDDEN"));
    expect((await db.requestInvitation.findFirstOrThrow({ where: { requestId } })).status).toBe("INVITED");
  });

  it("повторный отказ — CONFLICT; DECLINED окончателен", async () => {
    const { client, requestId, master } = await setup();
    await inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber });
    await declineInvitation(master, { requestId, reason: "Нет времени" });

    await expect(declineInvitation(master, { requestId, reason: "Нет времени" })).rejects.toThrow(code("CONFLICT"));
    expect(await db.notification.count({ where: { userId: client.id, kind: "request.invitation_declined" } })).toBe(1);
  });

  it("отклик приглашённого мастера переводит приглашение в OFFERED", async () => {
    const { client, requestId, master } = await setup();
    await inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber });

    await sendOffer(master, offerInput(requestId));

    const row = await db.requestInvitation.findFirstOrThrow({ where: { requestId } });
    expect(row.status).toBe("OFFERED");
    expect(row.decidedAt).not.toBeNull();
    await expect(declineInvitation(master, { requestId, reason: "Передумал" })).rejects.toThrow(code("CONFLICT"));
  });

  it("после отказа мастер всё же может откликнуться обычным путём; приглашение остаётся DECLINED", async () => {
    const { client, requestId, master } = await setup();
    await inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber });
    await declineInvitation(master, { requestId, reason: "Нет времени" });

    await sendOffer(master, offerInput(requestId));

    expect((await db.requestInvitation.findFirstOrThrow({ where: { requestId } })).status).toBe("DECLINED");
  });

  it("признак invited во входящих: INVITED и OFFERED — да, DECLINED и без приглашения — нет", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
    const invited = await makeExecutor({ segment: "COMFORT" });
    const offered = await makeExecutor({ segment: "COMFORT" });
    const declined = await makeExecutor({ segment: "COMFORT" });
    const plain = await makeExecutor({ segment: "COMFORT" });
    for (const m of [invited, offered, declined]) await inviteExecutor(client, { requestId, publicNumber: m.executor.publicNumber });
    await sendOffer(offered, offerInput(requestId));
    await declineInvitation(declined, { requestId, reason: "Нет времени" });

    const flags = async (m: typeof invited) => ({
      list: (await listIncomingRequests(m)).find((r) => r.id === requestId)?.invited,
      one: (await getIncomingRequest(m, requestId)).invited,
    });
    expect(await flags(invited)).toEqual({ list: true, one: true });
    expect(await flags(offered)).toEqual({ list: true, one: true });
    expect(await flags(declined)).toEqual({ list: false, one: false });
    expect(await flags(plain)).toEqual({ list: false, one: false });
  });
});

describe("список приглашений", () => {
  it("только владелец заявки; имя — по режиму ADR-006, причина уже в маске", async () => {
    const { client, requestId, master } = await setup();
    const second = await makeExecutor({ segment: "COMFORT", legalName: "ИП Секретный Мастер" });
    await inviteExecutor(client, { requestId, publicNumber: master.executor.publicNumber });
    await inviteExecutor(client, { requestId, publicNumber: second.executor.publicNumber });
    await declineInvitation(second, { requestId, reason: "Нет времени, пишите +7 701 123 45 67" });

    const list = await listInvitations(client, requestId);

    expect(list.map((i) => [i.publicNumber, i.status]).sort()).toEqual(
      [
        [master.executor.publicNumber, "INVITED"],
        [second.executor.publicNumber, "DECLINED"],
      ].sort(),
    );
    expect(JSON.stringify(list)).not.toContain("Секретный");
    expect(JSON.stringify(list)).not.toMatch(/701/);
    expect(list.find((i) => i.status === "DECLINED")?.reason).toContain("Нет времени");
    await expect(listInvitations(await makeClient(), requestId)).rejects.toThrow(code("NOT_FOUND"));
    await expect(listInvitations(master, requestId)).rejects.toThrow(code("FORBIDDEN"));
  });
});
