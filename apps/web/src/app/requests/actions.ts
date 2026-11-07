"use server";

import { requireUser } from "@/modules/identity";
import {
  agreeToContract,
  agreeToContractSchema,
  cancelRequest,
  cancelRequestSchema,
  chooseOffer,
  geocodeAddress,
  geocodeSchema,
  measurementNoDeal,
  noDealSchema,
  offerRefSchema,
  publishRequest,
  saveDraftSchema,
  saveDraftStep,
} from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { action } from "@/platform/action";
import { fail } from "@/platform/errors";

// Действия заказчика. Вход — zod-схема модуля, первая строка обработчика — проверка роли;
// права на конкретную заявку проверяет сервис.

export const saveStepAction = action("requests.saveDraftStep", saveDraftSchema, async (input) => {
  const user = await requireUser("CLIENT");
  return saveDraftStep(user, input);
});

/** Последний экран мастера: сохранить и отправить одной кнопкой. */
export const submitRequestAction = action("requests.submit", saveDraftSchema, async (input) => {
  const user = await requireUser("CLIENT");
  if (!input.requestId || input.step.screen !== "send") return fail.validation(ru.requests.errors.incomplete);
  const { requestId } = await saveDraftStep(user, input);
  await publishRequest(user, { requestId });
  return { requestId };
});

export const chooseOfferAction = action("requests.chooseOffer", offerRefSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await chooseOffer(user, input);
});

export const cancelRequestAction = action("requests.cancel", cancelRequestSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await cancelRequest(user, input);
});

export const agreeToContractAction = action("requests.agreeToContract", agreeToContractSchema, async (input) => {
  const user = await requireUser("CLIENT");
  return agreeToContract(user, input);
});

export const clientNoDealAction = action("requests.measurementNoDeal", noDealSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await measurementNoDeal(user, input);
});

/** «Найти по адресу» на шаге адреса: точка от геокодера (сейчас — мок, только центр города). */
export const locateAddressAction = action("requests.locateAddress", geocodeSchema, async (input) => {
  const user = await requireUser("CLIENT");
  return geocodeAddress(user, input);
});
