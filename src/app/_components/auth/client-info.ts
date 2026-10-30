import "server-only";
import { headers } from "next/headers";
import { env } from "@/platform/env";

/**
 * IP клиента. x-forwarded-for читаем только за доверенным прокси (TRUST_PROXY=true, на Vercel
 * первый адрес ставит платформа): без прокси заголовок присылает сам клиент и подделывает его.
 * Иначе — x-real-ip; адреса нет — null (лимиты по IP тогда не применяются, остаются лимиты по номеру).
 */
export function clientIpFrom(h: Headers, trustProxy: boolean): string | null {
  const forwarded = trustProxy ? h.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return forwarded || h.get("x-real-ip")?.trim() || null;
}

/** IP и User-Agent запроса для лимитов и списка сессий. */
export async function clientInfo(): Promise<{ ip: string | null; userAgent?: string }> {
  const h = await headers();
  return { ip: clientIpFrom(h, env().TRUST_PROXY), userAgent: h.get("user-agent") ?? undefined };
}
