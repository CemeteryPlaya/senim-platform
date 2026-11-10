import { seedIdentityUsers } from "@/modules/identity";
import { logger } from "@/platform/logger";

/**
 * Не-демо оператор для e2e второго фактора: заводится в identity стенда (SeedUsers, is_demo=false) по телефону из
 * аргумента. Входит он только по SMS-коду, без демо-входа, и проходит подключение TOTP как настоящий оператор.
 * Запуск — из сценария (operator-mfa.spec.ts) через tsx с хуком server-only, как сид.
 */
async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone) throw new Error("использование: seed-operator.ts <телефон E.164>");
  await seedIdentityUsers([{ phone, role: "OPERATOR", roles: ["OPERATOR"], isDemo: false, createdAt: new Date() }]);
}

main().catch((e: unknown) => {
  logger.error("e2e.seed_operator_failed", { error: e });
  process.exitCode = 1;
});
