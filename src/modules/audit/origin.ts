import { headers } from "next/headers";
import { env } from "@/platform/env";

/** Откуда пришло действие (ТЗ п. 11): IP с учётом TRUST_PROXY и устройство (User-Agent). */
export type Origin = { ip: string | null; userAgent: string | null };

export const NO_ORIGIN: Origin = { ip: null, userAgent: null };

const MAX_USER_AGENT = 500;

/**
 * IP клиента — только за доверенным прокси (TRUST_PROXY=true): без прокси x-forwarded-for и x-real-ip
 * присылает сам клиент и подделывает их. Из x-forwarded-for берём правый адрес: его дописал наш прокси,
 * всё левее мог прислать клиент. Нет x-forwarded-for — x-real-ip (его ставит прокси). Иначе null.
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

export function originFrom(h: Headers, trustProxy: boolean): Origin {
  return { ip: clientIpFrom(h, trustProxy), userAgent: h.get("user-agent")?.slice(0, MAX_USER_AGENT) ?? null };
}

/**
 * Origin текущего запроса Next (Server Action, маршрут). Вне запроса — фоновая задача, сид, тест —
 * headers() бросает: тогда «откуда» неизвестно, и это честный null, а не ошибка действия.
 */
export async function requestOrigin(): Promise<Origin> {
  try {
    return originFrom(await headers(), env().TRUST_PROXY);
  } catch {
    return NO_ORIGIN;
  }
}
