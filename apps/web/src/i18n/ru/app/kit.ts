/** Русское склонение: 1 (кроме 11), 2–4 (кроме 12–14), остальное. */
function pluralForm(n: number): "one" | "few" | "many" {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "one";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
  return "many";
}

// Тексты компонентов дизайн-системы (src/kit): то, что компонент показывает сам, без участия экрана.
export const kit = {
  close: "Закрыть",
  back: "Назад",
  pending: "Подождите",
  loading: "Загрузка",
  /** Значение полосы прогресса для диктора: «2 из 3». */
  progress: (value: number, max: number) => `${value} из ${max}`,
  /** Кнопка отказа в окне подтверждения (ConfirmDialog). */
  cancel: "Отмена",
  /** Кнопка, закрывающая пояснение-шторку (Explain на телефоне). */
  understood: "Понятно",
  /** Подпись области тостов для экранного диктора. */
  notifications: "Уведомления",
  /** Поля с подсказкой формата. */
  fields: {
    phonePlaceholder: "+7 700 123 45 67",
  },
  /** Постраничный переход (Pagination). */
  pagination: {
    prev: "Назад",
    next: "Вперёд",
    pageOf: (page: number, count: number) => `Страница ${page} из ${count}`,
  },
  workCard: {
    /** Перед суммой: «от 1 224 000 ₸». */
    priceFrom: "от",
  },
  rating: {
    /** «4,8 · 12 отзывов». */
    summary: (value: number, count: number) => {
      const form = pluralForm(count);
      const word = form === "one" ? "отзыв" : form === "few" ? "отзыва" : "отзывов";
      return `${value.toFixed(1).replace(".", ",")} · ${count} ${word}`;
    },
    none: "Пока без отзывов",
  },
  firstSteps: {
    /** Заголовок списка первых шагов: «Остался 1 шаг», «Осталось 2 шага», «Осталось 5 шагов». */
    left: (n: number) => {
      const form = pluralForm(n);
      if (form === "one") return `Остался ${n} шаг`;
      return form === "few" ? `Осталось ${n} шага` : `Осталось ${n} шагов`;
    },
    /** Подпись полосы прогресса первых шагов. */
    progressLabel: "Первые шаги",
    /** Скрытая пометка выполненного шага для диктора. */
    doneMark: "Выполнено",
  },
  nowNext: {
    now: "Сейчас",
    next: "Дальше",
  },
  help: {
    title: "Помощь",
    contact: "Написать в поддержку",
  },
  wizard: {
    /** Над заголовком мастера: «Шаг 2 из 5». */
    step: (step: number, total: number) => `Шаг ${step} из ${total}`,
    progressLabel: "Шаги",
  },
  /** Витрина компонентов (/v2/ui-kit, только dev): подписи разделов и образцов. */
  showcase: {
    title: "Витрина компонентов",
    lead: "Все части дизайн-системы в одном месте. Страница есть только в разработке.",
    sections: {
      colors: "Цвета",
      typography: "Типографика",
      buttons: "Кнопки",
      links: "Кнопки-ссылки",
      fields: "Поля",
      choices: "Флажки и выбор",
      cards: "Карточки и списки",
      chips: "Статусы",
      progress: "Прогресс",
      money: "Деньги",
      photos: "Места под фото",
      skeleton: "Загрузка",
      guidance: "Блоки подсказок",
      wizard: "Шапка мастера",
      explain: "Пояснение",
      overlays: "Шторка, окна и тосты",
      theme: "Переключатель темы",
      layout: "Раскладка",
      notices: "Сообщения, телефон и код",
      filters: "Фильтры и страницы",
      works: "Карточка работы и оценка",
      dock: "Главное действие над панелью вкладок",
      form: "Форма с действием",
    },
    notices: {
      infoTitle: "Заявка принята",
      infoBody: "Мастера увидят её сегодня и пришлют цены.",
      warnBody: "Сервис отвечает медленнее обычного. Подождите минуту и повторите.",
      dangerTitle: "Не удалось отправить",
      dangerBody: "Проверьте соединение и нажмите ещё раз.",
      info: "Информация",
      warn: "Внимание, живая область (role=alert)",
      danger: "Ошибка",
    },
    codes: {
      phoneLabel: "Телефон",
      phoneError: "Укажите номер полностью",
      codeLabel: "Код из сообщения",
      codeError: "Код не подошёл. Проверьте цифры.",
      phone: "Телефон",
      code: "Код",
      withError: "С ошибкой",
    },
    filters: {
      label: "Категории",
      all: "Все",
      kitchens: "Кухни",
      wardrobes: "Шкафы",
      beds: "Кровати",
      tables: "Столы",
      children: "Детская мебель",
      offices: "Офисная мебель",
      pagesLabel: "Страницы каталога",
      chips: "Фильтры-ссылки: выбран один, строка прокручивается",
      middle: "Постраничный переход, середина",
      first: "Постраничный переход, первая страница",
    },
    works: {
      title: "Кухня с островом",
      meta: "Алматы · Асхат К.",
      withPhoto: "С фото",
      noPhoto: "Без фото, с ценой «от»",
      noPrice: "Без цены",
      photoAlt: "Кухня с островом",
      rating: "Оценка",
      noReviews: "Пока без отзывов",
    },
    formSample: {
      label: "Значение",
      submit: "Отправить",
      fieldError: "Образец: сервер вернул ошибку у поля",
      note: "Форма на useActionForm: отправка через onSubmit, ошибка у поля, введённое остаётся.",
    },
    dockPage: {
      title: "Док над панелью вкладок",
      lead: "Служебная страница для проверки прилипания дока: длинное содержимое, док — последним в колонке.",
      paragraph: (n: number) => `Абзац ${n}: содержимое экрана прокручивается под доком.`,
      last: "Последний элемент содержимого.",
      primary: "Отправить заявку",
      quiet: "Сохранить черновик",
    },
    dock: {
      note: "На телефоне док прилипает над панелью вкладок, пока виден этот образец; на компьютере стоит обычным блоком в потоке.",
      primary: "Отправить заявку",
      quiet: "Сохранить черновик",
      filler: "Содержимое экрана идёт выше и прокручивается под кнопкой.",
    },
    layout: {
      main: "Split, левая колонка — 1,5 части: основное содержимое.",
      aside: "Правая колонка — 1 часть: помощь, сводка.",
      note: "На компьютере — две колонки с зазором 24 px, на телефоне — одна колонка. Формы и строки «подпись — значение» на компьютере не шире 560 px (Narrow).",
    },
    colors: {
      canvas: "canvas — фон страницы",
      surface: "surface — карточка",
      raised: "raised — шторка, окно, тост",
      ink: "ink — основной текст",
      muted: "muted — вторичный текст",
      line: "line — разделитель",
      lineStrong: "line-strong — граница поля",
      track: "track — дорожка переключателя",
      action: "action — главная кнопка",
      onAction: "on-action — текст на кнопке",
      accent: "accent — ссылка, прогресс",
      accentSoft: "accent-soft — фон чипа",
      danger: "danger — ошибка",
      dangerSoft: "danger-soft — фон ошибки",
      warn: "warn — внимание",
      warnSoft: "warn-soft — фон внимания",
      focus: "focus — кольцо фокуса",
      scrim: "scrim — затемнение",
    },
    typography: {
      title: "Заголовок экрана — 28 / 32 px",
      section: "Заголовок раздела — 20 px",
      card: "Заголовок карточки — 17 px, 600",
      body: "Основной текст — 17 px. Договор и деньги написаны простыми словами, без мелкого шрифта.",
      sub: "Вторичный текст — 15 px. Пояснения и подписи к полям.",
      small: "Мелкий текст — 13 px. Только несущественное.",
    },
    buttons: {
      primary: "Главное",
      secondary: "Второе",
      quiet: "Тихая",
      danger: "Удалить",
      sizeMd: "Размер md — 48 px",
      sizeSm: "Размер sm — 36 px, на телефоне 48 px; у главной кнопки его нет",
      states: {
        normal: "Обычная",
        pending: "Ожидание",
        disabled: "Отключена",
      },
      full: "На всю ширину",
    },
    links: {
      primary: "Перейти",
      secondary: "Подробнее",
      quiet: "Все разделы",
      /** Образец «Назад»: шеврон и название родителя. */
      back: "«Назад» — шеврон и название родителя",
      backParent: "Мои заявки",
    },
    fields: {
      textLabel: "Имя",
      textPlaceholder: "Как к вам обращаться",
      textFilled: "Айгерим",
      textError: "Укажите имя",
      areaLabel: "Комментарий",
      areaPlaceholder: "Что важно знать мастеру",
      areaFilled: "Нужна кухня до окна, высота потолка 2,7 метра.",
      areaError: "Напишите хотя бы несколько слов",
      selectLabel: "Город",
      selectPlaceholder: "Выберите город",
      selectOptions: ["Алматы", "Астана", "Шымкент"],
      selectError: "Выберите город",
      states: {
        empty: "Пустое",
        filled: "Заполненное",
        error: "С ошибкой",
        disabled: "Отключено",
      },
    },
    choices: {
      unchecked: "Согласен с условиями",
      checked: "Получать уведомления",
      disabled: "Недоступный пункт",
      disabledChecked: "Недоступный, отмеченный",
      error: "Нужно согласие",
      errorText: "Отметьте, чтобы продолжить",
      groupLegend: "Как связаться",
      groupError: "Выберите способ связи",
      phone: "По телефону",
      chat: "В чате",
      mail: "По почте",
      checkboxes: "Флажки",
      radios: "Выбор из вариантов",
    },
    cards: {
      cardTitle: "Карточка",
      cardBody: "Белая карточка без рамки и тени, радиус 18 px.",
      listValues: "Строки со значением",
      listLinks: "Строки-ссылки",
      rowStatus: "Статус",
      rowStatusValue: "В работе",
      rowDate: "Срок",
      rowDateValue: "до 28 ноября",
      rowAbout: "О защите сделки",
      rowRules: "Правила работы",
    },
    chips: {
      accent: "Готово",
      neutral: "Черновик",
      warn: "Ждёт ответа",
      danger: "Отменено",
    },
    progress: {
      zero: "Не начато",
      partial: "Две из четырёх",
      full: "Всё готово",
    },
    money: {
      zero: "Ноль",
      tiyn: "С тиынами",
      negative: "Минус",
      large: "Крупная сумма",
    },
    photos: {
      r43: "4 : 3",
      r11: "1 : 1",
      r169: "16 : 9",
      alt: "Место под фото",
    },
    skeleton: {
      lines: "Три строки",
      one: "Одна строка",
    },
    guidance: {
      nowTitle: "Мастер замеряет кухню",
      nowBody: "Он приедет завтра к 10:00 и напишет, когда будет у двери.",
      next: "Вы утвердите замеры",
      stepOne: "Заполнить профиль",
      stepTwo: "Описать, что нужно",
      stepThree: "Выбрать мастера",
      emptyTitle: "Заявок пока нет",
      emptyBody: "Расскажите, какая мебель нужна, и мастера предложат цену.",
      emptyAction: "Создать заявку",
      helpOne: "Как работает защита сделки",
      helpTwo: "Что делать, если мастер опаздывает",
    },
    wizard: {
      title: "Что нужно сделать",
      note: "Заголовок образца — второго уровня: заголовок первого уровня на странице уже есть.",
    },
    explain: {
      label: "Что это значит?",
      title: "Защита сделки",
      body: "Деньги лежат в банке и уходят мастеру только после того, как вы приняли работу.",
    },
    overlays: {
      sheetOpen: "Открыть шторку",
      sheetTitle: "Шторка",
      sheetBody: "Ответ, подтверждение или выбор из списка.",
      dialogOpen: "Открыть окно",
      dialogTitle: "Окно по центру",
      dialogBody: "Так выглядит окно на компьютере.",
      confirmOpen: "Подтверждение",
      confirmTitle: "Принять работу?",
      confirmBody: "Деньги будут переданы мастеру.",
      confirmLabel: "Принять работу",
      confirmDangerOpen: "Опасное подтверждение",
      confirmDangerTitle: "Отменить сделку?",
      confirmDangerBody: "Это действие нельзя отменить.",
      confirmDangerLabel: "Отменить сделку",
      toastOpen: "Показать тост",
      toastText: "Сохранено",
      toastLoadingOpen: "Показать тост загрузки",
      toastLoadingText: "Отправляем",
      toastDone: "Отправлено",
      confirmKeepOpen: "Отказ сервера",
      confirmKeepOpenTitle: "Отправить заявку?",
      confirmKeepOpenBody: "Сервер откажет: окно останется открытым, а причину покажет тост.",
      confirmKeepOpenLabel: "Отправить",
      confirmKeepOpenToast: "Не удалось отправить. Попробуйте ещё раз.",
      confirmThrow: "Неожиданный сбой",
      confirmThrowTitle: "Сохранить изменения?",
      confirmThrowBody: "Неожиданный сбой: окно останется открытым, а ошибка уйдёт в журнал.",
      confirmThrowLabel: "Сохранить",
    },
  },
} as const;
