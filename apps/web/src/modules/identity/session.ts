import "server-only";
import { randomUUID } from "node:crypto";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { Session, User } from "@/gen/senim/identity/v1/identity_pb";
import type { Actor } from "@/modules/audit";
import { db } from "@/platform/db";
import { AppError, fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { rpcErrorCode, rpcStatusName } from "@/platform/rpc";
import { projectUser, roleFromProto, roleToProto } from "./projection";
import { identity } from "./remote";
import { identityFailure, isTransient } from "./remote-errors";
import { sessionCookieName, sessionCookieOptions, TOKEN_SHAPE } from "./session-cookie";
import { consentHref, loginHref, mfaHref } from "./return-to";
import { needsConsent, type GrantedConsent } from "./consent-text";
import { introductionHref, needsIntroduction } from "./introduction";
import { activeRoleOf, roleToSwitch, switchRoleHref } from "./roles";

export type CurrentUser = {
  id: string;
  /** Активная роль: в ней человек действует в этой сессии. Все проверки прав — по ней (ADR-004). */
  role: Role;
  /** Выданные роли; активная — одна из них. */
  roles: Role[];
  phone: string;
  fullName: string | null;
  /** Последние 4 цифры ИИН аккаунта из проекции личности identity (сам ИИН — только в identity, шифртекстом); null — знакомство не пройдено. */
  iinLast4: string | null;
  isDemo: boolean;
  /**
   * Профиль исполнителя этого аккаунта, если он есть (в любой активной роли: экран регистрации
   * и история сделок). Права исполнителя — только при role = EXECUTOR.
   */
  executor: { id: string; publicNumber: number; status: "PENDING" | "APPROVED" | "REJECTED" } | null;
  /**
   * Второй фактор этой сессии (identity, Session.mfa_required/mfa_verified_at): нужен оператору; verifiedAt — когда
   * пройден код из приложения (вход или повторный код), null — не пройден. Свежесть перед деньгами — requireRecentMfa.
   */
  mfa: { required: boolean; verifiedAt: Date | null };
  /**
   * Действующие согласия на обработку ПДн (Authenticate.consents: только PD_PROCESSING без отозванных; согласия банку к
   * сделкам — HasConsents). Нет согласия текущей редакции — needsConsent: страницы ведут на /consent, действия — CONSENT_REQUIRED.
   */
  consents: GrantedConsent[];
};

/** Токен сессии из cookie своего контура; `undefined` — cookie нет. Вид токена не проверяется. */
export async function currentToken(): Promise<string | undefined> {
  return (await cookies()).get(sessionCookieName())?.value;
}

/** Токен для вызова identity, который меняет сессию: нет cookie — человек не вошёл. */
export async function currentSessionToken(): Promise<string> {
  const token = await currentToken();
  return token ?? fail.unauthenticated();
}

/**
 * Отзывает прежнюю сессию браузера после успешного нового входа (неудачный вход старую сессию не трогает).
 * Токен читается ДО входа (`currentToken()`): после `beginSession` cookie уже новая. Ошибки игнорируются: вход важнее,
 * а сессия в любом случае кончится по простою; токен не того вида identity не принял бы, его не отправляем.
 */
export async function signOutPrevious(previous: string | undefined): Promise<void> {
  await signOutQuietly(previous, "identity.sign_out_previous_failed");
}

/** SignOut без ошибки наружу: сбой — только в лог (`event`, причина без токена). Токен не того вида не отправляется. */
async function signOutQuietly(token: string | undefined, event: string): Promise<void> {
  if (!token || !TOKEN_SHAPE.test(token)) return;
  try {
    await identity().signOut({ sessionToken: token, idempotencyKey: randomUUID() });
  } catch (e) {
    logger.warn(event, { reason: rpcErrorCode(e) ?? rpcStatusName(e) });
  }
}

/** Удаляет cookie сессии с теми же Secure/Path/SameSite, что и при установке: иначе браузер игнорирует удаление `__Host-` cookie. */
async function deleteSessionCookie(): Promise<void> {
  (await cookies()).delete({ name: sessionCookieName(), ...sessionCookieOptions() });
}

/**
 * Начало сессии по ответу identity на вход (VerifyOtp, StartDemoSession): проекция пользователя и cookie.
 * Срок жизни cookie — `expires_at` сессии identity. Проекция не удалась — сессия в identity уже создана, а cookie
 * не будет: сессия отзывается (сбой отзыва — в лог), наружу уходит исходная ошибка проекции.
 */
export async function beginSession(token: string, res: { user?: User; session?: Session }): Promise<{ user: User; session: Session }> {
  const { user, session } = res;
  if (!user || !session?.expiresAt) {
    logger.error("identity.call_rejected", { reason: "login_without_user_or_session" });
    return fail.unavailable(ru.common.errors.generic);
  }
  try {
    await projectUser(user);
  } catch (e) {
    await signOutQuietly(token, "identity.sign_out_orphan_failed");
    throw e;
  }
  (await cookies()).set(sessionCookieName(), token, { ...sessionCookieOptions(), expires: timestampDate(session.expiresAt) });
  return { user, session };
}

/**
 * Выход из этой сессии: SignOut, затем cookie удаляется всегда. Сбой identity (кроме недоступности) не мешает выйти;
 * недоступность — ошибка «сервис недоступен»: сессия на сервере могла остаться, человек должен об этом знать.
 */
export async function endSession(): Promise<void> {
  const token = await currentToken();
  let outage: unknown = null;
  if (token && TOKEN_SHAPE.test(token)) {
    try {
      await identity().signOut({ sessionToken: token, idempotencyKey: randomUUID() });
    } catch (e) {
      if (isTransient(e)) outage = e;
      else logger.warn("identity.sign_out_failed", { reason: rpcErrorCode(e) ?? rpcStatusName(e) });
    }
  }
  await deleteSessionCookie();
  if (outage !== null) identityFailure(outage);
}

/**
 * «Выйти на всех устройствах»: сначала Authenticate (кто это), затем SignOutEverywhere и удаление cookie. Гость
 * (cookie нет или сессия недействительна) — только удаление cookie. Сбой SignOutEverywhere — ошибка, cookie остаётся:
 * человек не вышел и может повторить.
 */
export async function signOutEverywhere(): Promise<void> {
  const user = await getCurrentUser();
  const token = await currentToken();
  if (user && token) {
    try {
      await identity().signOutEverywhere({ sessionToken: token, idempotencyKey: randomUUID() });
    } catch (e) {
      return identityFailure(e);
    }
  }
  await deleteSessionCookie();
}

/**
 * Authenticate по cookie. React `cache` объединяет вызовы только внутри одного рендера (страница, layout, компоненты);
 * в Server Action и route handler каждый вызов — отдельный запрос к identity. `null` — гость: нет cookie, токен не того вида
 * или identity ответил `session_invalid` (простой, срок, отзыв, блокировка). Cookie здесь не удаляется: в Server Component
 * это невозможно, удаление — в Server Action / route handler. Недоступный identity — ошибка «сервис недоступен»,
 * cookie остаётся: человек не «выходит» сам.
 */
const authenticated = cache(async () => {
  const token = await currentToken();
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  // Клиент строится до try: ошибка конфигурации (V2 выключен, нет MESH_URL) всплывает как есть, а не как «статус unknown».
  const client = identity();
  try {
    const res = await client.authenticate({ sessionToken: token });
    if (!res.user || !res.session) {
      logger.error("identity.call_rejected", { reason: "authenticate_without_user" });
      return fail.unavailable(ru.common.errors.generic);
    }
    return { user: res.user, session: res.session, accessToken: res.accessToken, consents: res.consents };
  } catch (e) {
    if (rpcErrorCode(e) === "session_invalid") return null;
    return identityFailure(e);
  }
});

/** Текущий пользователь по cookie: сессию проверяет identity, остальные поля — из старой базы. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const auth = await authenticated();
  if (!auth) return null;
  const { user, session, consents } = auth;
  await projectUser(user);
  const row = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { executorProfile: { select: { id: true, publicNumber: true, status: true } } },
  });
  return {
    id: row.id,
    role: activeRoleOf(row.roles, row.role, roleFromProto(session.activeRole)),
    roles: row.roles,
    phone: row.phone,
    fullName: row.fullName,
    iinLast4: row.iinLast4,
    isDemo: row.isDemo,
    executor: row.executorProfile,
    mfa: { required: session.mfaRequired, verifiedAt: session.mfaVerifiedAt ? timestampDate(session.mfaVerifiedAt) : null },
    consents: consents.map((c) => ({ id: c.id, version: c.version, textSha256: c.textSha256 })),
  };
});

/**
 * Пользователь для оболочки (layout) и страниц, открытых гостю (главная, вход): при недоступном identity страница
 * рисуется гостем, а `unavailable` просит показать плашку «сервис временно недоступен». Cookie не трогается: когда
 * identity вернётся, человек окажется вошедшим. Конфликт проекции (в старой базе тот же телефон у другого id) — тоже
 * гость с записью в лог: иначе каждая страница падала бы в global-error без «Выйти», а сессия не кончалась бы.
 * Страницы с `requireUserPage`/`requireUser` при этом по-прежнему бросают ту же ошибку в границу ошибок.
 */
export async function getShellUser(): Promise<{ user: CurrentUser | null; unavailable: boolean }> {
  try {
    return { user: await getCurrentUser(), unavailable: false };
  } catch (e) {
    if (e instanceof AppError && e.code === "UNAVAILABLE") return { user: null, unavailable: true };
    if (e instanceof AppError && e.code === "CONFLICT") {
      logger.warn("identity.shell_user_conflict", { reason: "projection_conflict" });
      return { user: null, unavailable: false };
    }
    throw e;
  }
}

/**
 * Внутренний токен для вызовов сервисов v2 от имени текущего пользователя (короткоживущий, Ed25519);
 * `null` — гость. Тот же вызов Authenticate, что и в getCurrentUser. Токен не логировать и не отдавать в браузер.
 */
export async function getAccessToken(): Promise<string | null> {
  return (await authenticated())?.accessToken ?? null;
}

/** Сессии нужен второй фактор (оператор), а он в ней не пройден: вошёл только по SMS. */
export function needsSecondFactor(user: Pick<CurrentUser, "mfa">): boolean {
  return user.mfa.required && user.mfa.verifiedAt === null;
}

/**
 * Для Server Actions и сервисов: пользователь с одной из ролей, иначе ошибка. Сессии, которой нужен второй фактор
 * (оператор), он должен быть пройден — иначе MFA_REQUIRED: вход только по SMS не открывает действий оператора,
 * даже в обход экранов. Экран самой второй ступени берёт пользователя через requireMfaUser. Без действующего согласия
 * на обработку ПДн текущей редакции — CONSENT_REQUIRED (форма уводит на экран согласия с возвратом, leaveIfSignedOut).
 */
export async function requireUser(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireConsentSubject(...roles);
  if (needsConsent(user)) return fail.consentRequired();
  return user;
}

/**
 * Как requireUser, но без проверки согласия: только для действий экрана согласия (дать согласие можно и без него).
 */
export async function requireConsentSubject(...roles: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) return fail.unauthenticated();
  if (roles.length > 0 && !roles.includes(user.role)) return fail.forbidden();
  if (needsSecondFactor(user)) return fail.mfaRequired();
  return user;
}

/**
 * Для страниц: пользователь с одной из ролей, иначе переход на /login с возвратом на `returnTo`
 * (адрес текущей страницы — страница знает свои params). Нужная роль у человека есть, но не активна —
 * на страницу переключения роли с тем же возвратом. Роли нет вовсе — вход с reason=role:
 * экран входа предложит выйти и войти под нужным номером.
 */
export async function requireUserPage(returnTo: string, ...roles: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginHref(returnTo));
  if (roles.length > 0 && !roles.includes(user.role)) {
    const to = roleToSwitch(user, roles);
    redirect(to ? switchRoleHref(to, returnTo) : loginHref(returnTo, "role"));
  }
  requireIntroduced(user, returnTo);
  return user;
}

/**
 * Ворота страниц, которые берут пользователя через getCurrentUser (и requireUserPage): сессия оператора без второй
 * ступени (вход только по SMS) — на /operator/mfa с возвратом сюда: страницы сделки и журнал денег оператор видит по
 * роли, без кода из приложения они не открываются. Без согласия на обработку ПДн текущей редакции — на экран согласия
 * (раньше знакомства: ФИО и ИИН собираются только после согласия). Без пройденного знакомства (ФИО и ИИН, №26) — на
 * знакомство.
 */
export function requireIntroduced(user: CurrentUser, returnTo: string): void {
  if (needsSecondFactor(user)) redirect(mfaHref(returnTo));
  // Сменилась редакция посреди формы — следующий запрос страницы уводит на согласие и возвращает на ту же страницу.
  if (needsConsent(user)) redirect(consentHref(returnTo));
  if (needsIntroduction(user)) redirect(introductionHref(returnTo));
}

/**
 * Переключение активной роли этой сессии (ADR-004): роль проверяет identity по выданным (отозванную не выбрать),
 * она же становится ролью по умолчанию для следующего входа. Ответ identity пишется в проекцию. Повтор безопасен.
 */
export async function switchRole(_user: Pick<CurrentUser, "id">, role: Role): Promise<void> {
  const sessionToken = await currentSessionToken();
  try {
    const res = await identity().switchRole({ sessionToken, role: roleToProto(role), idempotencyKey: randomUUID() });
    if (res.user) await projectUser(res.user);
  } catch (e) {
    return identityFailure(e);
  }
}

/**
 * Выдаёт роль человеку этой сессии в identity и пишет ответ в проекцию. Ключ идемпотентности — случайный, если
 * вызывающему не нужен свой. Возвращает true, если роль выдана сейчас.
 */
export async function grantRole(role: Role, options: { idempotencyKey?: string } = {}): Promise<boolean> {
  const sessionToken = await currentSessionToken();
  try {
    const res = await identity().grantRole({ sessionToken, role: roleToProto(role), idempotencyKey: options.idempotencyKey ?? randomUUID() });
    if (res.user) await projectUser(res.user);
    return res.granted;
  } catch (e) {
    return identityFailure(e);
  }
}

/**
 * «Стать заказчиком» из профиля исполнителя (ADR-004): у роли заказчика нет привилегий над чужими данными,
 * поэтому она выдаётся сразу, без модерации, и сессия переходит в неё. Повтор ничего не меняет.
 */
export async function becomeClient(user: CurrentUser): Promise<void> {
  if (user.role !== "EXECUTOR") return fail.forbidden();
  await grantRole("CLIENT");
  await switchRole(user, "CLIENT");
}

export function actorOf(user: Pick<CurrentUser, "id" | "role">): Actor {
  return { kind: "user", id: user.id, role: user.role };
}
