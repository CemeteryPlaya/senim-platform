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

export async function makeUser(role: Role, fullName = `Тест ${role} ${seq + 1}`): Promise<CurrentUser> {
  const iin = testIin(seq + 1);
  const user = await db.user.create({
    data: { role, phone: nextPhone(), fullName, iinEnc: encryptPii(iin), iinHash: hashPii(iin), iinLast4: last4(iin) },
  });
  return { id: user.id, role, phone: user.phone, fullName, isDemo: false, executor: null };
}

export async function makeExecutor(
  opts: { segment?: Segment; status?: "PENDING" | "APPROVED" | "REJECTED"; legalName?: string } = {},
): Promise<CurrentUser & { executor: NonNullable<CurrentUser["executor"]> }> {
  const user = await makeUser("EXECUTOR");
  const bin = `2101400${String(seq).padStart(5, "0")}`;
  const profile = await db.executorProfile.create({
    data: {
      userId: user.id,
      legalForm: "IP",
      legalName: opts.legalName ?? `ИП Тестовый ${seq}`,
      binIinEnc: encryptPii(bin),
      binIinHash: hashPii(bin),
      binIinLast4: last4(bin),
      segment: opts.segment ?? "COMFORT",
      status: opts.status ?? "APPROVED",
    },
  });
  return { ...user, executor: { id: profile.id, publicNumber: profile.publicNumber, status: profile.status } };
}

export const makeClient = (name?: string) => makeUser("CLIENT", name);
export const makeOperator = (name?: string) => makeUser("OPERATOR", name);
