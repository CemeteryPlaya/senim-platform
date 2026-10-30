import "server-only";
import { headers } from "next/headers";

/**
 * IP и User-Agent запроса для лимитов и списка сессий. На Vercel первый адрес
 * в x-forwarded-for ставит платформа; без прокси — «unknown» (общий лимит).
 */
export async function clientInfo(): Promise<{ ip: string; userAgent?: string }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
  return { ip, userAgent: h.get("user-agent") ?? undefined };
}
