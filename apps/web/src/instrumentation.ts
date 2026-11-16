/**
 * Точка сборки сервера Next (вызывается один раз при старте инстанса): проверка переменных окружения и порты модулей
 * (src/ports.ts). Неверные переменные роняют старт сервера с именами переменных, а не первый запрос.
 * Код только для Node: в Edge-окружении (proxy) регистрировать нечего.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/platform/env");
  env();
  const { registerPorts } = await import("@/ports");
  registerPorts();
}
