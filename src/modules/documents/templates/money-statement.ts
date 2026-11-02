import type { MoneyTransactionStatus } from "@/generated/prisma/enums";
import type { PdfSpec } from "../pdf/spec";
import { TEMPLATE_EDITION, dateTime, money } from "./common";
import { moneyTable } from "./contract";
import type { MoneyStatementData, StatementEntry } from "./types";

/*
 * Выписка по деньгам сделки (ТЗ п. 4.3, п. 7) — печатаемый таймлайн журнала операций. Строится только
 * из журнала (MoneyTransaction через deal-core.dealDocumentData), не из статуса сделки. Подписи не требует.
 * Выписку видят и покупатель, и мастер: в тексте нет слов «эскроу» и «комиссия».
 */

export const OPERATION_LABEL: Record<StatementEntry["type"], string> = {
  HOLD: "Деньги покупателя зарезервированы в банке",
  FREEZE: "Выплата заморожена на время спора",
  UNFREEZE: "Выплата разморожена",
  SPLIT_MASTER: "Выплачено мастеру",
  SPLIT_PLATFORM: "Доход платформы (защита сделки и гарантия оплаты)",
  REFUND: "Возврат покупателю",
};

const STATUS_LABEL: Record<MoneyTransactionStatus, string> = {
  PENDING: "ожидает подтверждения банка",
  SUCCEEDED: "проведено",
  FAILED: "отклонено",
};

function statusCell(e: StatementEntry): string {
  const parts = [STATUS_LABEL[e.status]];
  if (e.operationRef) parts.push(`№ ${e.operationRef}`);
  if (e.isTest) parts.push("тестовая операция");
  return parts.join(", ");
}

export function moneyStatementSpec(d: MoneyStatementData): PdfSpec {
  const basis = d.contractNumber ? `по договору № ${d.contractNumber}` : "по сделке";
  return {
    title: `Выписка по деньгам № ${d.number}`,
    issuedAt: d.issuedAt,
    footer: `Выписка № ${d.number}, версия ${d.version} · ${TEMPLATE_EDITION}`,
    blocks: [
      { kind: "title", text: `ВЫПИСКА ПО ДЕНЬГАМ СДЕЛКИ № ${d.number}` },
      { kind: "subtitle", text: `${basis} · «${d.dealTitle}» · сформирована ${dateTime(d.issuedAt)}` },
      { kind: "paragraph", text: "Выписка составлена по журналу операций с деньгами сделки. Деньги покупателя хранятся в банке; платформа их не принимает и не хранит." },
      { kind: "heading", text: "Суммы по оферте" },
      moneyTable(d.money),
      { kind: "heading", text: "Операции" },
      d.entries.length === 0
        ? { kind: "paragraph", text: "Операций с деньгами пока не было." }
        : {
            kind: "table",
            columns: [
              { header: "Дата", width: 0.22 },
              { header: "Операция", width: 0.36 },
              { header: "Сумма", width: 0.18, align: "right" },
              { header: "Статус", width: 0.24 },
            ],
            rows: d.entries.map((e) => [dateTime(e.at), OPERATION_LABEL[e.type], money(e.amountTiyn), statusCell(e)]),
          },
      { kind: "paragraph", text: `Остаток денег сделки в банке по проведённым операциям: ${money(d.bankBalanceTiyn)}.`, bold: true },
      ...(d.isDemo ? [{ kind: "paragraph" as const, text: "Тестовая сделка: реальные деньги не списывались и не перечислялись." }] : []),
    ],
  };
}
