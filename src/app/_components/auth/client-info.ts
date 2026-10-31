import "server-only";
import { headers } from "next/headers";
import { env } from "@/platform/env";

/**
 * IP клиента — только за доверенным прокси (TRUST_PROXY=true): без прокси x-forwarded-for и x-real-ip
 * присылает сам клиент и подделывает их. Из x-forwarded-for берём правый адрес: его дописал наш прокси,
 * всё левее мог прислать клиент. Нет x-forwarded-for — x-real-ip (его ставит прокси).
 * Адреса нет — null: лимиты по IP тогда не применяются, остаются лимиты по номеру и суточные потолки
 * для новых номеров. Поэтому в production env.ts требует TRUST_PROXY=true.
 */
export function clientIpFrom(h: Headers, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const forwarded = h
    .get("x-forwarded-for")
    ?.split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .at(-1);
  return forwarded || h.get("x-real-ip")?.trim() || null;
}

/** IP и User-Agent запроса для лимитов и списка сессий. */
export async function clientInfo(): Promise<{ ip: string | null; userAgent?: string }> {
  const h = await headers();
  return { ip: clientIpFrom(h, env().TRUST_PROXY), userAgent: h.get("user-agent") ?? undefined };
}
