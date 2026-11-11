import { createHash } from "node:crypto";
import { CONSENT_DOCUMENTS, type ConsentDocument, type ConsentKindName } from "@/i18n/ru/consent";
import type { Role } from "@/generated/prisma/enums";
import { isStaffRole } from "./roles";

export type { ConsentKindName };

/**
 * Каноническая запись JSON: ключи объектов по алфавиту на каждом уровне, массивы по порядку, без пробелов. Один и тот же
 * текст даёт одну и ту же строку независимо от порядка полей в исходнике.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Текущий текст согласия вида (ru/consent.ts). */
export function consentDocument(kind: ConsentKindName): ConsentDocument {
  return CONSENT_DOCUMENTS[kind];
}

/**
 * SHA-256 (hex) канонического JSON текущего текста согласия — то, что identity хранит как доказательство показанного
 * текста. Вычисляется при каждом вызове, руками не хранится; изменение текста без смены версии ловит тест закреплённого
 * хэша (consent-text.test.ts). Сид демо (Task 15) берёт версию и хэш отсюда же.
 */
export function consentTextSha256(kind: ConsentKindName): string {
  return createHash("sha256").update(canonicalJson(consentDocument(kind)), "utf8").digest("hex");
}

/** Действующее согласие на обработку ПДн из Authenticate (identity отдаёт только PD_PROCESSING без отозванных). */
export type GrantedConsent = { id: string; version: string; textSha256: string };

/**
 * Нужен экран согласия: нет действующего согласия на обработку ПДн текущей версии (нового пользователя, после смены
 * редакции текста, после исполненного отзыва). Сотрудникам площадки (оператор, замерщик) экран не нужен — как и
 * знакомство: они не стороны сделок, а текст согласия — о заявках и сделках.
 */
export function needsConsent(user: { role: Role; consents: readonly Pick<GrantedConsent, "version">[] }): boolean {
  if (isStaffRole(user.role)) return false;
  const current = consentDocument("PD_PROCESSING").version;
  return !user.consents.some((c) => c.version === current);
}
