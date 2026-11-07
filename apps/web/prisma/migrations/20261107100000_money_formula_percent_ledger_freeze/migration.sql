-- Формулы ТЗ п. 6 в базе — вместе с процентами, а не только суммы (payments/money.ts, computeDealMoney):
-- защита 2% — вверх до тиына: ⌈X×2/100⌉ = (X×2 + 99) / 100; выплата — вниз: ⌊X×96/100⌋ = X×96 / 100.
-- Деление bigint в Postgres целочисленное с отбрасыванием дробной части; X > 0, поэтому это floor.
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_money_formula";
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_money_formula" CHECK (
  "priceTiyn" > 0
  AND "protectionTiyn" = ("priceTiyn" * 2 + 99) / 100
  AND "payoutTiyn" = ("priceTiyn" * 96) / 100
  AND "buyerTotalTiyn" = "priceTiyn" + "protectionTiyn"
  AND "guaranteeTiyn" = "priceTiyn" - "payoutTiyn"
  AND "buyerTotalTiyn" = "payoutTiyn" + "platformIncomeTiyn"
);

-- Журнал денег: после итога (статус не PENDING) не меняются и реквизиты подтверждения, и связи операции.
-- Код приложения меняет их только у ждущей операции: итог (trySettle — статус, externalRef, реквизиты
-- банковского документа manual, ошибка), номер провайдера (rememberExternalRef), отказ частей вместе с
-- раскрытием. Повтор после отказа — новая строка, прежняя не меняется.
CREATE OR REPLACE FUNCTION money_transaction_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MoneyTransaction is append-only: DELETE is not allowed';
  END IF;
  IF NEW."dealId" <> OLD."dealId" OR NEW."type" <> OLD."type" OR NEW."amountTiyn" <> OLD."amountTiyn"
     OR NEW."idempotencyKey" <> OLD."idempotencyKey" OR NEW."provider" <> OLD."provider"
     OR NEW."seq" <> OLD."seq" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'MoneyTransaction is append-only: only the outcome of an operation may change';
  END IF;
  IF OLD."status" <> 'PENDING' AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'MoneyTransaction %: settled operation cannot change status', OLD."idempotencyKey";
  END IF;
  IF OLD."status" <> 'PENDING' AND (
       NEW."bankDocNumber" IS DISTINCT FROM OLD."bankDocNumber"
    OR NEW."bankDocDate" IS DISTINCT FROM OLD."bankDocDate"
    OR NEW."bankDocFileId" IS DISTINCT FROM OLD."bankDocFileId"
    OR NEW."confirmedById" IS DISTINCT FROM OLD."confirmedById"
    OR NEW."isTest" IS DISTINCT FROM OLD."isTest"
    OR NEW."parentId" IS DISTINCT FROM OLD."parentId"
    OR NEW."disputeId" IS DISTINCT FROM OLD."disputeId"
    OR NEW."basisDocumentId" IS DISTINCT FROM OLD."basisDocumentId"
    OR NEW."externalRef" IS DISTINCT FROM OLD."externalRef"
    OR NEW."error" IS DISTINCT FROM OLD."error"
  ) THEN
    RAISE EXCEPTION 'MoneyTransaction %: settled operation is frozen', OLD."idempotencyKey";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
