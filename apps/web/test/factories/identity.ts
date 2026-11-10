import { AsyncLocalStorage } from "node:async_hooks";
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

const browsers = new AsyncLocalStorage<Map<string, Cookie>>();

/** Запускает `fn` в «браузере» со своими cookie, не зависящими от общего: параллельные действия разных людей не путают токены. */
export function asBrowser<T>(cookiesOf: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const own = new Map(Object.entries(cookiesOf).map(([name, value]) => [name, { name, value }]));
  return browsers.run(own, fn);
}

/** Удаления cookie, как их видит браузер: имя и параметры (Secure, Path, SameSite) — для проверки `__Host-`. */
export const deletedCookies: { name: string; options?: Record<string, unknown> }[] = [];

export const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => (browsers.getStore() ?? jar).get(name),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      jar.set(name, { name, value, options });
    },
    delete: (arg: string | ({ name: string } & Record<string, unknown>)) => {
      const { name, ...options } = typeof arg === "string" ? { name: arg } : arg;
      deletedCookies.push({ name, options: Object.keys(options).length > 0 ? options : undefined });
      jar.delete(name);
    },
  }),
  headers: async () => requestHeaders,
};

/** Новый «браузер»: без cookie и с заданными заголовками. */
export function freshBrowser(headers: Record<string, string> = {}) {
  jar.clear();
  deletedCookies.length = 0;
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
