"use server";

import { requireUser } from "@/modules/identity";
import {
  completeMeasurement,
  completeMeasurementSchema,
  measurementNoDeal,
  noDealSchema,
  offerRefSchema,
  scheduleMeasurement,
  scheduleMeasurementSchema,
  sendOffer,
  sendOfferSchema,
  withdrawOffer,
} from "@/modules/requests";
import { action } from "@/platform/action";

// Действия исполнителя. Подтверждение профиля и видимость заявки проверяет сервис requests.

export const sendOfferAction = action("requests.sendOffer", sendOfferSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  return sendOffer(user, input);
});

export const withdrawOfferAction = action("requests.withdrawOffer", offerRefSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  await withdrawOffer(user, input);
});

export const scheduleMeasurementAction = action("requests.scheduleMeasurement", scheduleMeasurementSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  return scheduleMeasurement(user, input);
});

export const completeMeasurementAction = action("requests.completeMeasurement", completeMeasurementSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  await completeMeasurement(user, input);
});

export const executorNoDealAction = action("requests.executorNoDeal", noDealSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  await measurementNoDeal(user, input);
});
