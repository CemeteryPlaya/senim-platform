"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { grantPdConsent, homePathFor, requireConsentSubject, safeReturnTo } from "@/modules/identity";
import { action } from "@/platform/action";

/**
 * «Даю согласие»: согласие на обработку ПДн показанной редакции (`version` — с экрана; не текущая — CONFLICT «текст
 * обновился»), версия и хэш — из ru/consent.ts, в сессии этого браузера; затем — по адресу возврата. Вход —
 * requireConsentSubject: согласия ещё нет, проверять его здесь нельзя.
 */
const schema = z.object({ next: z.string().max(512).nullable(), version: z.string().max(32) });

export const grantConsentAction = action("consent.grant", schema, async ({ next, version }) => {
  const user = await requireConsentSubject();
  await grantPdConsent(version);
  redirect(safeReturnTo(next) ?? homePathFor(user));
});
