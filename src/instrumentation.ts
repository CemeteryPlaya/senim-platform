/**
 * Точка сборки сервера Next (вызывается один раз при старте инстанса). Здесь модули, которые не импортируют
 * друг друга напрямую, связываются портами: deal-core получает реализацию документов (PDF оферты и акта).
 * Код только для Node: в Edge-окружении (proxy) регистрировать нечего.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ registerDocumentsPort }, { documentsPort }] = await Promise.all([import("@/modules/deal-core"), import("@/modules/documents")]);
  registerDocumentsPort(documentsPort);
}
