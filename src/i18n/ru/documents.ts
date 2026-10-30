// Тексты зоны «documents»: подписание договора и актов, ошибки, уведомления.
// Текст самого договора — шаблон в src/modules/documents/templates (это документ, а не интерфейс).
export const documents = {
  kinds: { CONTRACT: "Договор подряда", STAGE_ACT: "Акт приёмки этапа" },
  parties: { CLIENT: "Заказчик", EXECUTOR: "Исполнитель" },
  status: { SIGNING: "Ждёт подписей", SIGNED: "Подписан обеими сторонами", SUPERSEDED: "Заменён новой версией" },
  methods: {
    EGOV_QR: { label: "Через приложение eGov Mobile на телефоне", description: "Откройте приложение и наведите камеру на QR-код" },
    NCALAYER: { label: "Ключом ЭЦП на компьютере", description: "На компьютере должна быть запущена программа NCALayer" },
    MOCK: { label: "Демо-подпись", description: "Имитация подписи для показа" },
  },

  panel: {
    version: (n: number) => `версия ${n}`,
    openPdf: "Открыть PDF",
    openPdfHint: "Откроется в новой вкладке",
    technical: "Технические подробности",
    hash: "Хэш SHA-256",
    hashHint: "Подписывается именно этот файл. Хэш совпадает у обеих сторон.",
    signaturesTitle: "Подписи сторон",
    signedAt: (party: string, when: string) => `${party}: подписано ${when}`,
    notSigned: (party: string) => `${party}: ещё не подписал`,
    hashMatches: "Подписан этот же файл: хэш совпадает",
    youSigned: "Вы подписали документ",
    methodLabel: "Способ подписи",
    sign: "Подписать",
    confirmSigned: "Я подписал — проверить",
    cancel: "Выбрать другой способ",
    qrAlt: "QR-код для подписи в eGov Mobile",
    qrHint: "Откройте eGov Mobile → «Сканировать QR» и подтвердите подпись. Затем нажмите «Я подписал — проверить».",
    ncalayerHint: "Подтвердите подпись в окне NCALayer, затем нажмите «Я подписал — проверить».",
    mockNotice: "Демо-режим: подпись имитируется и не имеет юридической силы.",
    sessionExpires: (time: string) => `Сессия подписи действует до ${time}`,
    signedOk: "Подпись принята",
    fullySigned: "Документ подписан обеими сторонами",
    superseded: "Эта версия заменена. Подпишите новую версию документа.",
    operatorView: "Оператор видит документ, но не подписывает его",
  },

  errors: {
    notFound: "Документ не найден",
    operatorCannotSign: "Оператор не подписывает документы сделки",
    superseded: "Документ заменён новой версией. Откройте актуальную версию",
    alreadySigned: "Документ уже подписан обеими сторонами",
    alreadySignedByYou: "Вы уже подписали этот документ",
    signedContractChange: "Договор уже подписан. Изменить условия можно только новым договором",
    stageNotAccepted: "Акт составляется после приёмки этапа",
    noContract: "Договор по сделке ещё не сформирован",
    pending: "Подпись ещё не получена. Завершите подписание в приложении и нажмите ещё раз",
    rejected: (reason: string) => `Подпись не принята: ${reason}`,
    dealNotSignable: "Сделка уже на другом шаге — этот документ подписать нельзя. Обновите страницу",
    signerIinMissing: "Подпись сверяется с вашим ИИН, а он не указан в профиле. Обратитесь к оператору",
    otherSigner: "Подпись сделана сертификатом другого человека. Подпишите своей ЭЦП",
    damaged: "Файл документа повреждён. Сообщите оператору",
    sigexUnavailable: "Подпись через SIGEX ещё не подключена",
    ncalayerUnavailable: "Подпись через NCALayer пока недоступна. Выберите eGov Mobile",
  },

  /** Ответы провайдера подписи (mock): причина отказа показывается пользователю. */
  signatureCheck: {
    sessionExpired: "Сессия подписания не найдена или истекла",
    damaged: "Подпись повреждена",
    otherDocument: "Подписан другой документ",
    unreadable: "Не удалось прочитать подпись",
  },

  notify: {
    signedByParty: {
      title: (kind: string) => `${kind}: вторая сторона подписала`,
      body: (number: string) => `Документ № ${number} ждёт вашей подписи.`,
    },
    fullySigned: {
      title: (kind: string) => `${kind} подписан`,
      body: (number: string) => `Документ № ${number} подписан обеими сторонами.`,
    },
  },

  clientNameMissing: "ФИО заказчика не указано в профиле",
} as const;
