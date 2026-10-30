"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { homePathFor, requestOtp, safeReturnTo, verifyOtp } from "@/modules/identity";
import { action } from "@/platform/action";
import { clientInfo } from "../_components/auth/client-info";

// Вход — действие гостя: requireUser здесь не нужен, защита — лимиты и попытки в identity.

export const requestCodeAction = action("identity.requestOtp", z.object({ phone: z.string().max(40) }), async ({ phone }) => {
  const { ip } = await clientInfo();
  const sent = await requestOtp({ phone, ip });
  return { phone: sent.phone, demoCode: sent.demoCode };
});

export const verifyCodeAction = action(
  "identity.verifyOtp",
  z.object({ phone: z.string().max(40), code: z.string().trim().max(10), next: z.string().max(500).nullable() }),
  async ({ phone, code, next }) => {
    const { ip, userAgent } = await clientInfo();
    const user = await verifyOtp({ phone, code, ip, userAgent });
    redirect(safeReturnTo(next) ?? homePathFor(user));
  },
);
