"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, signOutEverywhere } from "@/modules/identity";
import { action } from "@/platform/action";

/**
 * Выход. requireUser не вызываем намеренно: выход идемпотентен и трогает только cookie
 * вызывающего — гость или истёкшая сессия просто попадают на главную, а не получают ошибку.
 */
export const logoutAction = action("identity.logout", z.object({ everywhere: z.boolean() }), async ({ everywhere }) => {
  if (everywhere) await signOutEverywhere();
  else await endSession();
  redirect("/");
});
