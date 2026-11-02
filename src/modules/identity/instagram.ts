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

export const contactsInputSchema = z.object({ instagram: instagramField });
export type ContactsInput = z.input<typeof contactsInputSchema>;
