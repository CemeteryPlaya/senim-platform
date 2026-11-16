-- Демо-режима нет (спека редизайна, раздел 9; этап 5, R6): признак демо у людей, сделок, цен материалов и типовых
-- расчётов больше не нужен. Тестовая операция журнала денег — MoneyTransaction."isTest" по провайдеру (мок, песочница).
ALTER TABLE "User" DROP COLUMN "isDemo";
ALTER TABLE "Deal" DROP COLUMN "isDemo";
ALTER TABLE "MaterialPrice" DROP COLUMN "isDemo";
ALTER TABLE "TypicalEstimate" DROP COLUMN "isDemo";
