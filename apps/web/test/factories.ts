import { randomUUID } from "node:crypto";
import type { Role, Segment } from "@/generated/prisma/enums";
import { encryptPii, hashPii, last4 } from "@/platform/crypto";
import { db } from "@/platform/db";
import { kzCheckDigit } from "@/platform/kz-id";
import type { CurrentUser } from "@/modules/identity";

/**
 * Фабрики тестовых данных. Только тестовые ИИН и телефоны (+7 700 000 …).
 * Возвращают CurrentUser — так же, как сервисы получают его из identity.requireUser.
 */
let seq = 0;
const nextPhone = () => `+7700000${String(++seq).padStart(4, "0")}`;
/**
 * Тестовый ИИН с верной контрольной цифрой (identity сверяет ИИН сертификата ЭЦП только с корректным ИИН): дата рождения,
 * цифра века и пола (3 или 4 — если для 3 номер не выдаётся), 4 цифры номера.
 */
function testIin(birthYymmdd: string, n: number): string {
  for (const centuryGender of [3, 4, 5, 6]) {
    const first11 = `${birthYymmdd}${centuryGender}${String(n % 10_000).padStart(4, "0")}`;
    const check = kzCheckDigit(first11);
    if (check !== null) return `${first11}${check}`;
  }
  throw new Error(`нет тестового ИИН для ${n}`);
}

export async function makeUser(role: Role, fullName = `Тест ${role} ${seq + 1}`, roles: Role[] = [role]): Promise<CurrentUser> {
  const iin = testIin("900101", seq + 1);
  const user = await db.user.create({
    // id — UUID, как у пользователей identity (проекция пишет их id; ReviewKyc принимает только UUID).
    data: { id: randomUUID(), role, roles, phone: nextPhone(), fullName, iinEnc: encryptPii(iin), iinHash: hashPii(iin), iinLast4: last4(iin) },
  });
  // Оператор — как после входа с пройденной второй ступенью (сейчас).
  const mfa = { required: role === "OPERATOR", verifiedAt: role === "OPERATOR" ? new Date() : null };
  return { id: user.id, role, roles, phone: user.phone, fullName, iinLast4: user.iinLast4, isDemo: false, executor: null, mfa, consents: [] };
}

export async function makeExecutor(
  opts: { segment?: Segment; status?: "PENDING" | "APPROVED" | "REJECTED"; legalName?: string; roles?: Role[] } = {},
): Promise<CurrentUser & { executor: NonNullable<CurrentUser["executor"]> }> {
  const user = await makeUser("EXECUTOR", undefined, opts.roles);
  // ИИН стороны ИП — из уникального телефона: seq после await уже мог увеличить параллельный вызов.
  const bin = testIin("850505", Number(user.phone.slice(-4)));
  const profile = await db.executorProfile.create({
    data: {
      userId: user.id,
      legalForm: "IP",
      legalName: opts.legalName ?? `ИП Тестовый ${seq}`,
      binIinEnc: encryptPii(bin),
      binIinHash: hashPii(bin),
      binIinLast4: last4(bin),
      // Подписант ИП — владелец: ФИО в профиле, ИИН — ИИН профиля (ADR-003).
      signerFullName: user.fullName,
      segment: opts.segment ?? "COMFORT",
      status: opts.status ?? "APPROVED",
    },
  });
  return { ...user, executor: { id: profile.id, publicNumber: profile.publicNumber, status: profile.status } };
}

export const makeClient = (name?: string) => makeUser("CLIENT", name);

/** Тот же человек в другой активной роли (ADR-004): роль должна быть среди выданных. */
export function actingAs<U extends CurrentUser>(user: U, role: Role): U {
  if (!user.roles.includes(role)) throw new Error(`роль ${role} не выдана`);
  return { ...user, role };
}
export const makeOperator = (name?: string) => makeUser("OPERATOR", name);
