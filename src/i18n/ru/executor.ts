// Тексты экранов исполнителя в стиле макетов 12–19 (встреча 31.10, п. 4): «Финансы», «Мои отклики»,
// карточки входящих заявок и замеров. Деньги идут заказчик → исполнитель напрямую или банком —
// никогда через площадку; в режиме manual нет слов «эскроу» и «безопасная оплата». Комиссии нет (№3).

export const executor = {
  incoming: {
    myOffers: "Мои отклики",
    chipsLabel: "Показать заявки",
    chips: { all: "Все", new: "Без отклика", direct: "Прямые мне" },
    direct: "Прямой запрос",
    offers: (n: number) => (n === 0 ? "Откликов пока нет — будьте первым" : `Откликов: ${n}`),
    myOffer: (status: string) => `Ваш отклик: ${status}`,
    emptyFilter: "В этом разделе заявок нет.",
  },

  request: {
    photosLabel: "Фото помещения",
    photoAlt: (n: number) => `Фото помещения ${n}`,
    illustration: "Иллюстрация вида мебели — заказчик не приложил фото",
    keyFacts: "Коротко о заявке",
    fact: { type: "Что нужно", segment: "Уровень", city: "Город", desired: "Желаемый срок", published: "Опубликована", offers: "Откликов" },
    noDate: "Не указан",
  },

  offers: {
    metaTitle: "Мои отклики",
    title: "Мои отклики",
    lead: "Все отправленные предложения и ответы заказчиков.",
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
    publicHint: "Как вас видят заказчики",
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
    /** Названия месяцев: «Заработок за ноябрь 2026», «Оплаты за ноябрь». */
    months: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
    monthNav: "Выбор месяца",
    prevMonth: (month: string) => `Предыдущий месяц: ${month}`,
    nextMonth: (month: string) => `Следующий месяц: ${month}`,
    earnedIn: (month: string) => `Заработок за ${month}`,
    /** Сравнение с прошлым месяцем; сумма уже со знаком «+» или «−». */
    vsPrevious: (delta: string) => `${delta} к прошлому месяцу`,
    sameAsPrevious: "Как в прошлом месяце",
    totalsLabel: "Ожидается и в работе",
    totals: {
      expected: "Ожидается",
      upcoming: "В работе",
    },
    paidIn: (month: string) => `Оплаты за ${month}`,
    emptyMonth: "В этом месяце оплат не было.",
    waitingTitle: "Ждут оплаты",
    stageLine: (stage: string, rest: string) => `Этап «${stage}» · ${rest}`,
    status: {
      confirm: "Подтвердите получение",
      waitClient: "Ждёт оплаты заказчиком",
      waitBank: "Банк перечисляет",
    },
    confirmTitle: "Заказчик отметил оплату",
    confirmText: (count: number) =>
      count === 1 ? "Проверьте поступление и подтвердите на странице заказа." : `Таких оплат: ${count}. Проверьте поступления и подтвердите на страницах заказов.`,
    noteManual: "Деньги идут от заказчика напрямую вам. Комиссии нет.",
    noteEscrow: "Оплату этапа со счёта сделки банк перечисляет после приёмки. Комиссии нет.",
  },
} as const;
