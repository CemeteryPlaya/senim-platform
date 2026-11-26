import type { IncomeReport } from "@/modules/payments";

/**
 * Что показывать в отчёте о доходе, кроме гарантии 6%. По ADR-015 доход платформы — одна гарантия с мастера, и «Итого»
 * повторяло бы её: итог периода — только когда он отличается от гарантии, столбец «Итого» — только когда хоть у одной
 * строки сумма не равна гарантии (старые сделки с защитой сделки 2 %). Суммы — тиыны.
 */
export function incomeTotals(report: Pick<IncomeReport, "rows" | "guaranteeTiyn" | "totalTiyn">): { total: boolean; totalColumn: boolean } {
  return {
    total: report.totalTiyn !== report.guaranteeTiyn,
    totalColumn: report.rows.some((r) => r.totalTiyn !== r.guaranteeTiyn),
  };
}
