import type { PdfSpec } from "../pdf/spec";
import { TEMPLATE_EDITION, date, isEscrow, money } from "./common";
import type { StageActData } from "./types";

/*
 * Шаблон акта приёмки этапа. ПРОЕКТ до юридической проверки (см. TEMPLATE_EDITION).
 * Исполнитель раскрывается только в договоре, поэтому в акте Стороны названы через договор.
 */

function acceptance(d: StageActData): string {
  if (d.acceptedAutomatically) {
    return `Этап принят автоматически ${date(d.acceptedAt)}: Заказчик в течение ${d.autoAcceptDays} календарных дней не принял этап и не вернул его на доработку (п. 4.3 договора).`;
  }
  return `Этап принят Заказчиком ${date(d.acceptedAt)}.`;
}

function payment(d: StageActData): string {
  const { amount, paymentDue } = d.stage;
  if (amount <= 0) return "Этап без оплаты.";
  if (isEscrow(d.paymentMode)) return `Сумма этапа (${money(amount)}) перечисляется Исполнителю банком с эскроу-счёта по условиям раздела 3 договора.`;
  return paymentDue === "ON_START"
    ? `Оплата этапа (${money(amount)}) производится Заказчиком напрямую Исполнителю до начала этапа (аванс).`
    : `Оплата этапа (${money(amount)}) производится Заказчиком напрямую Исполнителю после приёмки этапа.`;
}

export function stageActSpec(d: StageActData): PdfSpec {
  const party = `по договору № ${d.contractNumber}`;
  return {
    title: `Акт приёмки этапа № ${d.number}`,
    issuedAt: d.issuedAt,
    footer: `Акт № ${d.number} к договору № ${d.contractNumber} · Шаблон: ${TEMPLATE_EDITION}`,
    blocks: [
      { kind: "title", text: `АКТ ПРИЁМКИ ЭТАПА № ${d.number}` },
      { kind: "subtitle", text: `к договору подряда № ${d.contractNumber} · г. ${d.city} · ${date(d.issuedAt)}` },
      { kind: "paragraph", text: `Заказчик и Исполнитель ${party} «${d.dealTitle}», далее — Стороны, составили настоящий акт о следующем.` },
      {
        kind: "table",
        columns: [
          { header: "Показатель", width: 0.3 },
          { header: "Значение", width: 0.7 },
        ],
        rows: [
          ["Этап", `№ ${d.stage.order}. ${d.stage.title}`],
          ...(d.stage.description ? [["Описание", d.stage.description]] : []),
          ["Сумма этапа", money(d.stage.amount)],
          ["Дата приёмки", date(d.acceptedAt)],
        ],
      },
      { kind: "paragraph", text: `1. ${acceptance(d)}` },
      { kind: "paragraph", text: `2. ${payment(d)}` },
      { kind: "paragraph", text: "3. Подписание акта Сторонами электронной цифровой подписью подтверждает приёмку этапа." },
      { kind: "heading", text: "Подписи Сторон" },
      {
        kind: "signatures",
        parties: [
          { role: "Заказчик", name: party },
          { role: "Исполнитель", name: party },
        ],
      },
    ],
  };
}
