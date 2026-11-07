-- Адрес мастерской или офиса исполнителя (ответ №6): город уже есть, добавляются район и улица/дом.
ALTER TABLE "ExecutorProfile" ADD COLUMN "district" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ExecutorProfile" ADD COLUMN "streetAddress" TEXT NOT NULL DEFAULT '';

-- Чат отклика закрывает и открывает оператор (ответ №19).
ALTER TABLE "Offer" ADD COLUMN "chatClosedAt" TIMESTAMP(3);
ALTER TABLE "Offer" ADD COLUMN "chatClosedReason" TEXT;
