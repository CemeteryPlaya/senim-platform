import "server-only";
import { headers } from "next/headers";
import { clientIpFrom } from "@/modules/audit";
import { env } from "@/platform/env";

/**
 * IP и User-Agent запроса для лимитов входа в identity и списка сессий — так же, как у входа v1
 * (`(legacy)/_components/auth/client-info.ts`, его v2 импортировать не может). Правило IP одно — `clientIpFrom` в audit
 * (доверенный прокси, правый адрес x-forwarded-for): лимиты входа и журнал аудита видят один адрес. В `src/platform` эта
 * обёртка не переезжает: платформа не зависит от модулей.
 */
export async function clientInfo(): Promise<{ ip: string | null; userAgent?: string }> {
  const h = await headers();
  return { ip: clientIpFrom(h, env().TRUST_PROXY), userAgent: h.get("user-agent") ?? undefined };
}
