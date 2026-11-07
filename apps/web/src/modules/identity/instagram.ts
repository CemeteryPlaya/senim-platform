import { z } from "zod";
import { ru } from "@/i18n/ru";

/** Ограничение Instagram на длину имени пользователя. */
export const INSTAGRAM_MAX = 30;
const NAME_OR_EMPTY = /^[A-Za-z0-9._]*$/;

const t = ru.identity.contacts;

/**
 * Instagram в профиле (User.instagram): хранится без «@». Пустое поле — не указан (null).
 * Ведущая «@» и пробелы по краям убираются; остальное — только латиница, цифры, точка и подчёркивание.
 */
export const instagramField = z
  .string()
  .transform((raw) => raw.trim().replace(/^@/, ""))
  .pipe(z.string().max(INSTAGRAM_MAX, t.instagramTooLong(INSTAGRAM_MAX)).regex(NAME_OR_EMPTY, t.instagramInvalid))
  .transform((name) => name || null);

/**
 * E-mail в профиле (User.email) — только для копии подписанного акта (ТЗ п. 7). Пробелы по краям убираются,
 * адрес — в нижнем регистре; пустое поле — не указан (null).
 */
export const emailField = z
  .string()
  .transform((raw) => raw.trim().toLowerCase())
  .pipe(z.union([z.literal(""), z.email(t.emailInvalid).max(254, t.emailInvalid)]))
  .transform((email) => email || null);

/** email не передан — прежний адрес не меняется. */
export const contactsInputSchema = z.object({ instagram: instagramField, email: emailField.optional() });
export type ContactsInput = z.input<typeof contactsInputSchema>;
