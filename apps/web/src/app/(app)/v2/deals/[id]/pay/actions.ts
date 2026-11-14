"use server";

import { z } from "zod";
import { ru } from "@/i18n/ru";
import { BANK_CONSENT_MISSING, dealRefSchema, giveBankConsent, payForDeal } from "@/modules/deal-core";
import { CONSENT_VERSION_CHANGED, requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { AppError, isAppError } from "@/platform/errors";

// Оплата покупателя (v2). Свои обёртки над теми же функциями deal-core, что и в v1 (`payAction`, `bankConsentAction`):
// схема zod, затем `requireUser("CLIENT")` первой строкой; права на сделку, согласия обеих сторон, подпись оферты, спор и
// повтор проверяет модуль (чужая — «не найдено», двойное нажатие — та же операция HOLD).
// Отказы модуля — тексты экрана по коду и машинной причине (ru.app.deal.pay.errors).

const t = ru.app.deal.pay.errors;
const d = ru.deal.errors;

/** Причина отказа из `details.reason` модуля (CONFLICT с машинной причиной). */
function reasonOf(e: AppError): unknown {
  return e.details?.reason;
}

/** Отказ модуля → тот же код с текстом экрана; «нет своего согласия» — у отметки. Не AppError — как есть. */
function retext(e: unknown): unknown {
  if (!isAppError(e)) return e;
  if (reasonOf(e) === BANK_CONSENT_MISSING) {
    const missing = e.details?.missing;
    const mine = Array.isArray(missing) && missing.includes("CLIENT");
    return mine ? new AppError(e.code, t.consentMissing, { fieldErrors: { agreed: [t.consentMissing] } }) : new AppError(e.code, t.masterConsent);
  }
  if (reasonOf(e) === CONSENT_VERSION_CHANGED) return new AppError(e.code, t.consentChanged);
  const byMessage: Readonly<Record<string, string>> = {
    [d.notSigned]: t.notSigned,
    [d.disputeOpen]: t.dispute,
    [d.notAllowedNow]: t.changed,
    [d.notFound]: t.notFound,
  };
  const known = byMessage[e.message];
  if (known) return new AppError(e.code, known);
  if (e.code === "NOT_FOUND") return new AppError(e.code, t.notFound);
  if (e.code === "CONFLICT") return new AppError(e.code, t.changed);
  return e;
}

/**
 * Адрес страницы оплаты провайдера — только абсолютный http(s), как его вернул модуль (`payForDeal().redirectUrl`).
 * Ничего не подставляется: другое (пусто, `javascript:`, относительный путь) — без перехода, экран остаётся на сделке.
 */
function providerPage(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** «Оплатить»: отметка согласия (если поставлена) — `agreed: "on"` с редакцией показанного текста. */
const paySchema = dealRefSchema.extend({ agreed: z.literal("on").optional(), version: z.string().max(32).optional() });

export type PayOutcome = { status: "PENDING" | "SUCCEEDED" | "FAILED"; redirectUrl: string | null };

/**
 * Оплата одним нажатием: если отмечено согласие — сначала `giveBankConsent` (повтор — та же запись в identity), затем
 * `payForDeal`. Модуль создаёт одну операцию HOLD и на повтор отвечает ею же (двойное нажатие, вторая вкладка). manual —
 * PENDING (ждём подтверждения банка), mock — SUCCEEDED, провайдер со страницей оплаты — `redirectUrl`.
 */
export const payAction = action("deals.pay", paySchema, async (input): Promise<PayOutcome> => {
  const user = await requireUser("CLIENT");
  try {
    if (input.agreed === "on") await giveBankConsent(user, { dealId: input.dealId, version: input.version ?? "" });
    const result = await payForDeal(user, { dealId: input.dealId });
    return { status: result.status, redirectUrl: providerPage(result.redirectUrl) };
  } catch (e) {
    throw retext(e);
  }
});

/** Своё согласие заранее (мастер своё ещё не дал): только отметка, без оплаты. Повтор — та же запись. */
const consentSchema = dealRefSchema.extend({ agreed: z.literal("on", { error: t.consentMissing }), version: z.string().max(32) });

export const giveBankConsentAction = action("deals.pay.consent", consentSchema, async (input) => {
  const user = await requireUser("CLIENT");
  try {
    await giveBankConsent(user, { dealId: input.dealId, version: input.version });
  } catch (e) {
    throw retext(e);
  }
});
