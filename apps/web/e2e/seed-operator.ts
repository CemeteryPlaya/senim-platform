import { seedIdentityUsers } from "@/modules/identity";
import { logger } from "@/platform/logger";

/**
 * Оператор без секрета TOTP для e2e второго фактора: заводится в identity стенда (SeedUsers — засеянный, seeded) по
 * телефону из аргумента. Входит по SMS-коду и проходит подключение TOTP как настоящий оператор; ResetStand снимает его
 * фактор, поэтому повторный прогон подключает приложение заново. Запуск — из сценария (operator-mfa.spec.ts) через tsx с
 * хуком server-only, как сид.
 */
async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone) throw new Error("использование: seed-operator.ts <телефон E.164>");
  await seedIdentityUsers([{ phone, role: "OPERATOR", roles: ["OPERATOR"], createdAt: new Date() }]);
}

main().catch((e: unknown) => {
  logger.error("e2e.seed_operator_failed", { error: e });
  process.exitCode = 1;
});
