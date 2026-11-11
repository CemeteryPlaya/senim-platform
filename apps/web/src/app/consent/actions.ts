"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { grantPdConsent, homePathFor, requireConsentSubject, safeReturnTo } from "@/modules/identity";
import { action } from "@/platform/action";

/**
 * «Даю согласие»: согласие на обработку ПДн текущей редакции (версия и хэш текста — из ru/consent.ts) в сессии этого
 * браузера, затем — по адресу возврата. Вход — requireConsentSubject: согласия ещё нет, проверять его здесь нельзя.
 */
export const grantConsentAction = action("consent.grant", z.object({ next: z.string().max(512).nullable() }), async ({ next }) => {
  const user = await requireConsentSubject();
  await grantPdConsent();
  redirect(safeReturnTo(next) ?? homePathFor(user));
});
