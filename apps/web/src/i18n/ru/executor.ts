// Тексты экранов мастера в стиле макетов 12–19 (встреча 31.10, п. 4): «Финансы», «Мои отклики»,
// карточки входящих заявок и замеров. Деньги покупателя лежат в банке под защитой и выплачиваются мастеру банком
// после подписания акта — никогда через счета платформы (ADR-009). Без запрещённых слов (src/i18n/forbidden-words.test.ts).

export const executor = {
  incoming: {
    myOffers: "Мои отклики",
    chipsLabel: "Показать заявки",
    /** «Новые» — без отклика мастера (на карточке — метка «Новая»). */
    chips: { all: "Все", new: "Новые", direct: "Прямые мне" },
    direct: "Прямой запрос",
    myOffer: (status: string) => `Ваш отклик: ${status}`,
    emptyFilter: "В этом разделе заявок нет.",
  },

  /** Сводка мастера плитками (входящие и главная): числа из заявок, сделок и журнала выплат. */
  stats: {
    label: "Сводка",
    fresh: "Новые заявки",
    inWork: "В работе",
    earned: (month: string) => `Заработок за ${month}`,
  },

  request: {
    photosLabel: "Фото помещения",
    photoAlt: (n: number) => `Фото помещения ${n}`,
    illustration: "Иллюстрация вида мебели — заказчик не приложил фото",
    contactsHidden: "Контакты заказчика откроются после оферты",
    moreTitle: "Подробнее о заявке",
    published: "Опубликована",
  },

  offers: {
    metaTitle: "Мои отклики",
    title: "Мои отклики",
    chipsLabel: "Показать отклики",
    chips: { all: "Все", waiting: "Ждут ответа", chosen: "Выбраны", closed: "Отклонены и отозваны" },
    status: {
      SENT: "Ждёт ответа",
      chosen: "Выбран",
      measuring: "Замер назначен",
      measured: "Замер выполнен",
      contract: "Договор",
      DECLINED: "Отклонён",
      WITHDRAWN: "Отозван",
    },
    sent: (when: string) => `Отправлен ${when}`,
    measurementAt: (when: string) => `Замер ${when}`,
    emptyTitle: "Откликов пока нет",
    emptyText: "Откройте новые заявки и предложите свою цену и срок.",
    emptyAction: "Смотреть заявки",
    emptyFilter: "В этом разделе откликов нет.",
  },

  measurements: {
    chipsLabel: "Показать замеры",
    chips: { upcoming: "Предстоящие", done: "Выполненные", other: "Без сделки и отменённые" },
    emptyFilter: "В этом разделе замеров нет.",
    awaitingCount: (n: number) => `Ждут назначения: ${n}`,
  },

  portfolio: {
    count: (n: number) => `Работ: ${n}`,
    fromDeals: "Фото из завершённых заказов можно добавить кнопкой «Добавить в портфолио» на странице заказа.",
  },

  profile: {
    sections: "Разделы",
    publicProfile: "Публичная страница",
    portfolio: "Портфолио",
    finance: "Финансы",
    edit: "Данные профиля",
  },

  /** Экраны замерщика площадки (роль MEASURER, ADR-005) — в том же стиле, что и замеры исполнителя. */
  measurer: {
    chipsLabel: "Показать замеры",
    chips: { assigned: "Назначены", done: "Выполнены" },
    assignedAt: (when: string) => `Назначен ${when}`,
    doneAt: (when: string) => `Выполнен ${when}`,
    emptyFilter: "В этом разделе замеров нет.",
    visit: "Адрес выезда",
  },

  finance: {
    metaTitle: "Финансы",
    title: "Финансы",
    /** Названия месяцев: «ноябрь 2026», «Заработок за ноябрь». */
    months: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
    /** «+18% к октябрю». */
    monthsTo: ["январю", "февралю", "марту", "апрелю", "маю", "июню", "июлю", "августу", "сентябрю", "октябрю", "ноябрю", "декабрю"],
    monthLabel: "Месяц",
    prevMonth: "Предыдущий месяц",
    nextMonth: "Следующий месяц",
    monthTotal: "Получено за месяц",
    /** Изменение к прошлому месяцу в целых процентах: «+18% к октябрю», «−5% к маю», «0% к декабрю». */
    vsPrev: (percent: bigint, month: string) => `${percent > 0n ? "+" : percent < 0n ? "−" : ""}${percent < 0n ? -percent : percent}% к ${month}`,
    chartLabel: "Выплаты по месяцам",
    chartRange: (from: string, to: string) => `${from} — ${to}`,
    bar: (month: string, amount: string) => `${month}: ${amount}`,
    monthPayouts: "Выплаты за месяц",
    emptyMonth: "В этом месяце выплат не было.",
    awaitingLine: (amount: string) => `Ожидает выплаты после приёмки: ${amount} — деньги в банке под защитой`,
    awaitingTitle: "Получите после подписания акта",
    rowLine: (deal: string, date: string) => `${deal}, ${date}`,
  },
} as const;
