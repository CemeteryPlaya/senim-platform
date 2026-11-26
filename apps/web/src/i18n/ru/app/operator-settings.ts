import { materials } from "../materials";
import { preContract } from "../pre-contract";

// Тексты справочников и настроек оператора в новом интерфейсе (v2): типы мебели, цены материалов, флаги, окружение и
// настройки площадки. Только сотрудники площадки (зона в STAFF_ONLY теста слов мастера).

const segments = { ECONOMY: "Эконом", COMFORT: "Комфорт", PREMIUM: "Премиум" } as const;

export const operatorSettings = {
  segments,

  /** Типы мебели: что заказчик выбирает на первом шаге заявки. */
  types: {
    metaTitle: "Типы мебели",
    title: "Типы мебели",
    lead: "Порядок — как у заказчика. Скрытый тип остаётся только в прежних заявках.",
    /** Подпись единственного поля добавления: отдельного заголовка раздела над ним нет. */
    addLabel: "Новый тип",
    addExample: "Например: мебель для балкона",
    add: "Добавить",
    added: "Тип добавлен",
    listTitle: (n: number) => `В справочнике: ${n}`,
    listLabel: "Типы мебели",
    empty: { title: "Справочник пуст", body: "Добавьте первый тип: он появится у заказчика на первом шаге заявки." },
    rename: "Изменить",
    renameLabel: (name: string) => `Новое название для «${name}»`,
    renamed: "Название сохранено",
    save: "Сохранить",
    cancel: "Отмена",
    hide: "Скрыть",
    show: "Показать",
    hidden: "Скрыт",
    shown: (name: string) => `«${name}» показан заказчикам`,
    hiddenDone: (name: string) => `«${name}» скрыт от заказчиков`,
    usage: (n: number) => `В заявках: ${n}`,
    up: (name: string) => `Поднять «${name}» выше`,
    down: (name: string) => `Опустить «${name}» ниже`,
    moved: (name: string, position: number) => `«${name}» теперь ${position}-й в списке`,
    actionFor: (action: string, name: string) => `${action}: ${name}`,
  },

  /** Цены материалов (ADR-007); справочник включается флагом «Калькулятор материалов». */
  materials: {
    metaTitle: "Цены материалов",
    title: "Цены материалов",
    lead: "Средние рыночные цены материалов по уровням. Из них считается примерная вилка цены в мастере заявки.",
    categories: materials.categories,
    units: materials.units,
    addTitle: "Добавить материал",
    category: "Категория",
    unit: "Единица",
    choose: "Выберите",
    name: "Название",
    nameExample: "Например: ЛДСП 16 мм, Egger",
    price: "Средняя цена за единицу",
    segmentsLegend: "Уровни",
    segmentsHint: "Один или несколько: материал войдёт в вилку каждого отмеченного уровня.",
    add: "Добавить материал",
    added: "Материал добавлен",
    perUnit: (unit: string) => `за ${unit}`,
    updated: (date: string, who: string | null) => (who ? `Обновлено ${date}, ${who}` : `Обновлено ${date}`),
    changePrice: "Изменить цену",
    changePriceLabel: (name: string, unit: string) => `Новая цена за ${unit}: ${name}`,
    priceSaved: "Цена сохранена",
    save: "Сохранить",
    cancel: "Отмена",
    archive: "В архив",
    restore: "Вернуть",
    archived: (name: string) => `«${name}» убран в архив`,
    restored: (name: string) => `«${name}» возвращён в справочник`,
    archivedBadge: "В архиве",
    listLabel: (category: string) => `Материалы: ${category}`,
    empty: { title: "Справочник пуст", body: "Добавьте первый материал: из цен считается вилка в мастере заявки." },
    archiveTitle: "Архив",
    archiveHint: "Материалы из архива не входят в расчёт вилки.",
    actionFor: (action: string, name: string) => `${action}: ${name}`,
  },

  /** Флаги, окружение и настройки площадки. */
  settings: {
    metaTitle: "Флаги и окружение",
    title: "Флаги и окружение",
    lead: "Окружение и флаги задаёт сервер.",
    environment: "Окружение",
    appEnv: "Окружение (APP_ENV)",
    appEnvValues: { dev: "разработка", staging: "песочница", prod: "рабочее" } as const,
    provider: "Провайдер оплаты для новых сделок",
    providerDefault: "выбран по APP_ENV: PAYMENT_PROVIDER не задан",
    providerEnv: "задан в PAYMENT_PROVIDER",
    providerNames: { mock: "тестовый (mock)", manual: "ручной: оператор по банковским документам", freedompay: "Freedom Pay, песочница" } as const,
    providerNote: "Идущие сделки остаются со своим провайдером.",
    flags: "Флаги",
    flagsLabel: "Флаги Фазы 1",
    on: "включён",
    off: "выключен",
    flagNames: {
      ai: "ИИ-помощник",
      preContractFlows: "Сценарии до оферты: замерщик, выезд, проект",
      materialsCalculator: "Калькулятор материалов",
      reviews: "Отзывы",
      dealPortfolio: "Сделка в портфолио мастера",
      inspiration: "Лента вдохновения",
      publicShowcase: "Публичная витрина сделок",
      executorHandSignsAct: "Мастер подписывает акт собственноручно",
      clientPhoneConsent: "Телефон покупателя до оферты по согласию",
    } as const,
    platform: "Настройки площадки",
    platformLead: "Понадобится код из приложения.",
    identity: {
      title: "Как заказчик видит исполнителя",
      // Режим (ADR-006) — только про имя. Телефон от режима не зависит: до оферты он скрыт, после заключения оферты его видят
      // обе стороны сделки (инвариант о контактах). ИИН/БИН — только в договоре: это правило действует само, здесь не повторяем.
      hint: "Действует на всех экранах заказчика. Телефон режим не открывает: стороны видят его после заключения оферты.",
      modes: { HIDDEN: "Имя скрыто", SHOWN: "Имя показано" } as const,
      modeHints: {
        // Из места мастера в любом режиме — только город (ADR-016).
        HIDDEN: "«Исполнитель №N» и город",
        SHOWN: "Наименование исполнителя и город",
      } as const,
      save: "Сохранить режим",
      saved: "Режим сохранён",
    },
    flow: {
      title: preContract.setting.title,
      hint: preContract.setting.hint,
      option: preContract.setting.option,
      names: preContract.flowNames,
      hints: preContract.flowHints,
      save: "Сохранить сценарий",
      saved: preContract.setting.saved,
    },
  },
} as const;
