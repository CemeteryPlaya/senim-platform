/**
 * Что делает `npm run db:seed` (prisma/seed.ts) — решение без базы, чтобы его можно было проверить тестом.
 *
 * - `APP_ENV=prod`: данные стенда в рабочую базу не пишутся никогда. С `--if-empty` (сборка при деплое) — пропуск с записью
 *   в журнал, без флага — отказ.
 * - Пустая база — заполнить.
 * - Непустая с `--if-empty` — не трогать: деплой не стирает данные стенда.
 * - Непустая без флага — пересоздать (сброс стенда в identity и TRUNCATE) только при ЯВНОМ `APP_ENV` dev или staging, как в
 *   identity; не задан — отказ: забытая переменная не должна стирать базу.
 *
 * `appEnv` — значение переменной как есть (`process.env.APP_ENV`), без значения по умолчанию из env.ts.
 */
export type SeedPlan = "seed" | "reseed" | "skip-not-empty" | "skip-prod" | "refuse-prod" | "refuse-no-app-env";

export function seedPlan({ appEnv, empty, ifEmpty }: { appEnv: string | undefined; empty: boolean; ifEmpty: boolean }): SeedPlan {
  if (appEnv === "prod") return ifEmpty ? "skip-prod" : "refuse-prod";
  if (empty) return "seed";
  if (ifEmpty) return "skip-not-empty";
  return appEnv === "dev" || appEnv === "staging" ? "reseed" : "refuse-no-app-env";
}
