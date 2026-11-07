import type { Block, PdfSpec } from "../pdf/spec";
import { LEGAL_REVIEW_NOTICE, TEMPLATE_EDITION, date, dateTime, money } from "./common";
import { moneyTable } from "./contract";
import type { AcceptanceActData } from "./types";

/*
 * Акт приёмки по макету стр. 18 (ТЗ п. 7): работа, сумма, дата сдачи, фото сдачи и GPS-отметка, подписи.
 * ПРОЕКТ до юридической проверки (пометка — в колонтитуле). Реквизиты сторон (ИИН/БИН) раскрываются
 * только в оферте: в акте стороны названы по имени и через номер оферты.
 */

/** «в радиусе 500 м» / «вне радиуса — предупреждение»; без геолокации — честно «не передана». */
export function gpsLine(gps: AcceptanceActData["gps"]): string {
  if (!gps || gps.distanceM === null || gps.withinRadius === null) return "Геолокация при сдаче не передана.";
  const accuracy = gps.accuracyM !== null ? `, точность ±${gps.accuracyM} м` : "";
  const verdict = gps.withinRadius ? `в радиусе ${gps.radiusM} м` : `вне радиуса ${gps.radiusM} м — предупреждение`;
  return `Отметка геолокации сдачи: ${gps.distanceM} м до адреса заказа${accuracy} — ${verdict}.`;
}

function photosBlock(d: AcceptanceActData): Block[] {
  if (d.photos.length === 0) return [{ kind: "paragraph", text: "Фото сдачи не приложены." }];
  return [
    { kind: "paragraph", text: `Фото результата, приложенные Мастером при сдаче (${d.photos.length}). Под каждым фото — хэш SHA-256 файла: он связывает акт с исходными фотографиями.` },
    {
      kind: "photos",
      items: d.photos.map((p, i) => ({ image: p.image, caption: `Фото ${i + 1}${p.image ? "" : " (файл недоступен)"} · SHA-256 ${p.sha256.slice(0, 16)}…` })),
    },
  ];
}

export function acceptanceActSpec(d: AcceptanceActData): PdfSpec {
  return {
    title: `Акт приёмки № ${d.number}`,
    issuedAt: d.issuedAt,
    footer: `Акт № ${d.number}, версия ${d.version}, к договору № ${d.contractNumber} · ${TEMPLATE_EDITION} · ${LEGAL_REVIEW_NOTICE}`,
    blocks: [
      { kind: "title", text: `АКТ ПРИЁМКИ ВЫПОЛНЕННЫХ РАБОТ № ${d.number}` },
      { kind: "subtitle", text: `к оферте (договору сделки) № ${d.contractNumber} · г. ${d.city} · ${date(d.issuedAt)}` },
      {
        kind: "paragraph",
        text: `${d.clientName}, далее — «Покупатель», и ${d.executorName}, далее — «Мастер», Стороны договора № ${d.contractNumber}, составили настоящий акт о следующем.`,
      },
      {
        kind: "table",
        columns: [
          { header: "Показатель", width: 0.35 },
          { header: "Значение", width: 0.65 },
        ],
        rows: [
          ["Работа", d.dealTitle],
          ["Сумма заказа", money(d.money.priceTiyn)],
          ["Дата сдачи", dateTime(d.readyAt)],
          ["GPS-отметка", gpsLine(d.gps)],
        ],
      },
      { kind: "paragraph", text: `1. Мастер сдал, а Покупатель принял результат работ «${d.dealTitle}» по договору № ${d.contractNumber}.` },
      { kind: "paragraph", text: "2. Подписывая акт, Покупатель подтверждает, что результат соответствует договору, и даёт распоряжение о выплате денег, зарезервированных в банке:" },
      moneyTable(d.money),
      { kind: "paragraph", text: `3. После подписания акта Мастер получает ${money(d.money.payoutTiyn)} одним платежом; гарантийный срок по разделу 5 договора исчисляется с даты подписания акта.` },
      ...(d.isDemo ? [{ kind: "paragraph" as const, text: "4. Тестовая сделка: реальные деньги не перечисляются." }] : []),
      { kind: "heading", text: "Фото сдачи" },
      ...photosBlock(d),
      { kind: "heading", text: "Подписи Сторон" },
      {
        kind: "signatures",
        parties: [
          { role: "Покупатель", name: d.clientName, caption: "Собственноручная подпись и ЭЦП — в листе подписей" },
          { role: "Мастер", name: d.executorName, caption: d.executorHandSigns ? "Собственноручная подпись и ЭЦП — в листе подписей" : "ЭЦП — в листе подписей" },
        ],
      },
    ],
  };
}
