import type { Role, Segment } from "@/generated/prisma/enums";
import { encryptPii, hashPii, last4 } from "@/platform/crypto";
import { db } from "@/platform/db";
import type { CurrentUser } from "@/modules/identity";

/**
 * Фабрики тестовых данных. Только тестовые ИИН и телефоны (+7 700 000 …).
 * Возвращают CurrentUser — так же, как сервисы получают его из identity.requireUser.
 */
let seq = 0;
const nextPhone = () => `+7700000${String(++seq).padStart(4, "0")}`;
const testIin = (n: number) => `9001013${String(n).padStart(5, "0")}`;

export async function makeUser(role: Role, fullName = `Тест ${role} ${seq + 1}`, roles: Role[] = [role]): Promise<CurrentUser> {
  const iin = testIin(seq + 1);
  const user = await db.user.create({
    data: { role, roles, phone: nextPhone(), fullName, iinEnc: encryptPii(iin), iinHash: hashPii(iin), iinLast4: last4(iin) },
  });
  return { id: user.id, role, roles, phone: user.phone, fullName, iinLast4: user.iinLast4, isDemo: false, executor: null };
}

export async function makeExecutor(
  opts: { segment?: Segment; status?: "PENDING" | "APPROVED" | "REJECTED"; legalName?: string; roles?: Role[] } = {},
): Promise<CurrentUser & { executor: NonNullable<CurrentUser["executor"]> }> {
  const user = await makeUser("EXECUTOR", undefined, opts.roles);
  // Номер БИН — из уникального телефона: seq после await уже мог увеличить параллельный вызов.
  const bin = `2101400${user.phone.slice(-5)}`;
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
