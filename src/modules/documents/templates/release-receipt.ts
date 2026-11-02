import { brand } from "@/config/brand";
import type { PdfSpec } from "../pdf/spec";
import { LEGAL_REVIEW_NOTICE, TEMPLATE_EDITION, date, money } from "./common";
import { clientParty, executorParty } from "./contract";
import type { ReleaseReceiptData } from "./types";

/*
 * Расписка на раскрытие эскроу-счёта для банка (провайдер manual, Freedom Bank: раскрытие по расписке).
 * ШАБЛОН: форма расписки у банка своя; текст требует юридической проверки и сверки с формой банка —
 * пометка крупно в начале и в конце документа. Формирует оператор; подписывается на бумаге или по форме банка.
 */

export function releaseReceiptSpec(d: ReleaseReceiptData): PdfSpec {
  const notice = { kind: "notice" as const, text: `${LEGAL_REVIEW_NOTICE.toUpperCase()}. Не является формой банка` };
  const basis = d.actNumber
    ? `акт приёмки № ${d.actNumber} к договору № ${d.contractNumber}${d.actSha256 ? ` (SHA-256 подписанного файла: ${d.actSha256})` : ""}`
    : `решение по спору по договору № ${d.contractNumber}`;
  const rows: string[][] = [
    ["Мастеру (бенефициару)", money(d.release.masterTiyn)],
    [`Платформе «${brand.name}» — защита сделки и гарантия оплаты`, money(d.release.platformTiyn)],
  ];
  if (d.release.refundTiyn > 0n) rows.push(["Возврат Покупателю (депоненту)", money(d.release.refundTiyn)]);
  return {
    title: `Расписка на раскрытие эскроу-счёта № ${d.number}`,
    issuedAt: d.issuedAt,
    footer: `Расписка № ${d.number}, версия ${d.version} · ${TEMPLATE_EDITION} · ${LEGAL_REVIEW_NOTICE}`,
    blocks: [
      notice,
      { kind: "title", text: `РАСПИСКА НА РАСКРЫТИЕ ЭСКРОУ-СЧЁТА № ${d.number}` },
      { kind: "subtitle", text: `по договору № ${d.contractNumber} · г. ${d.city} · ${date(d.issuedAt)}` },
      {
        kind: "paragraph",
        text: `Мы, ${clientParty(d.client)} (депонент), и ${executorParty(d.executor)} (бенефициар), просим банк раскрыть эскроу-счёт по договору № ${d.contractNumber} и перечислить деньги, зарезервированные по этому договору (${money(d.money.buyerTotalTiyn)}), так:`,
      },
      {
        kind: "table",
        columns: [
          { header: "Получатель", width: 0.65 },
          { header: "Сумма", width: 0.35, align: "right" },
        ],
        rows,
      },
      { kind: "paragraph", text: d.executor.iban ? `Счёт Мастера для выплаты (IBAN): ${d.executor.iban}.` : "Счёт Мастера для выплаты — по данным банка." },
      { kind: "paragraph", text: `Реквизиты платформы — по трёхстороннему договору с банком. Основание: ${basis}.` },
      { kind: "paragraph", text: "Претензий друг к другу по сумме раскрытия Стороны не имеют." },
      {
        kind: "signatures",
        parties: [
          { role: "Депонент (Покупатель)", name: d.client.fullName, caption: "Подпись: ______________" },
          { role: "Бенефициар (Мастер)", name: d.executor.legalName, caption: "Подпись: ______________" },
        ],
      },
      notice,
    ],
  };
}
