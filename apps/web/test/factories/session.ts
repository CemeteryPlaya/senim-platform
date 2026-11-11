import { LegalForm } from "@/gen/senim/identity/v1/identity_pb";
import type { Role } from "@/generated/prisma/enums";
// Прямые импорты файлов, а не index.ts: index тянет next/headers раньше, чем тест успеет его подменить.
// eslint-disable-next-line no-restricted-imports
import { roleToProto } from "@/modules/identity/projection";
// eslint-disable-next-line no-restricted-imports
import { newSessionToken, sessionCookieName } from "@/modules/identity/session-cookie";
import { decryptPii } from "@/platform/crypto";
import { db } from "@/platform/db";
import { identityFake } from "../stubs/identity";
import { putCookie } from "./identity";

/**
 * Пользователь старой базы появляется в подделке identity с теми же id, телефоном, ролями, демо-флагом, личностью и стороной
 * (без этого identity «не знает» человека, которого тест создал фабрикой напрямую в старой базе).
 */
export async function mirrorUser(userId: string): Promise<void> {
  if (identityFake.hasUser(userId)) return;
  const row = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { executorProfile: true } });
  const profile = row.executorProfile;
  const open = (enc: string | null) => (enc ? decryptPii(enc) : "");
  identityFake.addUser({
    id: row.id,
    phone: row.phone,
    defaultRole: roleToProto(row.role),
    roles: row.roles.map(roleToProto),
    isDemo: row.isDemo,
    blocked: row.blockedAt !== null,
    // Личность — как её записал бы сид identity: ФИО, ИИН (фабрика хранит его в старой базе) и контакты.
    person: { fullName: row.fullName, iin: row.iinEnc ? decryptPii(row.iinEnc) : null, instagram: row.instagram, email: row.email },
    // Сторона — из профиля фабрики (makeExecutor хранит номера шифртекстом в старой базе).
    party: profile
      ? {
          legalForm: LegalForm[profile.legalForm],
          legalName: profile.legalName,
          binIin: open(profile.binIinEnc),
          signerFullName: profile.signerFullName ?? "",
          signerIin: open(profile.signerIinEnc),
          payoutIban: open(profile.payoutIbanEnc),
        }
      : undefined,
  });
}

/**
 * Вошёл пользователь: сессия в подделке identity и cookie в «браузере» теста — так, как их оставляет настоящий вход.
 * Заменяет прежний `startSession`. `role` — активная роль сессии (по умолчанию — роль по умолчанию пользователя).
 * Сессия оператора — с пройденной сейчас второй ступенью; `mfaVerifiedAt` задаёт её момент (`null` — вход только по SMS).
 */
export async function signInAs(user: { id: string }, role?: Role, opts: { mfaVerifiedAt?: Date | null } = {}): Promise<string> {
  await mirrorUser(user.id);
  const token = newSessionToken();
  identityFake.signIn(user.id, token, role ? roleToProto(role) : undefined, opts);
  putCookie(sessionCookieName(), token);
  return token;
}

