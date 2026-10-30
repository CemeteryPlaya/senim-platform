/**
 * CSV для Excel в русской локали: разделитель «;», UTF-8 с BOM, строки через CRLF.
 * Ячейки, начинающиеся с = + - @, Excel выполнил бы как формулу (CSV-инъекция) —
 * перед ними ставится апостроф. Числа пишутся как есть.
 */
export type CsvCell = string | number | null | undefined;

const SEPARATOR = ";";
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[;"\r\n]/;

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(headers: readonly string[], rows: readonly CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(cell).join(SEPARATOR));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Дата и время по Астане в виде «2026-10-30 14:05» — сортируется в Excel как текст. */
export function csvDateTime(value: Date | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
