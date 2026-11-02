/**
 * Точка сборки сервера Next (вызывается один раз при старте инстанса): порты модулей — src/ports.ts.
 * Код только для Node: в Edge-окружении (proxy) регистрировать нечего.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerPorts } = await import("@/ports");
  registerPorts();
}
