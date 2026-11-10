import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";

/**
 * Подмена next/headers для интеграционных тестов identity: cookie живут в памяти,
 * заголовки задаются тестом. Подключение в тесте:
 *
 *   vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);
 */
type Cookie = { name: string; value: string; options?: Record<string, unknown> };

const jar = new Map<string, Cookie>();
let requestHeaders = new Headers();

export const nextHeadersMock = {
  // Чтение — снимок на момент вызова cookies(), как у запроса Next: параллельные действия разных людей не путают токены.
  cookies: async () => {
    const snapshot = new Map(jar);
    return {
      get: (name: string) => snapshot.get(name),
      set: (name: string, value: string, options?: Record<string, unknown>) => {
        const cookie = { name, value, options };
        jar.set(name, cookie);
        snapshot.set(name, cookie);
      },
      delete: (name: string) => {
        jar.delete(name);
        snapshot.delete(name);
      },
    };
  },
  headers: async () => requestHeaders,
};

/** Новый «браузер»: без cookie и с заданными заголовками. */
export function freshBrowser(headers: Record<string, string> = {}) {
  jar.clear();
  requestHeaders = new Headers(headers);
}

export function cookieValue(name: string): string | undefined {
  return jar.get(name)?.value;
}

export function cookieOptions(name: string): Record<string, unknown> | undefined {
  return jar.get(name)?.options;
}

/** Положить cookie в «браузер» — например, вернуться на устройство со старым токеном. */
export function putCookie(name: string, value: string) {
  jar.set(name, { name, value });
}

/** Переключает флаги окружения для теста и сбрасывает кэш env(). */
export function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

/** Пользователь с флагом демо-персоны. */
export async function makeDemoPersona(role: "CLIENT" | "EXECUTOR" | "OPERATOR", phone: string, isDemo = true) {
  return db.user.create({ data: { role, roles: [role], phone, fullName: `Демо ${phone}`, isDemo } });
}
