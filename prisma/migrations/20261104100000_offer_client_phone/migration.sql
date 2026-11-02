-- Согласие заказчика показать телефон исполнителю отклика (ответ №21, ADR-008).
ALTER TABLE "Offer" ADD COLUMN "clientPhoneSharedAt" TIMESTAMP(3);
