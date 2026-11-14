"use server";

import { requireUser, submitKycDocuments } from "@/modules/identity";
import { action } from "@/platform/action";
import { kycFailure } from "../_parts/errors";
import { kycSchema } from "./kyc-view";

/**
 * Отправить документы на проверку. Схема — правила модуля с текстами v2, затем `requireUser` и модуль: свой профиль из
 * сессии, файлы — только свои, ещё не прикреплённые, назначений KYC_ID и KYC_REGISTRATION (проверяет модуль files внутри
 * `submitKycDocuments`, чужой или уже отправленный файл — отказ), статус решает identity. Повтор тех же файлов (двойной клик,
 * повторная отправка) — отказ «уже отправлены», второго вызова identity нет.
 */
export const submitKycAction = action("app.executor.submitKyc", kycSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  try {
    await submitKycDocuments(user, input);
  } catch (e) {
    throw kycFailure(e);
  }
});
