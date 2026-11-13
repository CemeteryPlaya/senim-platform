import "server-only";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import {
  getCurrentUser,
  mfaHref,
  needsConsent,
  needsEmail,
  needsIntroduction,
  needsSecondFactor,
  roleToSwitch,
  safeReturnTo,
  switchRoleHref,
  type CurrentUser,
} from "@/modules/identity";
import { makePaths, safeLocalPath, to } from "./paths";
import { recallRole, type ChosenRole } from "./role-cookie";

/** Пользователь в том объёме, что нужен барьерам и выбору дома (подмножество CurrentUser). */
export type StepUser = Pick<
  CurrentUser,
  "role" | "roles" | "executor" | "fullName" | "iinLast4" | "emailVerified" | "mfa" | "consents" | "consentRevocationOpen"
>;

const SAME_ORIGIN = "http://x";

/** Путь под префиксом `base` целыми сегментами: `/v2`, `/v2/deals`, но не `/v2x`. Пустой префикс — любой путь. */
function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * `safeNext` для префикса `base` ("" или "/v2"): адрес возврата после входа — только путь этого сайта под префиксом v2,
 * иначе `null`. Отклоняются: чужой сайт (`//host`, `/\host`, `https://…`, управляющие символы и `\`, в том числе
 * закодированные — safeReturnTo и safeLocalPath), путь не под префиксом (после разбора `..`), сам экран входа (петля)
 * и `/api/…`. При пустом префиксе (после переключения на этапе 6) годится любой путь сайта, кроме входа и API.
 */
export function makeSafeNext(base: string): (raw: string | undefined) => string | null {
  const paths = makePaths(base);
  const login = paths.to("/login");
  return (raw) => {
    if (raw === undefined || raw === "" || raw.length > 2000) return null;
    if (safeReturnTo(raw) === null || safeLocalPath(raw) !== raw) return null;
    const { pathname } = new URL(raw, SAME_ORIGIN);
    if (base !== "" && !under(pathname, base)) return null;
    if (under(pathname, login) || under(pathname, "/api")) return null;
    return raw;
  };
}

/** Префикс v2 из `to()`: "/v2" сейчас, "" после переключения (to("/") тогда — "/"). */
const BASE = to("/") === "/" ? "" : to("/");

/** Адрес возврата после входа (параметр `next`): только путь v2 этого сайта, иначе `null`. См. makeSafeNext. */
export const safeNext = makeSafeNext(BASE);

/**
 * Дом человека после всех первых шагов: заказчик — главная, мастер с одобренным профилем — входящие заявки, мастер без
 * профиля или на проверке — регистрация мастера, оператор — его раздел, замерщик — замеры. Выбор «Я мастер» на первом
 * шаге входа ведёт заказчика без профиля исполнителя на регистрацию мастера (роль в identity от выбора не меняется).
 */
export function homeFor(user: Pick<StepUser, "role" | "executor">, chosen: ChosenRole | null = null): string {
  switch (user.role) {
    case "CLIENT":
      return chosen === "EXECUTOR" && user.executor === null ? to("/register/executor") : to("/");
    case "EXECUTOR":
      return user.executor?.status === "APPROVED" ? to("/executor/requests") : to("/register/executor");
    case "OPERATOR":
      return to("/operator");
    case "MEASURER":
      return to("/measurer");
  }
}

/** Адрес шага с возвратом: `/v2/consent?next=%2Fv2%2Fdeals%2F1` или без параметра. */
export function stepWithNext(screen: string, next: string | null): string {
  return next ? `${to(screen)}?${new URLSearchParams({ next })}` : to(screen);
}

/**
 * Первый непройденный обязательный шаг после входа или `null`: второй фактор оператора (экран v1 — в v2 его ещё нет) →
 * согласие на обработку ПДн → ФИО и ИИН → подтверждённая почта. Операторов и прочий персонал согласие, знакомство и почта
 * не касаются (needsConsent, needsIntroduction, needsEmail). `next` переносится на шаг, чтобы после него вернуться.
 */
export function barrierFor(user: StepUser, next: string | null, chosen: ChosenRole | null = null): string | null {
  if (needsSecondFactor(user)) return mfaHref(next ?? homeFor(user, chosen));
  if (needsConsent(user)) return stepWithNext("/consent", next);
  if (needsIntroduction(user)) return stepWithNext("/welcome", next);
  if (needsEmail(user)) return stepWithNext("/email", next);
  return null;
}

/**
 * Куда вести человека сейчас: первый непройденный обязательный шаг, иначе `next` (уже проверенный safeNext), иначе дом
 * (`homeFor` с учётом выбора на первом шаге входа). Чистая функция: выбор роли передаёт вызывающий (`recallRole()`).
 */
export function nextStepFor(user: StepUser, next: string | null, chosen: ChosenRole | null = null): string {
  return barrierFor(user, next, chosen) ?? next ?? homeFor(user, chosen);
}

/** Путь адреса без строки запроса и якоря. */
const pathOf = (href: string): string => new URL(href, SAME_ORIGIN).pathname;

/** Экраны первых шагов (барьеры barrierFor): сами они возвращаться «на себя» через `next` не должны. */
const STEP_SCREENS = ["/consent", "/welcome", "/email"].map((screen) => to(screen));

/**
 * Куда вернуться после входа и шагов, если страница, которой нужен пользователь, — сама страница шага: её собственный
 * адрес не годится (после шага человек оказался бы на нём снова), берётся её `next`. Иначе адрес страницы как есть.
 */
function backFrom(returnTo: string): string | null {
  const own = safeNext(returnTo);
  if (own === null) return null;
  const { pathname, searchParams } = new URL(own, SAME_ORIGIN);
  return STEP_SCREENS.includes(pathname) ? safeNext(searchParams.get("next") ?? undefined) : own;
}

/**
 * Для страниц v2: вошедший пользователь с одной из ролей. Нет сессии — вход v2 с возвратом сюда (`returnTo` — адрес этой
 * страницы, его знает она сама). Нужная роль выдана, но не активна — экран переключения роли (v1) с возвратом; не выдана —
 * дом человека. Не пройден обязательный шаг — на него (nextStepFor), кроме экрана самого этого шага: страницы согласия,
 * знакомства и почты тоже берут пользователя здесь и не уводят сами на себя.
 *
 * Это граница экрана, а не прав: действия и сервисы по-прежнему проверяют пользователя сами (requireUser).
 *
 * Правила для новых страниц — иначе возможна петля переходов:
 * 1. Страница шага (согласие, знакомство, почта) вызывает `requireV2User(<свой адрес с next>)` БЕЗ ролей и сама проверяет,
 *    что шаг ещё нужен; не нужен — `redirect(nextStepFor(user, next, chosen))`. Барьер на её собственном адресе молчит
 *    (сравнение путей), на чужом ведёт на первый непройденный шаг, поэтому «шаг пройден» страница шага не требует.
 * 2. «Дом» (`homeFor`) не должен требовать роль, которой у человека может не быть: страница, куда ведёт дом, берёт
 *    пользователя с теми ролями, для которых она дом. Регистрация мастера — дом и заказчика без профиля, и мастера, поэтому
 *    `requireV2User(path, "CLIENT", "EXECUTOR")`, а не только `"EXECUTOR"`: иначе заказчик ушёл бы в дом, а дом — снова в дом.
 * 3. Роль, которой нет, ведёт в дом — значит, сам дом (`/v2`, раздел оператора и т. д.) не вызывает requireV2User с ролью,
 *    которой нет у тех, кого туда ведёт homeFor.
 */
export async function requireV2User(returnTo: string, ...roles: Role[]): Promise<CurrentUser> {
  const back = backFrom(returnTo);
  const user = await getCurrentUser();
  if (!user) redirect(stepWithNext("/login", back));
  if (roles.length > 0 && !roles.includes(user.role)) {
    const target = roleToSwitch(user, roles);
    redirect(target ? switchRoleHref(target, back ?? to("/")) : homeFor(user, await recallRole()));
  }
  const barrier = barrierFor(user, back, await recallRole());
  if (barrier !== null && pathOf(barrier) !== pathOf(returnTo)) redirect(barrier);
  return user;
}
