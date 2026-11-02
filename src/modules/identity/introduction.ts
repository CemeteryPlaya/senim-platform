import type { Role } from "@/generated/prisma/enums";
import { safeReturnTo } from "./return-to";

/**
 * «Знакомство» (OPEN_QUESTIONS №26): ФИО и ИИН человек указывает один раз сразу после первого входа —
 * они нужны для договора и потом не меняются. Пока шага нет, страницы заказчика и исполнителя ведут сюда.
 * Оператору шаг не нужен: он не сторона договора.
 */
export const INTRODUCTION_PATH = "/welcome";

export function needsIntroduction(user: { role: Role; fullName: string | null; iinLast4: string | null }): boolean {
  return user.role !== "OPERATOR" && !(user.fullName && user.iinLast4);
}

/** Знакомство с возвратом на страницу, которая его потребовала (только путь внутри сайта). */
export function introductionHref(returnTo?: string): string {
  const next = safeReturnTo(returnTo);
  return next ? `${INTRODUCTION_PATH}?${new URLSearchParams({ next })}` : INTRODUCTION_PATH;
}
