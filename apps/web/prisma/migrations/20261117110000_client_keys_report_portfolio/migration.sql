-- Ключ повтора от клиента (формы v2): повтор отчёта о ходе работ и создания работы портфолио отдаёт уже созданную запись.
-- Колонки необязательные: у записей сида и v1 ключа нет (NULL не участвует в уникальности).
ALTER TABLE "ProgressReport" ADD COLUMN "clientKey" TEXT;
CREATE UNIQUE INDEX "ProgressReport_dealId_clientKey_key" ON "ProgressReport"("dealId", "clientKey");

ALTER TABLE "PortfolioItem" ADD COLUMN "clientKey" TEXT;
CREATE UNIQUE INDEX "PortfolioItem_executorId_clientKey_key" ON "PortfolioItem"("executorId", "clientKey");
