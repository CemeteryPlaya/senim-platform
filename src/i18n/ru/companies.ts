// Тексты зоны «companies»: профиль исполнителя, портфолио, каталог, публичная страница, чат.
export const companies = {
  errors: {
    executorNotFound: "Исполнитель не найден",
  },
  chat: {
    /** Подставляется вместо телефона, e-mail, ссылки или мессенджера. Хранится в БД как часть текста. */
    maskPlaceholder: "[контакт скрыт]",
    title: "Чат с исполнителем",
    titleForExecutor: "Чат с заказчиком",
    clientLabel: "Заказчик",
    operatorReadOnly: "Оператор видит переписку, но не пишет в неё",
    note: "Общение — только здесь. Телефоны, ссылки и e-mail скрываются автоматически.",
    closed: {
      offerWithdrawn: "Исполнитель отозвал отклик — чат закрыт",
      offerDeclined: "Отклик отклонён — чат закрыт",
      requestCancelled: "Заявка отменена — чат закрыт",
      dealCancelled: "Сделка отменена — чат закрыт",
      dealTerminated: "Сделка расторгнута — чат закрыт",
    },
    errors: {
      notFound: "Переписка не найдена",
      empty: "Напишите сообщение",
      tooLong: (max: number) => `Сообщение не длиннее ${max} символов`,
      tooManyAttachments: (max: number) => `Можно прикрепить не больше ${max} файлов`,
      badAttachment: "Не удалось прикрепить файл. Загрузите его ещё раз",
      rateLimited: "Слишком много сообщений подряд. Подождите минуту",
    },
    notify: {
      title: (from: string) => `Новое сообщение: ${from}`,
    },
  },
} as const;
