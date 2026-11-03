// Тексты зоны «payments»: деньги сделки по ТЗ п. 4–6 (ADR-009) — блок денег, история денег, смета сторон,
// уведомления об изменении денег, подтверждение операций оператором (провайдер manual).
// В текстах покупателя и мастера нет слов «комиссия» и «эскроу»: только «деньги в банке под защитой»,
// «Защита сделки (2%)», «Гарантия оплаты и клиента (4%)».

type Party = "CLIENT" | "EXECUTOR";

export const payments = {
  /** Назначение платежа и причина возврата для провайдера: без персональных данных. */
  purpose: (dealNumber: number) => `Оплата по сделке №${dealNumber}`,
  refundReason: (dealNumber: number) => `Возврат по сделке №${dealNumber}`,

  /** Смета до оплаты (ТЗ п. 5): покупатель и мастер видят суммы и проценты заранее. */
  estimate: {
    title: "Смета",
    CLIENT: { price: "Стоимость заказа", extra: "Защита сделки (2%)", total: "Итого к оплате" },
    EXECUTOR: { price: "Сумма заказа", extra: "Гарантия оплаты (4%)", total: "К выплате" },
  },

  /** Блок денег — первый блок карточки сделки (ТЗ п. 4.1, 4.2): строится из журнала, не из статуса. */
  block: {
    awaiting: { title: "Ожидает оплаты", CLIENT: "Деньги ещё не внесены", EXECUTOR: "Деньги покупателя будут зарезервированы в банке до начала работ" },
    pending: { title: "Оплата в обработке", text: "Банк подтверждает поступление денег" },
    failed: { title: "Оплата не прошла", CLIENT: "Деньги не списаны. Попробуйте оплатить ещё раз", EXECUTOR: "Покупатель может оплатить ещё раз" },
    /** Зеркальный блок у мастера ещё в карточке заявки, до оплаты. */
    masterBeforePayment: "Деньги покупателя будут зарезервированы в банке до начала работ",
    protected: {
      CLIENT: (amount: string) => `${amount} — под защитой банка. Недоступны мастеру до вашей подписи акта`,
      EXECUTOR: (amount: string) => `Деньги зарезервированы: ${amount} — получите после подписания акта покупателем`,
    } satisfies Record<Party, (amount: string) => string>,
    reservedAt: (date: string) => `Зарезервировано ${date}`,
    operationRef: (ref: string) => `Операция № ${ref}`,
    frozen: { title: "Выплата заморожена до решения спора", text: (amount: string) => `Сумма к выплате: ${amount}` },
    completed: {
      title: "Сделка завершена",
      pending: "Банк проводит выплату",
      paid: { CLIENT: (amount: string) => `Выплачено мастеру: ${amount}`, EXECUTOR: (amount: string) => `Выплачено вам: ${amount}` } satisfies Record<Party, (amount: string) => string>,
      toPay: { CLIENT: (amount: string) => `К выплате мастеру: ${amount}`, EXECUTOR: (amount: string) => `К выплате вам: ${amount}` } satisfies Record<Party, (amount: string) => string>,
      protection: (amount: string) => `Защита сделки: ${amount}`,
      refunded: (amount: string) => `Возвращено покупателю: ${amount}`,
    },
    refunded: {
      title: (amount: string) => `Деньги вернулись покупателю: ${amount}`,
      pending: { CLIENT: "Деньги вернутся на вашу карту", EXECUTOR: "Банк возвращает деньги покупателю" } satisfies Record<Party, string>,
      amount: (amount: string) => `Сумма возврата: ${amount}`,
    },
    testPayment: "Тестовый платёж — настоящие деньги не списываются",
    openHistory: "История денег",
  },

  /** История денег (тап по блоку денег) и выписка. */
  history: {
    title: "История денег",
    empty: "Движений денег пока нет.",
    type: {
      HOLD: "Деньги зарезервированы в банке",
      FREEZE: "Выплата удержана на время спора",
      UNFREEZE: "Удержание снято",
      SPLIT_MASTER: "Выплачено мастеру",
      SPLIT_PLATFORM: "Защита сделки и гарантия оплаты",
      REFUND: "Возвращено покупателю",
    },
    status: { PENDING: "В обработке банком", SUCCEEDED: "Выполнено", FAILED: "Не прошло" },
    basis: "Документ-основание",
    testMark: "тестовый платёж",
    statement: "Выписка по сделке (PDF)",
  },

  /** Уведомления обеим сторонам на каждое изменение денег (onMoneyChanged). */
  notify: {
    HOLD: {
      SUCCEEDED: {
        CLIENT: (n: number, amount: string) => ({ title: "Деньги под защитой банка", body: `Сделка №${n}: ${amount} зарезервированы в банке.` }),
        EXECUTOR: (n: number, amount: string) => ({ title: "Деньги зарезервированы", body: `Сделка №${n}: покупатель внёс ${amount}. Можно начинать работу.` }),
      },
      FAILED: {
        CLIENT: (n: number) => ({ title: "Оплата не прошла", body: `Сделка №${n}: деньги не списаны. Попробуйте ещё раз.` }),
        EXECUTOR: (n: number) => ({ title: "Оплата покупателя не прошла", body: `Сделка №${n}: покупатель может оплатить ещё раз.` }),
      },
    },
    FREEZE: {
      CLIENT: (n: number) => ({ title: "Выплата заморожена", body: `Сделка №${n}: открыт спор, деньги остаются в банке до решения.` }),
      EXECUTOR: (n: number) => ({ title: "Выплата заморожена", body: `Сделка №${n}: открыт спор, выплата — после решения.` }),
    },
    UNFREEZE: {
      CLIENT: (n: number) => ({ title: "Спор решён", body: `Сделка №${n}: заморозка денег снята.` }),
      EXECUTOR: (n: number) => ({ title: "Спор решён", body: `Сделка №${n}: заморозка выплаты снята.` }),
    },
    SPLIT_MASTER: {
      CLIENT: (n: number, amount: string) => ({ title: "Мастер получил оплату", body: `Сделка №${n}: банк выплатил мастеру ${amount}.` }),
      EXECUTOR: (n: number, amount: string) => ({ title: "Выплата получена", body: `Сделка №${n}: банк перечислил вам ${amount}.` }),
    },
    REFUND: {
      CLIENT: (n: number, amount: string) => ({ title: "Деньги возвращены", body: `Сделка №${n}: ${amount} возвращены на вашу карту.` }),
      EXECUTOR: (n: number, amount: string) => ({ title: "Деньги возвращены покупателю", body: `Сделка №${n}: банк вернул покупателю ${amount}.` }),
    },
    failed: {
      CLIENT: (n: number) => ({ title: "Операция банка не прошла", body: `Сделка №${n}: оператор разберётся и сообщит.` }),
      EXECUTOR: (n: number) => ({ title: "Операция банка не прошла", body: `Сделка №${n}: оператор разберётся и сообщит.` }),
    },
  },

  validation: {
    bankDocNumber: "Укажите номер банковского документа",
    bankDocDate: "Укажите дату банковского документа",
    bankDocFile: "Приложите скан банковского документа",
    failReason: "Опишите причину — хотя бы 5 символов",
  },

  errors: {
    operationNotFound: "Операция не найдена",
    notPending: "Операция уже проведена — обновите страницу",
    notManual: "Эту операцию подтверждает банк автоматически",
    bankDocInvalid: "Скан банковского документа не найден или уже приложен к другой операции",
    bankDocInFuture: "Дата банковского документа не может быть в будущем",
    keyReused: "Операция с этим ключом уже записана с другими данными",
    providerNotConnected: "Платёжный провайдер не подключён",
    badWebhook: "Уведомление провайдера не принято",
  },
} as const;
