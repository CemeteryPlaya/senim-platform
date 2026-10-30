// Тексты зоны «companies»: профиль исполнителя, портфолио, каталог, публичная страница, чат.
export const companies = {
  errors: {
    executorNotFound: "Исполнитель не найден",
    executorOnly: "Раздел доступен только исполнителю",
    invalid: "Проверьте заполнение полей",
    unknownFurnitureType: "Выберите тип мебели из списка",
  },
  photoAlt: (title: string, n: number) => `${title} — фото ${n}`,
  profile: {
    errors: {
      aboutTooLong: (max: number) => `Расскажите о себе короче — до ${max} символов`,
      experience: "Укажите опыт целым числом лет, от 0 до 60",
      fee: (min: number, max: number) => `Укажите плату за выезд от ${min.toLocaleString("ru-RU")} до ${max.toLocaleString("ru-RU")} ₸`,
    },
  },
  portfolio: {
    errors: {
      notFound: "Работа не найдена",
      type: "Выберите тип мебели",
      style: "Выберите стиль",
      title: (min: number, max: number) => `Название — от ${min} до ${max} символов`,
      description: (max: number) => `Описание — до ${max} символов`,
      price: "Укажите цену целым числом в тенге",
      hasRequests: "По этой работе уже есть заявки. Её можно снять с публикации, но не удалить",
      tooManyPhotos: (max: number) => `У работы может быть не больше ${max} фото`,
      badPhoto: "Не удалось прикрепить фото. Загрузите его ещё раз",
      photoNotFound: "Фото не найдено",
    },
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
