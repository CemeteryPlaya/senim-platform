-- Один профиль исполнителя на ИИН/БИН: HMAC (hashPii) для проверки без расшифровки.
-- Колонка nullable: ключ HMAC есть только в приложении, заполнить старые строки SQL-ом нельзя.
ALTER TABLE "ExecutorProfile" ADD COLUMN "binIinHash" TEXT;

CREATE UNIQUE INDEX "ExecutorProfile_binIinHash_key" ON "ExecutorProfile"("binIinHash");
