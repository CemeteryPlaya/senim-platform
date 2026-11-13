"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { geocodeAddress, geocodeSchema, getDraft, publishRequest, saveDraftSchema, saveDraftStep, WIZARD_SCREENS } from "@/modules/requests";
import { action } from "@/platform/action";
import { AppError, isAppError } from "@/platform/errors";
import { to } from "../../../_shell/paths";
import { nextScreen, v2Message, wizardHref } from "./steps";

// Действия мастера заявки v2 — обёртки над теми же функциями модуля requests, что у v1. Вход — схема модуля, первая
// строка — роль заказчика; права на черновик (свой ли, черновик ли) проверяет модуль. Тексты отказов модуля (словари v1:
// «исполнитель», «шаги мастера») экран v2 показывает своими словами (`v2Message`).

/** Отказ модуля с текстом экрана v2; код и подробности — как были. */
function inV2Words(e: unknown): unknown {
  return isAppError(e) ? new AppError(e.code, v2Message(e.message), e.details) : e;
}

/** Шаг мастера и, необязательно, куда идти после сохранения (`goto`: «Назад» с шага фото сохраняет его и ведёт назад). */
const saveStepSchema = saveDraftSchema.extend({ goto: z.enum(WIZARD_SCREENS).optional() });

/**
 * «Дальше»: сохранить шаг (первый шаг без черновика создаёт его — тендер, «Хочу похожее» по `like` или прямая заявка по
 * номеру мастера `executor`) и перейти на следующий шаг черновика (или на `goto`). Повтор того же шага сохраняет те же
 * ответы — эффект один; двойное нажатие гасит форма (useActionForm).
 */
export const saveStepAction = action("app.requests.saveStep", saveStepSchema, async ({ goto, ...input }) => {
  const user = await requireUser("CLIENT");
  const { requestId } = await saveDraftStep(user, input).catch((e: unknown) => {
    throw inV2Words(e);
  });
  redirect(wizardHref({ draft: requestId, step: goto ?? nextScreen(input.step.screen) }));
});

/**
 * «Отправить мастерам»: последний шаг сохраняется и заявка отправляется (DRAFT → OPEN). Повторная отправка той же заявки
 * (двойное нажатие, повтор запроса) — не ошибка: модуль отвечает «конфликт», заявка уже не черновик — человек попадает на
 * ту же карточку. Отказ при черновике (мастер прямой заявки больше не принимает заявки, не все шаги) — текст экрана.
 * Дальше — карточка заявки с отметкой «отправлена» (`?sent=1`, как в v1).
 */
export const submitRequestAction = action("app.requests.submit", z.strictObject({ requestId: z.string().min(1).max(64) }), async ({ requestId }) => {
  const user = await requireUser("CLIENT");
  try {
    await saveDraftStep(user, { requestId, step: { screen: "send" } });
    await publishRequest(user, { requestId });
  } catch (e) {
    if (!isAppError(e) || e.code !== "CONFLICT" || (await getDraft(user, requestId)).status === "DRAFT") throw inV2Words(e);
  }
  redirect(`${to(`/requests/${encodeURIComponent(requestId)}`)}?sent=1`);
});

/** «Найти по адресу» на шаге адреса: точка от геокодера (сейчас мок — только центр города) или `null`. */
export const locateAddressAction = action("app.requests.locate", geocodeSchema, async (input) => {
  const user = await requireUser("CLIENT");
  return geocodeAddress(user, input);
});
