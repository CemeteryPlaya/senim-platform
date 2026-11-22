-- Модель денег (ADR-015, решение основателей 22.11.2026): покупатель платит ровно цену по оферте X — защиты сделки
-- сверх цены нет (protectionTiyn = 0); мастер получает X − гарантия 6%: выплата вниз до тиына ⌊X×94/100⌋ = X×94 / 100.
-- Доход платформы = оплачено − выплата. Формулы — как в payments/money.ts (computeDealMoney).
-- Сделок по прежней формуле (2% / 4%) в рабочей базе нет: стенд пересевается. Если они есть, ограничение не встанет
-- и миграция остановится — их нужно разобрать вручную, а не пересчитывать молча (журнал денег неизменяем).
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_money_formula";
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_money_formula" CHECK (
  "priceTiyn" > 0
  AND "protectionTiyn" = 0
  AND "payoutTiyn" = ("priceTiyn" * 94) / 100
  AND "buyerTotalTiyn" = "priceTiyn" + "protectionTiyn"
  AND "guaranteeTiyn" = "priceTiyn" - "payoutTiyn"
  AND "buyerTotalTiyn" = "payoutTiyn" + "platformIncomeTiyn"
);
