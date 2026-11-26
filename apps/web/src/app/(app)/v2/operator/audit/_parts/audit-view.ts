import { ru } from "@/i18n/ru";
import type { AuditView } from "@/modules/operator";

const t = ru.app.operatorDeals.audit;

/** Названия полей фильтра в адресе: порядок формы. */
export const AUDIT_FIELDS = ["deal", "entityType", "entityId", "scope", "action", "actorId", "from", "to"] as const;
export type AuditField = (typeof AUDIT_FIELDS)[number];

/** Название события: вне сделки — из текстов аудита, события сделки — из общих текстов сделки, неизвестный код — как есть. */
export function actionLabel(code: string): string {
  return t.actions[code] ?? (ru.deal.history.action as Record<string, string>)[code] ?? code;
}

/** Значение до/после/мета в одну строку: {"status":"APPROVED"} → «status: APPROVED»; пусто — пустая строка. */
export function describeJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(describeJson).join(", ");
  return Object.entries(value)
    .map(([key, v]) => `${key}: ${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

/** Сделка записи для ссылки: из истории `deal:<id>` или, если сущность — сама сделка, из её идентификатора. */
export function dealIdOf(event: Pick<AuditView, "scope" | "entityType" | "entityId">): string | null {
  if (event.scope?.startsWith("deal:")) return event.scope.slice("deal:".length) || null;
  return event.entityType === "deal" ? event.entityId : null;
}

/** Система и браузер по строке user-agent: первое совпадение по порядку (Edge и Яндекс прикидываются Chrome, Chrome — Safari). */
const SYSTEMS: readonly [RegExp, keyof typeof t.systems][] = [
  [/iPhone/, "iphone"],
  [/iPad/, "ipad"],
  [/Android/, "android"],
  [/Windows/, "windows"],
  [/Macintosh|Mac OS X/, "mac"],
  [/Linux/, "linux"],
];
const BROWSERS: readonly [RegExp, keyof typeof t.browsers][] = [
  [/Edg(?:e|A|iOS)?\//, "edge"],
  [/YaBrowser\//, "yandex"],
  [/OPR\/|Opera/, "opera"],
  [/Firefox\/|FxiOS\//, "firefox"],
  [/Chrome\/|CriOS\//, "chrome"],
  [/Safari\//, "safari"],
];

/** Устройство коротко: «Android, Chrome»; не распознали ничего — `null`. */
export function deviceShort(userAgent: string): string | null {
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const parts: string[] = [];
  if (system) parts.push(t.systems[system]);
  if (browser) parts.push(t.browsers[browser]);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Откуда (ТЗ п. 11): IP и устройство. Строкой — коротко («IP 1.2.3.4 · Android, Chrome»), полная строка user-agent — по
 * нажатию (`full`): хранится и показывается целиком, в ленте не занимает четыре строки. У системных действий без IP и
 * устройства строки нет; у остальных — «не записаны».
 */
export function originLine(event: Pick<AuditView, "ip" | "userAgent" | "actorRole">): { short: string; full: string | null } | null {
  if (!event.ip && !event.userAgent) return event.actorRole === "SYSTEM" ? null : { short: t.noOrigin, full: null };
  const device = event.userAgent ? (deviceShort(event.userAgent) ?? t.deviceUnknown) : null;
  const parts = [event.ip ? t.ip(event.ip) : null, device].filter((part): part is string => part !== null);
  return { short: parts.join(" · "), full: event.userAgent ? t.device(event.userAgent) : null };
}

/**
 * Адрес журнала с фильтрами из `raw` (только известные поля, непустые) и необязательным курсором `before` (seq последней
 * записи страницы). `to` — функция адресов v2.
 */
export function auditHref(base: string, raw: Readonly<Record<string, string | undefined>>, before?: string): string {
  const query = new URLSearchParams();
  for (const field of AUDIT_FIELDS) {
    const value = raw[field];
    if (value) query.set(field, value);
  }
  if (before) query.set("before", before);
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}
