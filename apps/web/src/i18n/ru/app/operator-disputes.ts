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
    /** Под чипами статуса и этапа: дата открытия; этап при открытии — только если сделка с тех пор ушла на другой этап. */
    openedAt: (date: string) => `С ${date}`,
    openedAtStage: (date: string, stage: string) => `С ${date}. Этап при открытии: ${stage}`,
    description: "Описание",
    clientPosition: "Позиция покупателя",
    executorPosition: "Позиция мастера",
    noPosition: "Сторона ещё не написала позицию",
    now: "Что сейчас",
    positions: "Позиции сторон",
    attachments: "Вложения",
    attachment: (contentType: string, sizeKb: number) => `${contentType}, ${sizeKb} КБ`,
    attachmentHash: "SHA-256",
    history: "История сделки",
    historyEmpty: "Событий пока нет",
    /** Строка под событием истории: время и кто, одной строкой. */
    historyWhen: (time: string, role: string) => `${time} · ${role}`,
    parties: "Стороны",
    client: "Покупатель",
    executor: "Мастер",
    executorValue: (n: number, name: string) => `№${n}, ${name}`,
    price: "Цена по оферте",
    /** Только у старых сделок с защитой сделки 2 % (сумма покупателя ≠ цене); по ADR-015 покупатель платит ровно цену. */
    paid: "Покупатель вносит",
    provider: "Провайдер оплаты",
    providers: { MOCK: "Тестовый (mock)", MANUAL: "Ручной: банк без API", FREEDOMPAY: "Freedom Pay, песочница" },
    openDeal: "Открыть карточку сделки",
    aiHint: "Подсказка ИИ по спору",
    aiHintText: "Подсказок по спорам пока нет: решение принимает оператор.",
  },

  /** Блок денег и журнал денег сделки: по журналу операций, не по статусу сделки. */
  money: {
    section: "Деньги сделки",
    history: "Журнал денег",
    historyEmpty: "Движений денег нет",
    bankBalance: "Остаток на счёте сделки по журналу",
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
      FULL_REFUND: "Покупателю возвращается всё оплаченное",
      PARTIAL_SPLIT: "Мастеру — часть цены за вычетом 6%, остаток возвращается покупателю",
    },
    shareLabel: "Сумма мастеру из цены",
    shareRequired: "Введите сумму мастеру из цены",
    shareHint: (max: string) => `Целые тенге, не больше ${max}`,
    previewTitle: "Расчёт раздела",
    previewButton: "Рассчитать раздел",
    previewWaiting: "Введите сумму мастеру и нажмите «Рассчитать раздел»",
    previewFirst: "Сначала рассчитайте раздел: решение принимается по расчёту",
    previewStale: "Сумма изменилась: рассчитайте раздел заново",
    previewMaster: "Мастеру (сумма минус 6%)",
    previewPlatform: "Доход платформы",
    previewRefund: "Возврат покупателю",
    rationaleLabel: "Обоснование",
    rationaleHint: "Увидят обе стороны. До 2000 знаков.",
    confirm: {
      FULL_REFUND: {
        title: "Вернуть деньги покупателю?",
        body: (refund: string) => `Покупателю вернётся ${refund} — всё оплаченное. Мастер ничего не получит. Решение нельзя отменить.`,
        action: "Вернуть деньги",
      },
      PARTIAL_SPLIT: {
        title: "Разделить деньги по спору?",
        body: (master: string, platform: string, refund: string) =>
          `Мастеру — ${master}, доход платформы — ${platform}, покупателю вернётся ${refund}. Решение нельзя отменить.`,
        action: "Разделить деньги",
      },
      cancel: "Не сейчас",
    },
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
    lead: "В том числе те, где все отклики отклонены.",
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

  /** Файлы заявки: дизайн-проект покупателя, оператор скрывает файл с контактами и возвращает его. */
  requestFiles: {
    metaTitle: "Файлы заявки",
    title: (n: number) => `Файлы заявки №${n}`,
    back: "Заявки без откликов",
    /** Только когда файлы есть: без файлов скрывать нечего. */
    lead: "Дизайн-проект покупателя. Если в файле остались телефон, адрес или имя — скройте его: мастера и сделка файл не увидят, покупатель увидит пометку.",
    /** Ссылка из карточки сделки. */
    link: "Файлы заявки",
    /** Форма на странице «Заявки без откликов». */
    open: { title: "Открыть заявку", number: "Номер заявки", submit: "Открыть" },
    tableCaption: "Файлы дизайн-проекта",
    columns: { file: "Файл", state: "Мастерам", action: "Действие" },
    pdf: (n: number) => `Дизайн-проект, файл ${n} (PDF)`,
    photo: (n: number) => `Дизайн-проект, фото ${n}`,
    shown: "Виден",
    hidden: "Скрыт",
    hide: "Скрыть",
    restore: "Вернуть",
    hideLabel: (file: string) => `Скрыть: ${file}`,
    restoreLabel: (file: string) => `Вернуть: ${file}`,
    hiddenDone: "Файл скрыт",
    restoredDone: "Файл возвращён",
    empty: { title: "Покупатель не прикладывал дизайн-проект", body: "Когда покупатель приложит файлы к заявке, они появятся здесь." },
    notFound: "Нет заявки с таким номером",
  },
} as const;
