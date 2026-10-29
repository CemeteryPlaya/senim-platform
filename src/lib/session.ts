import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "demo_user";

// Демо-вход: вместо SMS-OTP пользователь выбирает персону, id хранится в cookie.
export async function getCurrentUser() {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  return db.user.findUnique({ where: { id }, include: { master: true } });
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
