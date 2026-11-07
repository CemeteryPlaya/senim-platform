import "server-only";
import { registerDocumentsPort, registerRequestsPort } from "@/modules/deal-core";
import { documentsPort } from "@/modules/documents";
import { requestsPort } from "@/modules/requests";

/**
 * Точка сборки портов: модули, которые не импортируют друг друга (цикл), связываются здесь.
 * deal-core получает документы (PDF оферты и акта) и заявки (закрытие при оферте и отмене).
 * Зовут: src/instrumentation.ts (сервер Next), src/jobs.ts (задачи `npm run jobs` и cron), сид демо-данных.
 * Повторный вызов безопасен.
 */
export function registerPorts(): void {
  registerDocumentsPort(documentsPort);
  registerRequestsPort(requestsPort);
}
