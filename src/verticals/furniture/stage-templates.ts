import type { StageTemplate } from "@/modules/deal-core";

/** Шаблоны этапов мебели на заказ. Есть вариант без предоплаты: многие мастера работают так. */
export const STAGE_TEMPLATES = {
  "no-prepayment": {
    key: "no-prepayment",
    name: "Без предоплаты",
    description: "Вся сумма после монтажа и приёмки",
    stages: [
      {
        title: "Изготовление",
        description: "Закупка материалов, раскрой, сборка корпусов. Исполнитель присылает фото из цеха.",
        sharePercent: 0,
        paymentDue: "ON_ACCEPTANCE",
      },
      {
        title: "Доставка, монтаж и сдача",
        description: "Установка на объекте, регулировка, приёмка заказчиком.",
        sharePercent: 100,
        paymentDue: "ON_ACCEPTANCE",
      },
    ],
  },
  "advance-50": {
    key: "advance-50",
    name: "Аванс 50% на материалы",
    description: "Половина до начала работ, половина после монтажа",
    stages: [
      {
        title: "Аванс на материалы",
        description: "Оплата до начала: исполнитель закупает материалы и присылает фото и чеки.",
        sharePercent: 50,
        paymentDue: "ON_START",
      },
      {
        title: "Изготовление",
        description: "Раскрой, кромление, сборка корпусов в цеху. Фото-отчёт.",
        sharePercent: 0,
        paymentDue: "ON_ACCEPTANCE",
      },
      {
        title: "Доставка, монтаж и сдача",
        description: "Установка на объекте, регулировка фасадов, приёмка.",
        sharePercent: 50,
        paymentDue: "ON_ACCEPTANCE",
      },
    ],
  },
  "three-part": {
    key: "three-part",
    name: "Три платежа 30/40/30",
    description: "Аванс, оплата после изготовления, остаток после монтажа",
    stages: [
      {
        title: "Аванс на материалы",
        description: "Оплата до начала работ.",
        sharePercent: 30,
        paymentDue: "ON_START",
      },
      {
        title: "Изготовление",
        description: "Корпуса и фасады готовы, фото из цеха.",
        sharePercent: 40,
        paymentDue: "ON_ACCEPTANCE",
      },
      {
        title: "Доставка, монтаж и сдача",
        description: "Установка и приёмка на объекте.",
        sharePercent: 30,
        paymentDue: "ON_ACCEPTANCE",
      },
    ],
  },
} as const satisfies Record<string, StageTemplate>;

export type StageTemplateKey = keyof typeof STAGE_TEMPLATES;
export const DEFAULT_STAGE_TEMPLATE: StageTemplateKey = "advance-50";
