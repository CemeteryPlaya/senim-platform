import { pluralForm } from "./plural";

/** Форма слова по числу: «1 час», «2 часа», «5 часов». */
const word = (n: number, one: string, few: string, many: string): string => ({ one, few, many })[pluralForm(n)];

// Тексты оператора в новом интерфейсе (v2): споры и заявки без откликов. Только сотрудники площадки (зона в STAFF_ONLY
// теста слов мастера): тут законны «доход платформы», «отклики». Слова «эскроу» в ru.app нет (тест запретных слов):
// счёт сделки в банке называется «счёт сделки в банке».

/** Статусы сделки по ТЗ п. 9 — формулировки для оператора. */
const dealStatus = {
  CREATED: "Оферта: подпись и оплата",
  PAID_HOLD: "Оплачено, работа не начата",
  IN_PROGRESS: "Идут работы",
  READY: "Сдана, ждёт акта",
  ACCEPTED: "Акт подписан, ждёт выплаты",
  SPLIT_PAYOUT: "Завершена, выплачено",
  CANCELLED: "Отменена до оплаты",
  REFUNDED: "Деньги возвращены",
} as const;

export const operatorDisputes = {
  dealStatus,
  deal: (n: number) => `Сделка №${n}`,
  none: "—",

  disputes: {
    metaTitle: "Споры",
    title: "Споры",
    lead: "Открытые споры — первыми. Решение делит деньги сделки, поэтому перед ним спросим код из приложения.",
    empty: { title: "Споров нет", body: "Когда сторона откроет спор, он появится здесь." },
    status: { OPEN: "Открыт", RESOLVED: "Решён" },
    reasons: { QUALITY: "Качество работы", DEADLINE: "Сроки", SCOPE: "Не по договору", PAYMENT: "Оплата", OTHER: "Другое" },
    outcomes: {
      CONTINUE: "Продолжить работу",
      FULL_REFUND: "Полный возврат покупателю",
      PARTIAL_SPLIT: "Частичный раздел",
    },
    columns: { deal: "Сделка", status: "Статус", reason: "Причина", openedIn: "Этап при открытии", openedAt: "Открыт", price: "Цена по оферте" },
  },

  card: {
    metaTitle: "Спор по сделке",
    title: (n: number) => `Спор по сделке №${n}`,
    back: "Споры",
    openedAt: (date: string, stage: string) => `Открыт ${date}. Этап сделки при открытии: ${stage}`,
    description: "Описание",
    clientPosition: "Позиция покупателя",
    executorPosition: "Позиция мастера",
    noPosition: "Сторона ещё не написала позицию",
    now: "Что сейчас",
    positions: "Позиции сторон",
    attachments: "Вложения",
    noAttachments: "Вложений нет",
    attachment: (contentType: string, sizeKb: number) => `${contentType}, ${sizeKb} КБ`,
    attachmentHash: "SHA-256",
    history: "История сделки",
    historyEmpty: "Событий пока нет",
    historyActor: (role: string, entity: string) => `${role} · ${entity}`,
    parties: "Стороны",
    client: "Покупатель",
    executor: "Мастер",
    executorValue: (n: number, name: string) => `№${n}, ${name}`,
    price: "Цена по оферте",
    paid: "Покупатель вносит (с защитой сделки 2%)",
    provider: "Провайдер оплаты",
    providers: { MOCK: "Тестовый (mock)", MANUAL: "Ручной: банк без API", FREEDOMPAY: "Freedom Pay, песочница" },
    openDeal: "Открыть карточку сделки",
    aiHint: "Подсказка ИИ по спору",
    aiHintText: "Флаг ai включён, но подсказки по спорам пока нет: решение принимает оператор.",
  },

  /** Блок денег и журнал денег сделки: по журналу операций, не по статусу сделки. */
  money: {
    section: "Деньги сделки",
    history: "Журнал денег",
    historyEmpty: "Движений денег нет",
    bankBalance: "Остаток на счёте сделки по журналу",
    test: "Тестовые деньги: настоящие не списываются",
    testMark: "тестовая",
    awaiting: "Оплаты ещё нет",
    protected: "Деньги на счёте сделки в банке",
    frozen: "Выплата заморожена до решения спора",
    completed: "Выплачено мастеру",
    completedPending: "Мастеру к выплате: ждёт подтверждения банка",
    refunded: "Возвращено покупателю",
    refundedPending: "Возврат покупателю: ждёт подтверждения банка",
    types: {
      HOLD: "Оплата покупателя на счёт сделки",
      FREEZE: "Выплата заморожена (спор)",
      UNFREEZE: "Заморозка снята",
      SPLIT_MASTER: "Выплата мастеру",
      SPLIT_PLATFORM: "Доход платформы",
      REFUND: "Возврат покупателю",
    },
    status: { PENDING: "ждёт банка", SUCCEEDED: "подтверждена", FAILED: "отклонена банком" },
  },

  decision: {
    title: "Решение",
    outcomeLegend: "Итог спора",
    outcomeHints: {
      CONTINUE: "Заморозка снимается, сделка продолжается с этапа, на котором открыли спор",
      FULL_REFUND: "Покупателю возвращается всё оплаченное, включая защиту сделки 2%",
      PARTIAL_SPLIT: "Мастеру — часть цены за вычетом 4%, остаток возвращается покупателю",
    },
    shareLabel: "Сумма мастеру из цены",
    shareRequired: "Введите сумму мастеру из цены",
    shareHint: (max: string) => `Целые тенге, не больше ${max}`,
    previewTitle: "Расчёт раздела",
    previewButton: "Рассчитать раздел",
    previewWaiting: "Введите сумму мастеру и нажмите «Рассчитать раздел»",
    previewStale: "Сумма изменилась: рассчитайте раздел заново",
    previewMaster: "Мастеру (сумма минус 4%)",
    previewPlatform: "Доход платформы",
    previewRefund: "Возврат покупателю",
    rationaleLabel: "Обоснование",
    rationaleHint: "Обязательно, до 2000 знаков. Увидят обе стороны; сохраняется для разбора похожих споров.",
    submit: "Принять решение",
    done: "Решение принято",
  },

  resolved: {
    title: "Решение принято",
    outcome: "Итог",
    masterShare: "Сумма мастеру из цены",
    rationale: "Обоснование",
    resolvedAt: "Решение принято",
    resolvedBy: (date: string, name: string | null) => (name ? `${date}, ${name}` : date),
  },

  requests: {
    metaTitle: "Заявки без откликов",
    title: "Заявки без откликов",
    lead: "Открытые заявки, на которые никто не откликнулся или все отклики отклонены.",
    filter: "Сколько ждут откликов",
    presets: { "24": "Дольше суток", "72": "Дольше 3 суток", "168": "Дольше недели", "720": "Дольше месяца" } as Record<string, string>,
    custom: (h: number) => `Дольше ${h} ${word(h, "часа", "часов", "часов")}`,
    empty: { title: "Таких заявок нет", body: "Все открытые заявки получили отклики вовремя." },
    tableCaption: "Заявки без откликов",
    request: (n: number) => `Заявка №${n}`,
    mode: { TENDER: "Тендер", DIRECT: "Прямая" },
    segments: { ECONOMY: "Эконом", COMFORT: "Комфорт", PREMIUM: "Премиум" },
    columns: { request: "Заявка", type: "Что сделать", mode: "Режим", client: "Заказчик", published: "Опубликована", waiting: "Ждёт", declined: "Отклонено откликов" },
    hours: (h: number) => `${h} ${word(h, "час", "часа", "часов")}`,
    phoneCall: (phone: string) => `Позвонить заказчику: ${phone}`,
    preContract: {
      title: "Сценарии до оферты",
      body: "Замерщик площадки и повторный отклик включены, но в новом интерфейсе их пока нет — они остаются в прежней версии раздела.",
      link: "Открыть в прежней версии",
    },
  },
} as const;
