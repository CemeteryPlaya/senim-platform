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

/** Откуда (ТЗ п. 11): IP и устройство; у системных действий их нет и подписи нет. */
export function originLine(event: Pick<AuditView, "ip" | "userAgent" | "actorRole">): string | null {
  if (!event.ip && !event.userAgent) return event.actorRole === "SYSTEM" ? null : t.noOrigin;
  const parts = [event.ip && t.ip(event.ip), event.userAgent && t.device(event.userAgent)].filter(Boolean);
  return `${t.origin}: ${parts.join(", ")}`;
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
