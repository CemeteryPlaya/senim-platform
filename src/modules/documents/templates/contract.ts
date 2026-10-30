import type { Block, PdfSpec } from "../pdf/spec";
import { TEMPLATE_EDITION, date, dueLabel, isEscrow, money, months } from "./common";
import type { ContractData } from "./types";

/*
 * Шаблон договора подряда. ПРОЕКТ: владелец решил работать по текущему тексту,
 * юридическая проверка — позже (см. TEMPLATE_EDITION). Текст не обещает больше,
 * чем делает продукт: платформа не сторона договора и не принимает деньги.
 * В режиме MANUAL нет слов «эскроу» и «безопасная оплата».
 */

function executorParty({ legalForm, legalName, binIin }: ContractData["executor"]): string {
  switch (legalForm) {
    case "TOO":
      return `${legalName}, БИН ${binIin}`;
    case "IP":
      return `${legalName} (индивидуальный предприниматель), ИИН ${binIin}`;
    case "SELF_EMPLOYED":
      return `${legalName} (самозанятый), ИИН ${binIin}`;
  }
}

function paymentSection(d: ContractData): Block[] {
  if (!isEscrow(d.paymentMode)) {
    return [
      { kind: "paragraph", text: "3.1. Заказчик оплачивает каждый этап напрямую Исполнителю в момент, указанный в разделе 2: аванс — до начала этапа, остальные этапы — после приёмки этапа." },
      { kind: "paragraph", text: "3.2. Платформа «Сенім» не принимает и не хранит денежные средства Сторон. Заказчик отмечает оплату на платформе, Исполнитель подтверждает её получение." },
    ];
  }
  const blocks: Block[] = [
    { kind: "paragraph", text: "3.1. До начала работ Заказчик вносит цену договора на эскроу-счёт в банке-партнёре по реквизитам, которые показывает платформа. Работы начинаются после поступления всей суммы на счёт." },
    { kind: "paragraph", text: "3.2. Банк перечисляет Исполнителю сумму этапа с эскроу-счёта в момент, указанный в разделе 2: аванс — при начале этапа, остальные этапы — после приёмки этапа." },
    { kind: "paragraph", text: "3.3. Платформа «Сенім» не принимает и не хранит денежные средства Сторон: деньги находятся на счёте банка." },
  ];
  if (d.paymentMode === "ESCROW_SIMULATOR") {
    blocks.push({ kind: "paragraph", text: "3.4. Демонстрационный режим: счёт ведёт симулятор банка, реальные деньги не перечисляются." });
  }
  return blocks;
}

export function contractSpec(d: ContractData): PdfSpec {
  const subject: Block[] = [
    { kind: "paragraph", text: `1.1. Исполнитель обязуется выполнить работы «${d.subject.title}» по заданию Заказчика и сдать их результат, а Заказчик — принять и оплатить результат в порядке, установленном договором.` },
  ];
  if (d.subject.details.length > 0) subject.push({ kind: "paragraph", text: `1.2. Параметры заказа: ${d.subject.details.join("; ")}.` });
  if (d.subject.address) subject.push({ kind: "paragraph", text: `1.3. Адрес выполнения работ: г. ${d.city}, ${d.subject.address}.` });

  const clientParty = d.client.iin ? `${d.client.fullName}, ИИН ${d.client.iin}` : d.client.fullName;
  const escrow = isEscrow(d.paymentMode);

  return {
    title: `Договор подряда № ${d.number}`,
    issuedAt: d.issuedAt,
    footer: `Договор № ${d.number}, версия ${d.version} · Шаблон: ${TEMPLATE_EDITION}`,
    blocks: [
      { kind: "title", text: `ДОГОВОР ПОДРЯДА № ${d.number}` },
      { kind: "subtitle", text: `версия ${d.version} · г. ${d.city} · ${date(d.issuedAt)}` },
      {
        kind: "paragraph",
        text: `${clientParty}, далее — «Заказчик», с одной стороны, и ${executorParty(d.executor)}, далее — «Исполнитель», с другой стороны, вместе — «Стороны», заключили настоящий договор через платформу «Сенім» о нижеследующем.`,
      },

      { kind: "heading", text: "1. Предмет договора" },
      ...subject,

      { kind: "heading", text: "2. Цена и этапы" },
      { kind: "paragraph", text: `2.1. Цена договора — ${money(d.totalAmount)}. Цена разделена на этапы:` },
      {
        kind: "table",
        columns: [
          { header: "№", width: 0.08 },
          { header: "Этап", width: 0.47 },
          { header: "Сумма", width: 0.2, align: "right" },
          { header: "Оплата", width: 0.25 },
        ],
        rows: d.stages.map((s) => [
          String(s.order),
          s.description ? `${s.title}. ${s.description}` : s.title,
          money(s.amount),
          s.amount > 0 ? dueLabel[s.paymentDue] : "—",
        ]),
      },
      { kind: "paragraph", text: `2.2. Срок выполнения работ — ${d.durationDays} календарных дней с даты подписания договора обеими Сторонами${escrow ? " и поступления цены договора на эскроу-счёт" : ""}.` },

      { kind: "heading", text: "3. Порядок оплаты" },
      ...paymentSection(d),

      { kind: "heading", text: "4. Сдача и приёмка" },
      { kind: "paragraph", text: "4.1. Исполнитель сдаёт каждый этап на платформе с отчётом и фотографиями результата." },
      { kind: "paragraph", text: `4.2. Заказчик в течение ${d.autoAcceptDays} календарных дней принимает этап или возвращает его на доработку с комментарием, в чём работа не соответствует договору.` },
      { kind: "paragraph", text: "4.3. Если Заказчик в этот срок не принял этап и не вернул его на доработку, этап считается принятым (автоприёмка)." },
      { kind: "paragraph", text: "4.4. По каждому принятому этапу Стороны подписывают акт приёмки этапа электронной цифровой подписью." },

      { kind: "heading", text: "5. Гарантия" },
      {
        kind: "paragraph",
        text: d.warrantyMonths > 0
          ? `5.1. Исполнитель даёт гарантию на результат работ ${months(d.warrantyMonths)} с даты приёмки последнего этапа.`
          : "5.1. Гарантийный срок Сторонами не установлен.",
      },

      { kind: "heading", text: "6. Споры" },
      { kind: "paragraph", text: "6.1. Разногласия по приёмке этапа Стороны сначала решают через спор на платформе: каждая Сторона излагает позицию и прикладывает материалы, оператор платформы рассматривает спор и сообщает решение." },
      { kind: "paragraph", text: "6.2. Решение оператора отражается на платформе: этап принимается, возвращается на доработку или договор расторгается." },
      { kind: "paragraph", text: "6.3. Порядок, указанный в пп. 6.1–6.2, не лишает Стороны права обратиться в суд в соответствии с законодательством Республики Казахстан." },

      { kind: "heading", text: "7. Прочие условия" },
      { kind: "paragraph", text: "7.1. Договор и акты составляются в электронной форме и подписываются электронной цифровой подписью Сторон. Подписывается этот PDF-файл; его хэш SHA-256 платформа хранит вместе с подписями." },
      { kind: "paragraph", text: "7.2. Переписку по договору Стороны ведут во внутреннем чате платформы." },
      { kind: "paragraph", text: "7.3. До подписания обеими Сторонами изменение условий оформляется новой версией договора; предыдущая версия утрачивает силу." },
      { kind: "paragraph", text: "7.4. Платформа «Сенім» не является стороной договора." },

      { kind: "heading", text: "Подписи Сторон" },
      {
        kind: "signatures",
        parties: [
          { role: "Заказчик", name: d.client.fullName },
          { role: "Исполнитель", name: d.executor.legalName },
        ],
      },
    ],
  };
}
