"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { grantPdConsent, requireConsentSubject } from "@/modules/identity";
import { action } from "@/platform/action";
import { nextStepFor, safeNext } from "../../_shell/auth";
import { recallRole } from "../../_shell/role-cookie";

const t = ru.app.onboarding.consent;

/**
 * Согласие на обработку ПДн показанной редакции. `agreed` — отметка «Я согласен»: без неё ошибка у поля, identity не
 * вызывается. `version` — редакция с экрана (не текущая — CONFLICT «текст обновился»); версию и хэш текста записывает
 * модуль identity. `next` — возврат после первых шагов, проверяет safeNext.
 */
const schema = z.strictObject({
  agreed: z.literal("on", { error: t.errors.required }),
  version: z.string().max(32),
  next: z.string().max(2000).optional(),
});

/**
 * «Продолжить» на экране согласия. Вход — requireConsentSubject: согласия ещё нет, проверять его здесь нельзя. Дальше —
 * первый непройденный шаг, `next` или дом (nextStepFor). Пользователь прочитан до записи согласия (и кэшируется на время
 * запроса), поэтому согласие в нём дописывается вручную — иначе шаг согласия вёл бы сам на себя.
 */
export const grantConsentAction = action("app.consent.grant", schema, async ({ version, next }) => {
  const user = await requireConsentSubject();
  await grantPdConsent(version);
  const granted = { ...user, consents: [{ id: "", version, textSha256: "" }], consentRevocationOpen: false };
  redirect(nextStepFor(granted, safeNext(next), await recallRole()));
});
