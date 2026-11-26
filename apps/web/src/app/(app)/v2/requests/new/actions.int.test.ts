import { isRedirectError } from "next/dist/client/components/redirect-error";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import type { ActionResult } from "@/platform/action";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../../test/factories";
import { makeDraft, makeFurnitureType } from "../../../../../../test/factories/requests";

const session = vi.hoisted(() => ({ user: null as CurrentUser | null }));
vi.mock("@/modules/identity", async (original) => {
  const { fail } = await import("@/platform/errors");
  return {
    ...(await original<object>()),
    requireUser: async (...roles: string[]) => {
      if (!session.user) return fail.unauthenticated();
      if (roles.length > 0 && !roles.includes(session.user.role)) return fail.forbidden();
      return session.user;
    },
  };
});

const { saveStepAction, submitRequestAction } = await import("./actions");

/** Ответ действия или адрес, куда оно увело (redirect). */
async function run<T>(p: Promise<ActionResult<T>>): Promise<{ redirect: string } | ActionResult<T>> {
  try {
    return await p;
  } catch (e) {
    if (!isRedirectError(e)) throw e;
    return { redirect: e.digest.split(";")[2] };
  }
}

const start = (furnitureTypeId: string) => ({ screen: "start" as const, furnitureTypeId, customType: null, style: null, advanced: null });

beforeEach(() => {
  session.user = null;
});

describe("saveStepAction", () => {
  it("первый шаг создаёт черновик и ведёт на второй; без входа — UNAUTHENTICATED, мастер — FORBIDDEN", async () => {
    const type = await makeFurnitureType();
    expect(await run(saveStepAction({ requestId: null, step: start(type.id) }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    session.user = await makeExecutor();
    expect(await run(saveStepAction({ requestId: null, step: start(type.id) }))).toMatchObject({ ok: false, code: "FORBIDDEN" });

    session.user = await makeClient();
    const res = await run(saveStepAction({ requestId: null, step: start(type.id) }));
    const draft = await db.request.findFirstOrThrow({ where: { clientId: session.user.id } });
    expect(res).toEqual({ redirect: `/v2/requests/new?draft=${draft.id}&step=segment` });
    expect(draft).toMatchObject({ status: "DRAFT", mode: "TENDER", wizardStep: 1 });
  });

  it("повтор первого шага с тем же ключом — тот же черновик, переход туда же", async () => {
    const type = await makeFurnitureType();
    session.user = await makeClient();
    const clientKey = crypto.randomUUID();
    const a = await run(saveStepAction({ requestId: null, clientKey, step: start(type.id) }));
    const b = await run(saveStepAction({ requestId: null, clientKey, step: start(type.id) }));
    expect(b).toEqual(a);
    expect(await db.request.count({ where: { clientId: session.user.id } })).toBe(1);
  });

  it("прямая заявка по номеру мастера: черновик адресован ему", async () => {
    const executor = await makeExecutor();
    const type = await makeFurnitureType();
    session.user = await makeClient();
    await run(saveStepAction({ requestId: null, executor: executor.executor.publicNumber, step: start(type.id) }));
    expect(await db.request.findFirstOrThrow({ where: { clientId: session.user.id } })).toMatchObject({ mode: "DIRECT", targetExecutorId: executor.executor.id });
  });

  it("неверный шаг — ошибка ввода, черновика нет; повтор шага с черновиком — тот же черновик", async () => {
    session.user = await makeClient();
    expect(await run(saveStepAction({ requestId: null, step: { screen: "start", furnitureTypeId: null, customType: null, style: null, advanced: null } }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
    });
    expect(await db.request.count({ where: { clientId: session.user.id } })).toBe(0);

    const requestId = await makeDraft(session.user);
    const step = { screen: "segment" as const, segment: "PREMIUM" as const };
    const [a, b] = await Promise.all([run(saveStepAction({ requestId, step })), run(saveStepAction({ requestId, step }))]);
    expect(a).toEqual({ redirect: `/v2/requests/new?draft=${requestId}&step=room` });
    expect(b).toEqual(a);
    expect(await db.request.count({ where: { clientId: session.user.id } })).toBe(1);
    expect(await db.request.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ segment: "PREMIUM" });
  });

  it("«Назад» с шага фото (goto): шаг сохраняется, переход — на прошлый шаг", async () => {
    session.user = await makeClient();
    const requestId = await makeDraft(session.user);
    const res = await run(saveStepAction({ requestId, goto: "segment", step: { screen: "room", photoFileIds: [], description: "Нужна посудомойка" } }));
    expect(res).toEqual({ redirect: `/v2/requests/new?draft=${requestId}&step=segment` });
    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).details).toMatchObject({ description: "Нужна посудомойка" });
    expect(await run(saveStepAction({ requestId, goto: "nowhere" as "segment", step: { screen: "room", photoFileIds: [], description: "" } }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
    });
  });

  it("чужой черновик — не найден", async () => {
    const requestId = await makeDraft(await makeClient());
    session.user = await makeClient();
    expect(await run(saveStepAction({ requestId, step: { screen: "segment", segment: "ECONOMY" } }))).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("submitRequestAction", () => {
  it("отправляет заявку и ведёт на её карточку с отметкой; двойная отправка — одна заявка, одна запись в журнале", async () => {
    await makeExecutor({ segment: "COMFORT" });
    session.user = await makeClient();
    const requestId = await makeDraft(session.user, { segment: "COMFORT" });

    const results = await Promise.all([run(submitRequestAction({ requestId })), run(submitRequestAction({ requestId }))]);
    const card = { redirect: `/v2/requests/${requestId}?sent=1` };
    expect(results).toEqual([card, card]);
    // И позже, повтором запроса, — тот же итог.
    expect(await run(submitRequestAction({ requestId }))).toEqual(card);

    expect(await db.request.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: "OPEN" });
    expect(await db.auditEvent.count({ where: { action: "request.published", entityId: requestId } })).toBe(1);
    expect(await db.notification.count({ where: { kind: "request.new" } })).toBe(1);
  });

  it("незаполненный черновик — ошибка модуля, не уход; чужой — не найден", async () => {
    session.user = await makeClient();
    const type = await makeFurnitureType();
    await run(saveStepAction({ requestId: null, step: start(type.id) }));
    const draft = await db.request.findFirstOrThrow({ where: { clientId: session.user.id } });
    expect(await run(submitRequestAction({ requestId: draft.id }))).toMatchObject({ ok: false, code: "VALIDATION" });
    expect((await db.request.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");

    const foreign = await makeDraft(await makeClient());
    expect(await run(submitRequestAction({ requestId: foreign }))).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("прямая заявка мастеру, который больше не принимает заявки, — конфликт с текстом, заявка остаётся черновиком", async () => {
    const executor = await makeExecutor();
    session.user = await makeClient();
    const type = await makeFurnitureType();
    await run(saveStepAction({ requestId: null, executor: executor.executor.publicNumber, step: start(type.id) }));
    const { id } = await db.request.findFirstOrThrow({ where: { clientId: session.user.id } });
    for (const step of [
      { screen: "segment" as const, segment: "COMFORT" as const },
      { screen: "room" as const, photoFileIds: [], description: "" },
      { screen: "place" as const, city: "Астана", desiredDate: null },
    ]) {
      await run(saveStepAction({ requestId: id, step }));
    }
    await db.executorProfile.update({ where: { id: executor.executor.id }, data: { status: "REJECTED" } });

    // Текст отказа — словами экрана v2 («мастер», без «исполнителя»).
    expect(await run(submitRequestAction({ requestId: id }))).toMatchObject({ ok: false, code: "CONFLICT", error: ru.app.requests.wizard.errors.targetUnavailable });
    expect((await db.request.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
  });
});
