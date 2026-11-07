import "server-only";
import { headers } from "next/headers";
import { clientIpFrom } from "@/modules/audit";
import { env } from "@/platform/env";

// Одно правило IP клиента (доверенный прокси, правый адрес x-forwarded-for) — в audit: лимиты входа и журнал
// аудита видят один и тот же адрес.
export { clientIpFrom } from "@/modules/audit";

/** IP и User-Agent запроса для лимитов и списка сессий. */
export async function clientInfo(): Promise<{ ip: string | null; userAgent?: string }> {
  const h = await headers();
  return { ip: clientIpFrom(h, env().TRUST_PROXY), userAgent: h.get("user-agent") ?? undefined };
}
