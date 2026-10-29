import { date, tenge } from "@/lib/format";
import { LEGAL_TYPE } from "@/lib/deal/labels";
import { split, trancheFor } from "@/lib/deal/money";
import type { LegalType } from "@/generated/prisma/enums";

type ContractDeal = {
  number: number;
  revision: number;
  contractNo: string | null;
  title: string;
  furnitureType: string;
  description: string;
  specs: unknown;
  address: string;
  amount: number;
  commissionRate: number;
  deadline: Date;
  client: { name: string; iin: string; city: string; phone: string };
  master: { name: string; iin: string; city: string; phone: string; master: { legalType: LegalType; displayName: string } | null };
  stages: { order: number; title: string; payoutPercent: number }[];
};

export type Specs = { dimensions?: string; materials?: string; color?: string };

/** Ключевые условия договора: по ним считается хэш, который подписывают стороны. */
export function contractFingerprint(deal: ContractDeal) {
  return JSON.stringify({
    no: deal.contractNo,
    rev: deal.revision,
    title: deal.title,
    description: deal.description,
    specs: deal.specs,
    address: deal.address,
    amount: deal.amount,
    deadline: deal.deadline.toISOString().slice(0, 10),
    client: deal.client.iin,
    master: deal.master.iin,
    stages: deal.stages.map((s) => [s.title, s.payoutPercent]),
  });
}

export function contractSections(deal: ContractDeal) {
  const specs = (deal.specs ?? {}) as Specs;
  const { commission, net } = split(deal.amount, deal.commissionRate);
  const masterType = deal.master.master ? LEGAL_TYPE[deal.master.master.legalType] : "Исполнитель";
  const pct = Math.round(deal.commissionRate * 100);

  return [
    {
      title: "1. Стороны",
      items: [
        `Заказчик: ${deal.client.name}, ИИН ${deal.client.iin}, г. ${deal.client.city}, тел. ${deal.client.phone}.`,
        `Исполнитель: ${deal.master.master?.displayName ?? deal.master.name} (${masterType}), ИИН/БИН ${deal.master.iin}, г. ${deal.master.city}.`,
        "Оператор: платформа безопасных сделок (участник Astana Hub), обеспечивающая хранение средств на эскроу-счёте банка-партнёра и контроль исполнения сделки.",
      ],
    },
    {
      title: "2. Предмет договора",
      items: [
        `Исполнитель обязуется изготовить и установить: «${deal.title}» (${deal.furnitureType.toLowerCase()}), а Заказчик — принять и оплатить работу.`,
        deal.description,
        specs.dimensions ? `Габариты: ${specs.dimensions}.` : null,
        specs.materials ? `Материалы: ${specs.materials}.` : null,
        specs.color ? `Цвет / отделка: ${specs.color}.` : null,
        `Адрес установки: ${deal.address}.`,
      ].filter(Boolean) as string[],
    },
    {
      title: "3. Цена и порядок расчётов",
      items: [
        `Цена работ: ${tenge(deal.amount)}. Заказчик вносит всю сумму на эскроу-счёт в банке-партнёре в течение 3 дней после подписания договора.`,
        "Средства на эскроу-счёте заморожены и не доступны ни одной из сторон до подтверждения выполнения этапов.",
        ...deal.stages
          .filter((s) => s.payoutPercent > 0)
          .map((s) => `После подтверждения этапа «${s.title}» Исполнителю раскрывается ${s.payoutPercent}% — ${tenge(trancheFor(deal.amount, s.payoutPercent))}.`),
        `Вознаграждение Оператора — ${pct}% от суммы сделки (${tenge(commission)}), удерживается из выплат Исполнителю. Исполнитель получает ${tenge(net)}.`,
      ],
    },
    {
      title: "4. Этапы и приёмка",
      items: [
        ...deal.stages.map((s) => `Этап ${s.order}. ${s.title}.`),
        "По завершении каждого этапа Исполнитель направляет отчёт с фотографиями через платформу. Заказчик подтверждает этап или возвращает его на доработку с указанием замечаний.",
        "Если Заказчик не ответил в течение 5 календарных дней, этап считается принятым автоматически.",
        `Срок выполнения всех работ — до ${date(deal.deadline)}`,
      ],
    },
    {
      title: "5. Споры",
      items: [
        "При разногласиях любая сторона может открыть спор на платформе. Средства остаются замороженными до решения Оператора.",
        "Оператор рассматривает спор в течение 5 рабочих дней на основании переписки, фотоотчётов и условий договора и принимает решение о выплате, возврате или разделении средств.",
        "Решение Оператора не лишает стороны права обратиться в суд в соответствии с законодательством Республики Казахстан.",
      ],
    },
    {
      title: "6. Заключительные положения",
      items: [
        "Договор заключён в электронной форме и подписан электронными цифровыми подписями сторон, выданными НУЦ РК, что равнозначно собственноручной подписи (Закон РК «Об электронном документе и электронной цифровой подписи»).",
      ],
    },
  ];
}
