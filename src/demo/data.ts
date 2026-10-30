import type { DisputeReason, LegalForm, Segment } from "@/generated/prisma/enums";
import type {
  CountertopKey,
  DEFAULT_FURNITURE_TYPES,
  FacadeKey,
  HardwareKey,
  StageTemplateKey,
  StyleKey,
} from "@/verticals/furniture";
import { testBin, testIin } from "./kz-id";
import type { PortfolioFileKey } from "./portfolio-files";

/**
 * Демо-данные «Сенім» — только описание. Логика вставки — в seed.ts.
 * Все сроки — «дней назад» (или «через N дней») от момента сида, чтобы демо не устаревало.
 * Телефоны +7 700 000 XX XX, ИИН/БИН с нулевым порядковым номером, адреса вымышленные.
 * Статусы заявок, откликов и сделок не задаются, а выводятся из фактов (seed.ts),
 * поэтому описать несогласованную историю нельзя.
 */

export type FurnitureSlug = (typeof DEFAULT_FURNITURE_TYPES)[number]["slug"];

// ─── персоны ─────────────────────────────────────────────────────────────────

export type PersonSpec = {
  fullName: string;
  phone: string;
  iin: string;
  isDemo: boolean;
  joinedDaysAgo: number;
};

export const OPERATOR = {
  fullName: "Динара Абенова",
  phone: "+77000000001",
  iin: testIin("890110", 4, 1),
  isDemo: true,
  joinedDaysAgo: 420,
} as const satisfies PersonSpec;

export const CLIENTS = {
  aigerim: { fullName: "Айгерим Сапарова", phone: "+77000000101", iin: testIin("940512", 4, 11), isDemo: true, joinedDaysAgo: 40 },
  daniyar: { fullName: "Данияр Ахметов", phone: "+77000000102", iin: testIin("880217", 3, 12), isDemo: true, joinedDaysAgo: 70 },
  madina: { fullName: "Мадина Касымова", phone: "+77000000103", iin: testIin("920305", 4, 13), isDemo: true, joinedDaysAgo: 20 },
  // Заказчики прошлых сделок: авторы отзывов, в демо-вход не попадают.
  arman: { fullName: "Арман Тулеуов", phone: "+77000000301", iin: testIin("830716", 3, 31), isDemo: false, joinedDaysAgo: 100 },
  olga: { fullName: "Ольга Смирнова", phone: "+77000000302", iin: testIin("790924", 4, 32), isDemo: false, joinedDaysAgo: 110 },
  saule: { fullName: "Сауле Мукашева", phone: "+77000000303", iin: testIin("860403", 4, 33), isDemo: false, joinedDaysAgo: 130 },
  zhanna: { fullName: "Жанна Бекова", phone: "+77000000304", iin: testIin("910129", 4, 34), isDemo: false, joinedDaysAgo: 105 },
  erbolat: { fullName: "Ерболат Нуриев", phone: "+77000000305", iin: testIin("870811", 3, 35), isDemo: false, joinedDaysAgo: 90 },
} as const satisfies Record<string, PersonSpec>;

export type ClientKey = keyof typeof CLIENTS;

// ─── исполнители ─────────────────────────────────────────────────────────────

export type PortfolioSpec = {
  key: string;
  file: PortfolioFileKey;
  type: FurnitureSlug;
  style: StyleKey;
  title: string;
  description: string;
  priceFrom: number;
};

type Registration =
  | { status: "APPROVED"; segment: Segment; reviewedDaysAgo: number }
  | { status: "PENDING" }
  | { status: "REJECTED"; rejectReason: string; reviewedDaysAgo: number };

type Legal =
  | { legalForm: Extract<LegalForm, "SELF_EMPLOYED" | "IP">; legalName: string } // ИИН/БИН = ИИН владельца
  | { legalForm: Extract<LegalForm, "TOO">; legalName: string; bin: string };

type Terms = { measurement: "FREE" } | { measurement: "INCLUDED" } | { measurement: "FEE_IF_NO_DEAL"; fee: number };

export type ExecutorSpec = Legal &
  Terms & {
    person: PersonSpec;
    registration: Registration;
    registeredDaysAgo: number;
    about: string;
    yearsExperience: number;
    specializations: readonly FurnitureSlug[];
    portfolio: readonly PortfolioSpec[];
  };

const FEE = 10_000;

export const EXECUTORS = {
  erlan: {
    person: { fullName: "Ерлан Жумабаев", phone: "+77000000201", iin: testIin("910803", 3, 21), isDemo: true, joinedDaysAgo: 302 },
    legalForm: "SELF_EMPLOYED",
    legalName: "Жумабаев Ерлан Серикович",
    registration: { status: "APPROVED", segment: "COMFORT", reviewedDaysAgo: 300 },
    registeredDaysAgo: 302,
    measurement: "FREE",
    yearsExperience: 9,
    about:
      "Делаю корпусную мебель 9 лет, небольшой цех на левом берегу. ЛДСП Egger и Kronospan, фурнитура Blum и Hettich. Замер и 3D-проект бесплатно.",
    specializations: ["kitchen", "wardrobe", "hallway"],
    portfolio: [
      { key: "erlan-kitchen", file: "kitchen-sage", type: "kitchen", style: "modern", title: "Кухня в новостройке, 3,4 м", description: "Фасады МДФ в эмали цвета шалфей, столешница под дуб, верхние шкафы до потолка.", priceFrom: 900_000 },
      { key: "erlan-wardrobe", file: "wardrobe-oak", type: "wardrobe", style: "modern", title: "Шкаф-купе с зеркальной дверью", description: "Три двери, средняя — зеркало. Внутри штанга, полки и ящики с доводчиками.", priceFrom: 320_000 },
      { key: "erlan-hallway", file: "hallway-graphite", type: "hallway", style: "loft", title: "Прихожая с банкеткой", description: "Закрытый шкаф для верхней одежды, открытая вешалка, мягкая банкетка и зеркало.", priceFrom: 240_000 },
    ],
  },
  agash: {
    person: { fullName: "Бауыржан Тулегенов", phone: "+77000000202", iin: testIin("800215", 3, 22), isDemo: true, joinedDaysAgo: 400 },
    legalForm: "TOO",
    legalName: "ТОО «Ағаш Шебер»",
    bin: testBin("1806", 1),
    registration: { status: "APPROVED", segment: "PREMIUM", reviewedDaysAgo: 398 },
    registeredDaysAgo: 400,
    measurement: "INCLUDED",
    yearsExperience: 12,
    about:
      "Мебельное производство полного цикла: цех 1 200 м², станки с ЧПУ, три бригады монтажников. Шпон, массив, кварцевые столешницы. Гарантия 3 года.",
    specializations: ["kitchen", "walk-in-closet", "table", "bathroom"],
    portfolio: [
      { key: "agash-island", file: "kitchen-island-oak", type: "kitchen", style: "modern", title: "Кухня с островом, шпон дуба", description: "Остров с барной зоной, столешница из кварцевого агломерата, фурнитура Blum.", priceFrom: 2_400_000 },
      { key: "agash-closet", file: "closet-walnut", type: "walk-in-closet", style: "classic", title: "Гардеробная под потолок, орех", description: "Открытые секции, штанги на двух уровнях, ящики с бархатными вставками.", priceFrom: 1_300_000 },
      { key: "agash-neoclassic", file: "kitchen-neoclassic", type: "kitchen", style: "neoclassic", title: "Кухня в стиле неоклассика", description: "Фрезерованные фасады в эмали, латунные ручки, столешница из искусственного камня.", priceFrom: 2_100_000 },
    ],
  },
  kim: {
    person: { fullName: "Руслан Ким", phone: "+77000000203", iin: testIin("870921", 3, 23), isDemo: true, joinedDaysAgo: 250 },
    legalForm: "IP",
    legalName: "ИП Ким Руслан Владимирович",
    registration: { status: "APPROVED", segment: "COMFORT", reviewedDaysAgo: 249 },
    registeredDaysAgo: 250,
    measurement: "FEE_IF_NO_DEAL",
    fee: FEE,
    yearsExperience: 6,
    about:
      "Детская и корпусная мебель. Материалы класса E0.5, закруглённые кромки, мягкие доводчики. Выезд на замер — 10 000 ₸, только если сделка не состоится.",
    specializations: ["kids-room", "wardrobe", "office"],
    portfolio: [
      { key: "kim-kids", file: "kids-bunk", type: "kids-room", style: "scandi", title: "Детская для двоих", description: "Двухъярусная кровать с ящиками, лестница-полки, письменный стол с тумбой.", priceFrom: 650_000 },
      { key: "kim-office", file: "office-white", type: "office", style: "scandi", title: "Домашний кабинет со стеллажом", description: "Стеллаж с закрытыми ящиками внизу, стол с тумбой, всё в белом и дубе.", priceFrom: 420_000 },
    ],
  },
  timur: {
    person: { fullName: "Тимур Оспанов", phone: "+77000000204", iin: testIin("930114", 3, 24), isDemo: true, joinedDaysAgo: 200 },
    legalForm: "SELF_EMPLOYED",
    legalName: "Оспанов Тимур Маратович",
    registration: { status: "APPROVED", segment: "ECONOMY", reviewedDaysAgo: 199 },
    registeredDaysAgo: 200,
    measurement: "FREE",
    yearsExperience: 5,
    about: "Шкафы-купе и гардеробные из ЛДСП. Профиль Aristo, зеркала с пескоструйным рисунком. Работаю быстро, замер бесплатно.",
    specializations: ["wardrobe", "walk-in-closet", "hallway"],
    portfolio: [
      { key: "timur-wardrobe", file: "wardrobe-white", type: "wardrobe", style: "minimalism", title: "Шкаф-купе 2,8 м в нишу", description: "Белое ЛДСП, зеркальная дверь по центру, внутри полки под обувь.", priceFrom: 210_000 },
      { key: "timur-closet", file: "closet-light", type: "walk-in-closet", style: "scandi", title: "Гардеробная в спальне", description: "Открытая система: штанги, полки, ящики. Светлый дуб.", priceFrom: 280_000 },
    ],
  },
  asel: {
    person: { fullName: "Асель Нурланова", phone: "+77000000205", iin: testIin("960730", 4, 25), isDemo: true, joinedDaysAgo: 180 },
    legalForm: "IP",
    legalName: "ИП Нурланова Асель Ерлановна",
    registration: { status: "APPROVED", segment: "PREMIUM", reviewedDaysAgo: 179 },
    registeredDaysAgo: 180,
    measurement: "FEE_IF_NO_DEAL",
    fee: FEE,
    yearsExperience: 4,
    about: "Столярная мастерская: столы, комоды и тумбы для ванной из массива карагача, дуба и ореха. Масло-воск, ручная работа.",
    specializations: ["table", "bathroom", "dresser"],
    portfolio: [
      { key: "asel-table", file: "table-karagach", type: "table", style: "modern", title: "Обеденный стол из карагача", description: "Столешница из цельных ламелей карагача, масло-воск, ножки из массива.", priceFrom: 420_000 },
      { key: "asel-vanity", file: "bathroom-walnut", type: "bathroom", style: "minimalism", title: "Тумба под раковину из ореха", description: "Подвесная тумба с влагостойкой пропиткой и круглое зеркало в раме.", priceFrom: 290_000 },
      { key: "asel-dresser", file: "dresser-oak", type: "dresser", style: "scandi", title: "Комод из дуба на ножках", description: "Шесть ящиков на скрытых направляющих, ручки из латуни.", priceFrom: 360_000 },
    ],
  },
  qazaq: {
    person: { fullName: "Ержан Ибраев", phone: "+77000000206", iin: testIin("850407", 3, 26), isDemo: true, joinedDaysAgo: 350 },
    legalForm: "TOO",
    legalName: "ТОО «Qazaq Wood»",
    bin: testBin("2003", 2),
    registration: { status: "APPROVED", segment: "COMFORT", reviewedDaysAgo: 348 },
    registeredDaysAgo: 350,
    measurement: "INCLUDED",
    yearsExperience: 8,
    about:
      "Корпусная мебель для дома и офиса. Своё производство в промзоне Астаны, замер включён в стоимость заказа. Работаем с физлицами и компаниями.",
    specializations: ["office", "kitchen", "shelving", "living-room"],
    portfolio: [
      { key: "qazaq-office", file: "office-walnut", type: "office", style: "classic", title: "Кабинет руководителя", description: "Стеллаж под потолок из шпона ореха, стол с тумбой, скрытая проводка.", priceFrom: 750_000 },
      { key: "qazaq-shelving", file: "shelving-loft", type: "shelving", style: "loft", title: "Стеллаж-перегородка в стиле лофт", description: "Металлический каркас, полки из массива сосны, зонирует комнату.", priceFrom: 230_000 },
    ],
  },
  dala: {
    person: { fullName: "Нурлан Абдрахманов", phone: "+77000000207", iin: testIin("880512", 3, 27), isDemo: true, joinedDaysAgo: 280 },
    legalForm: "IP",
    legalName: "ИП Абдрахманов Нурлан Канатович",
    registration: { status: "APPROVED", segment: "COMFORT", reviewedDaysAgo: 278 },
    registeredDaysAgo: 280,
    measurement: "FEE_IF_NO_DEAL",
    fee: FEE,
    yearsExperience: 7,
    about: "Мастерская полного цикла: кухни, спальни и ТВ-зоны. Помогаем с проектом и подбираем материалы под бюджет.",
    specializations: ["kitchen", "bedroom", "living-room", "kids-room"],
    portfolio: [
      { key: "dala-bedroom", file: "bedroom-beige", type: "bedroom", style: "scandi", title: "Спальня с мягким изголовьем", description: "Кровать с изголовьем во всю стену и две прикроватные тумбы.", priceFrom: 560_000 },
      { key: "dala-tv", file: "tv-zone-scandi", type: "living-room", style: "scandi", title: "ТВ-зона с подвесными тумбами", description: "Реечная панель, подвесная тумба на всю стену, полки для декора.", priceFrom: 380_000 },
      { key: "dala-kitchen", file: "kitchen-terracotta", type: "kitchen", style: "modern", title: "Кухня терракотового цвета, 3 м", description: "Фасады МДФ в плёнке, тёмная столешница, встроенная мойка.", priceFrom: 820_000 },
    ],
  },
  samat: {
    person: { fullName: "Самат Беков", phone: "+77000000208", iin: testIin("990402", 3, 28), isDemo: true, joinedDaysAgo: 30 },
    legalForm: "SELF_EMPLOYED",
    legalName: "Беков Самат Нурланович",
    registration: { status: "APPROVED", segment: "ECONOMY", reviewedDaysAgo: 28 },
    registeredDaysAgo: 30,
    measurement: "FREE",
    yearsExperience: 2,
    about: "Начинающий мастер: прихожие, шкафы и комоды из ЛДСП. Работаю аккуратно и недорого.",
    specializations: ["hallway", "wardrobe", "dresser"],
    portfolio: [
      { key: "samat-hallway", file: "hallway-sonoma", type: "hallway", style: "modern", title: "Прихожая в коридор", description: "Шкаф, открытая вешалка и банкетка в цвете дуб сонома.", priceFrom: 130_000 },
      { key: "samat-dresser", file: "dresser-white", type: "dresser", style: "scandi", title: "Комод для детской", description: "Белый комод на шесть ящиков с голубыми ручками.", priceFrom: 75_000 },
    ],
  },
  almas: {
    person: { fullName: "Алмас Тлеубаев", phone: "+77000000209", iin: testIin("950918", 3, 29), isDemo: true, joinedDaysAgo: 1.5 },
    legalForm: "SELF_EMPLOYED",
    legalName: "Тлеубаев Алмас Бауыржанович",
    registration: { status: "PENDING" },
    registeredDaysAgo: 1.5,
    measurement: "FREE",
    yearsExperience: 3,
    about: "Три года работал в мебельном цехе, теперь беру заказы сам: кухни и прихожие.",
    specializations: ["kitchen", "hallway"],
    portfolio: [],
  },
  express: {
    person: { fullName: "Даурен Мусин", phone: "+77000000210", iin: testIin("900623", 3, 30), isDemo: true, joinedDaysAgo: 14 },
    legalForm: "TOO",
    legalName: "ТОО «Мебель Экспресс Астана»",
    bin: testBin("2205", 3),
    registration: {
      status: "REJECTED",
      rejectReason: "Фотографии портфолио найдены на сторонних сайтах. Загрузите фото собственных работ и подайте заявку снова.",
      reviewedDaysAgo: 12,
    },
    registeredDaysAgo: 14,
    measurement: "FREE",
    yearsExperience: 1,
    about: "Мебель по низким ценам за 7 дней.",
    specializations: ["wardrobe", "kitchen"],
    portfolio: [],
  },
} as const satisfies Record<string, ExecutorSpec>;

export type ExecutorKey = keyof typeof EXECUTORS;

// ─── заявки, отклики, замеры, сделки ─────────────────────────────────────────

/** Ответы мастера заявки. Ключи материалов совпадают со справочником вертикали. */
export type RequestDetails = {
  widthCm?: number;
  heightCm?: number;
  depthCm?: number;
  facade?: FacadeKey;
  countertop?: CountertopKey;
  hardware?: HardwareKey;
  color?: string;
  unknown?: readonly ("size" | "materials")[];
};

export type MessageSpec = { from: "client" | "executor"; text: string; daysAgo: number; masked?: true };

export type MeasurementSpec =
  | { status: "SCHEDULED"; bookedDaysAgo: number; inDays: number }
  | { status: "DONE"; bookedDaysAgo: number; visitDaysAgo: number; result: string; finalPrice: number }
  | { status: "NO_DEAL"; bookedDaysAgo: number; visitDaysAgo: number; result: string };

export type OfferSpec = {
  executor: ExecutorKey;
  price: number;
  durationDays: number;
  warrantyMonths: number;
  comment: string;
  sentDaysAgo: number;
  /** Заказчик выбрал этот отклик. Остальные отклики, присланные раньше, отклоняются в этот момент. */
  chosen?: { daysAgo: number; measurement?: MeasurementSpec };
  messages?: MessageSpec[];
};

/** Докуда дошла сделка: последний выполненный шаг этапа или «всё сделано». */
export type StageStep = "paymentMarked" | "paymentConfirmed" | "started" | "submitted" | "accepted" | "closed";
export type DealProgress = "done" | { stage: number; step: StageStep };

export type DisputeSpec = {
  daysAgo: number;
  reason: DisputeReason;
  description: string;
  clientPosition: string;
  executorPosition: string;
};

export type DealSpec = {
  title: string;
  template: StageTemplateKey;
  createdDaysAgo: number;
  /** Договор подписан обеими сторонами (подписи и PDF добавит фаза C). */
  signedDaysAgo?: number;
  progress?: DealProgress;
  /** Когда сделан последний шаг из progress (для «done» — дата завершения). */
  lastStepDaysAgo?: number;
  review?: { rating: 1 | 2 | 3 | 4 | 5; text: string; daysAgo: number };
  /** Спор по этапу, на котором остановилась сделка. */
  dispute?: DisputeSpec;
};

type Targeting = { mode: "TENDER" } | { mode: "DIRECT"; target: ExecutorKey; portfolioItem: string };

export type RequestSpec = Targeting & {
  key: string;
  client: ClientKey;
  type: FurnitureSlug;
  style: StyleKey;
  details: RequestDetails;
  /** Выбор заказчика; null — ещё не выбран (черновик). */
  segment: Segment | null;
  address: string | null;
  desiredInDays?: number;
  wishes: string;
  createdDaysAgo: number;
  wizardStep: number;
  /** Нет — заявка ещё черновик. */
  publishedDaysAgo?: number;
  cancelled?: { daysAgo: number; reason: string };
  offers: OfferSpec[];
  deal?: DealSpec;
};

const ADDR = {
  demo12: "Астана, ул. Демонстрационная, 12, кв. 45",
  primer8: "Астана, пр. Примерный, 8, кв. 101",
  obrazets3: "Астана, ул. Образцовая, 3, кв. 17",
  test2: "Астана, мкр. Тестовый-2, д. 5, кв. 30",
  maket21: "Астана, ул. Макетная, 21, кв. 9",
  sample4: "Астана, пр. Условный, 4, кв. 66",
  probny7: "Астана, ул. Пробная, 7, кв. 112",
  shablon15: "Астана, ул. Шаблонная, 15, кв. 3",
  chernovik9: "Астана, мкр. Черновой, д. 9, кв. 54",
} as const;

/** Активные истории демо-персон: каждая показывает свой шаг пути заявки и сделки. */
const ACTIVE: RequestSpec[] = [
  {
    key: "draft-closet",
    mode: "TENDER",
    client: "madina",
    type: "walk-in-closet",
    style: "scandi",
    details: { widthCm: 220, heightCm: 270, depthCm: 150, unknown: ["materials"] },
    segment: null,
    address: null,
    wishes: "",
    createdDaysAgo: 0.2,
    wizardStep: 2,
    offers: [],
  },
  {
    key: "tender-kitchen",
    mode: "TENDER",
    client: "aigerim",
    type: "kitchen",
    style: "modern",
    details: { widthCm: 340, heightCm: 270, depthCm: 60, facade: "mdf_enamel", countertop: "compact", hardware: "soft_close", color: "Шалфей и светлый дуб" },
    segment: "COMFORT",
    address: ADDR.demo12,
    desiredInDays: 45,
    wishes: "Встроить посудомойку и духовой шкаф, верхние шкафы до потолка.",
    createdDaysAgo: 3.4,
    publishedDaysAgo: 3.2,
    wizardStep: 6,
    offers: [
      {
        executor: "erlan",
        price: 1_050_000,
        durationDays: 30,
        warrantyMonths: 24,
        comment: "Сделаю фасады в эмали, фурнитура Blum. Замер бесплатно, 3D-проект покажу на замере.",
        sentDaysAgo: 2.9,
        messages: [
          { from: "client", text: "Здравствуйте! Можно сделать фасады без ручек?", daysAgo: 2.5 },
          { from: "executor", text: "Да, с профилем Gola — это плюс 40 000 ₸. Образцы покажу на замере.", daysAgo: 2.4 },
        ],
      },
      {
        executor: "qazaq",
        price: 1_180_000,
        durationDays: 25,
        warrantyMonths: 24,
        comment: "Своё производство, срок фиксируем в договоре. Замер входит в стоимость.",
        sentDaysAgo: 2.1,
        messages: [
          { from: "executor", text: "Добрый день! Удобнее обсудить по телефону: [контакт скрыт]", daysAgo: 2.0, masked: true },
          { from: "client", text: "Давайте здесь, в чате платформы.", daysAgo: 1.9 },
          { from: "executor", text: "Хорошо. Столешницу предлагаю компакт-плиту 12 мм — она тоньше и прочнее.", daysAgo: 1.8 },
        ],
      },
      {
        executor: "dala",
        price: 980_000,
        durationDays: 35,
        warrantyMonths: 18,
        comment: "Фасады МДФ эмаль, столешница компакт-плита. Выезд на замер 10 000 ₸, только если не договоримся.",
        sentDaysAgo: 1.2,
      },
    ],
  },
  {
    key: "direct-table",
    mode: "DIRECT",
    target: "asel",
    portfolioItem: "asel-table",
    client: "daniyar",
    type: "table",
    style: "modern",
    details: { widthCm: 220, depthCm: 95, facade: "solid_wood", color: "Чуть темнее, чем на фото" },
    segment: "PREMIUM",
    address: ADDR.primer8,
    desiredInDays: 40,
    wishes: "Хочу похожий стол, но на восемь человек.",
    createdDaysAgo: 1.1,
    publishedDaysAgo: 1.0,
    wizardStep: 6,
    offers: [],
  },
  {
    key: "chosen-wardrobe",
    mode: "TENDER",
    client: "madina",
    type: "wardrobe",
    style: "modern",
    details: { widthCm: 240, heightCm: 260, depthCm: 60, facade: "ldsp", hardware: "standard", color: "Белый, одна дверь — зеркало" },
    segment: "ECONOMY",
    address: ADDR.obrazets3,
    desiredInDays: 30,
    wishes: "Шкаф в прихожую, внутри полки под обувь.",
    createdDaysAgo: 4.5,
    publishedDaysAgo: 4.4,
    wizardStep: 6,
    offers: [
      {
        executor: "timur",
        price: 290_000,
        durationDays: 14,
        warrantyMonths: 12,
        comment: "Профиль Aristo, зеркало серебро. Замер бесплатно.",
        sentDaysAgo: 4.0,
        chosen: { daysAgo: 0.6 },
        messages: [
          { from: "client", text: "Сможете приехать на замер в субботу?", daysAgo: 0.5 },
          { from: "executor", text: "Да, в субботу с 10 до 13. Назначу время в системе.", daysAgo: 0.4 },
        ],
      },
      { executor: "samat", price: 260_000, durationDays: 18, warrantyMonths: 12, comment: "Сделаю недорого и аккуратно.", sentDaysAgo: 3.1 },
    ],
  },
  {
    key: "measuring-tv",
    mode: "TENDER",
    client: "daniyar",
    type: "living-room",
    style: "scandi",
    details: { widthCm: 320, heightCm: 260, facade: "mdf_film", hardware: "soft_close", color: "Светлое дерево и белый" },
    segment: "COMFORT",
    address: ADDR.primer8,
    desiredInDays: 35,
    wishes: "Реечная панель за телевизором и подвесная тумба.",
    createdDaysAgo: 6,
    publishedDaysAgo: 5.9,
    wizardStep: 6,
    offers: [
      {
        executor: "dala",
        price: 460_000,
        durationDays: 21,
        warrantyMonths: 18,
        comment: "Похожую ТВ-зону делали в прошлом месяце, фото в портфолио.",
        sentDaysAgo: 5.2,
        chosen: { daysAgo: 2.0, measurement: { status: "SCHEDULED", bookedDaysAgo: 1.8, inDays: 2 } },
        messages: [{ from: "executor", text: "Приеду на замер послезавтра в 11:00, возьму образцы реек.", daysAgo: 1.8 }],
      },
      { executor: "qazaq", price: 520_000, durationDays: 20, warrantyMonths: 24, comment: "Замер включён в стоимость.", sentDaysAgo: 4.8 },
    ],
  },
  {
    key: "contracting-hallway",
    mode: "TENDER",
    client: "aigerim",
    type: "hallway",
    style: "minimalism",
    details: { widthCm: 220, heightCm: 250, depthCm: 45, facade: "mdf_film", hardware: "soft_close", color: "Графит" },
    segment: "COMFORT",
    address: ADDR.demo12,
    desiredInDays: 25,
    wishes: "Нужна антресоль над входной дверью.",
    createdDaysAgo: 9,
    publishedDaysAgo: 8.9,
    wizardStep: 6,
    offers: [
      {
        executor: "erlan",
        price: 300_000,
        durationDays: 21,
        warrantyMonths: 24,
        comment: "Без предоплаты: оплата после монтажа и приёмки.",
        sentDaysAgo: 8.3,
        chosen: {
          daysAgo: 7.0,
          measurement: { status: "DONE", bookedDaysAgo: 6.8, visitDaysAgo: 5.0, result: "Ниша 2,2 м, добавили антресоль над дверью. Итог — 315 000 ₸.", finalPrice: 315_000 },
        },
      },
      { executor: "kim", price: 340_000, durationDays: 18, warrantyMonths: 24, comment: "Сделаю с доводчиками и подсветкой.", sentDaysAgo: 7.9 },
    ],
    deal: { title: "Прихожая с антресолью", template: "no-prepayment", createdDaysAgo: 4.0 },
  },
  {
    key: "office-advance",
    mode: "TENDER",
    client: "madina",
    type: "office",
    style: "modern",
    details: { widthCm: 300, heightCm: 270, facade: "mdf_film", countertop: "compact", hardware: "soft_close" },
    segment: "COMFORT",
    address: ADDR.test2,
    desiredInDays: 20,
    wishes: "Стеллаж до потолка и стол для двух мониторов.",
    createdDaysAgo: 16,
    publishedDaysAgo: 15.9,
    wizardStep: 6,
    offers: [
      {
        executor: "qazaq",
        price: 560_000,
        durationDays: 25,
        warrantyMonths: 24,
        comment: "Своё производство, замер включён.",
        sentDaysAgo: 15.0,
        chosen: {
          daysAgo: 13.0,
          measurement: { status: "DONE", bookedDaysAgo: 12.8, visitDaysAgo: 11.0, result: "Стена 3 м: стеллаж до потолка и стол с тумбой. Итог — 580 000 ₸.", finalPrice: 580_000 },
        },
        messages: [{ from: "client", text: "Аванс перевела на Kaspi, отметила в сделке.", daysAgo: 0.3 }],
      },
      { executor: "erlan", price: 540_000, durationDays: 28, warrantyMonths: 24, comment: "Сделаю в шпоне под орех.", sentDaysAgo: 14.5 },
    ],
    deal: {
      title: "Кабинет со стеллажом до потолка",
      template: "three-part",
      createdDaysAgo: 10,
      signedDaysAgo: 2,
      progress: { stage: 1, step: "paymentMarked" },
      lastStepDaysAgo: 0.3,
    },
  },
  {
    key: "wardrobe-submitted",
    mode: "TENDER",
    client: "aigerim",
    type: "wardrobe",
    style: "modern",
    details: { widthCm: 280, heightCm: 260, depthCm: 60, facade: "mdf_film", hardware: "soft_close", color: "Дуб и белый глянец" },
    segment: "COMFORT",
    address: ADDR.demo12,
    desiredInDays: 5,
    wishes: "Шкаф-купе в спальню на всю стену.",
    createdDaysAgo: 30,
    publishedDaysAgo: 29.9,
    wizardStep: 6,
    offers: [
      {
        executor: "erlan",
        price: 420_000,
        durationDays: 18,
        warrantyMonths: 24,
        comment: "Аванс 50% на материалы, остальное после монтажа.",
        sentDaysAgo: 29.0,
        chosen: {
          daysAgo: 27.0,
          measurement: { status: "DONE", bookedDaysAgo: 26.8, visitDaysAgo: 25.0, result: "Стена 2,8 м, потолок 2,6 м. Добавили выдвижные ящики. Итог — 440 000 ₸.", finalPrice: 440_000 },
        },
        messages: [
          { from: "executor", text: "Корпуса и двери готовы, фото в отчёте этапа. Монтаж можем в четверг.", daysAgo: 0.9 },
          { from: "client", text: "Спасибо, посмотрю фото вечером.", daysAgo: 0.8 },
        ],
      },
      { executor: "kim", price: 450_000, durationDays: 20, warrantyMonths: 24, comment: "Двери с алюминиевым профилем.", sentDaysAgo: 28.5 },
    ],
    deal: {
      title: "Шкаф-купе в спальню, 2,8 м",
      template: "advance-50",
      createdDaysAgo: 24,
      signedDaysAgo: 22,
      progress: { stage: 2, step: "submitted" },
      lastStepDaysAgo: 1,
    },
  },
  {
    key: "kitchen-completed",
    mode: "TENDER",
    client: "daniyar",
    type: "kitchen",
    style: "neoclassic",
    details: { widthCm: 420, heightCm: 280, depthCm: 60, facade: "veneer", countertop: "quartz", hardware: "premium", color: "Натуральный дуб, столешница белый мрамор" },
    segment: "PREMIUM",
    address: ADDR.primer8,
    wishes: "Остров с барной зоной, встроенная техника.",
    createdDaysAgo: 62,
    publishedDaysAgo: 61.9,
    wizardStep: 6,
    offers: [
      {
        executor: "agash",
        price: 2_600_000,
        durationDays: 40,
        warrantyMonths: 36,
        comment: "Шпон дуба, столешница из кварцевого агломерата, фурнитура Blum. Замер и проект входят в стоимость.",
        sentDaysAgo: 61,
        chosen: {
          daysAgo: 59,
          measurement: { status: "DONE", bookedDaysAgo: 58.8, visitDaysAgo: 57, result: "Кухня 4,2 м и остров 1,8 м. Итог — 2 750 000 ₸.", finalPrice: 2_750_000 },
        },
      },
    ],
    deal: {
      title: "Кухня с островом, шпон дуба",
      template: "three-part",
      createdDaysAgo: 56,
      signedDaysAgo: 54,
      progress: "done",
      lastStepDaysAgo: 12,
      review: {
        rating: 4,
        text: "Кухня отличная, всё по проекту. Монтаж затянулся на три дня, но бригада предупредила заранее. Удобно, что оплата шла по этапам.",
        daysAgo: 11,
      },
    },
  },
  {
    key: "kids-dispute",
    mode: "TENDER",
    client: "daniyar",
    type: "kids-room",
    style: "scandi",
    details: { facade: "mdf_film", hardware: "soft_close", color: "Белый и голубой", unknown: ["size"] },
    segment: "COMFORT",
    address: ADDR.primer8,
    wishes: "Двухъярусная кровать с ящиками, шкаф и стол для двоих детей.",
    createdDaysAgo: 26,
    publishedDaysAgo: 25.9,
    wizardStep: 6,
    offers: [
      {
        executor: "kim",
        price: 690_000,
        durationDays: 28,
        warrantyMonths: 24,
        comment: "Материалы E0.5, закруглённые кромки.",
        sentDaysAgo: 25,
        chosen: {
          daysAgo: 23,
          measurement: { status: "DONE", bookedDaysAgo: 22.8, visitDaysAgo: 21, result: "Комната 3,2 × 3,8 м. Добавили полки над столом. Итог — 720 000 ₸.", finalPrice: 720_000 },
        },
        messages: [
          { from: "client", text: "Фасады не того цвета, посмотрите фото в отчёте.", daysAgo: 2.2 },
          { from: "executor", text: "Цвет по образцу из договора. Могу приехать с каталогом RAL.", daysAgo: 2.1 },
        ],
      },
      { executor: "dala", price: 650_000, durationDays: 30, warrantyMonths: 18, comment: "Сделаем в ЛДСП с ПВХ-кромкой 2 мм.", sentDaysAgo: 24.5 },
    ],
    deal: {
      title: "Детская для двоих: кровать, шкаф и стол",
      template: "advance-50",
      createdDaysAgo: 20,
      signedDaysAgo: 18,
      progress: { stage: 2, step: "submitted" },
      lastStepDaysAgo: 3,
      dispute: {
        daysAgo: 2,
        reason: "QUALITY",
        description: "Цвет фасадов не совпадает с согласованным проектом: вместо голубого — серо-синий. На двух деталях отходит кромка.",
        clientPosition: "Прошу переделать фасады в согласованный цвет и заменить детали с кромкой. Принимать этап в таком виде не готов.",
        executorPosition:
          "Цвет соответствует образцу RAL 5024 из договора, на фото оттенок искажён. Кромку переклеим по гарантии, перекрашивать фасады за свой счёт не согласен.",
      },
    },
  },
  {
    key: "cancelled-dresser",
    mode: "TENDER",
    client: "madina",
    type: "dresser",
    style: "scandi",
    details: { widthCm: 120, heightCm: 90, depthCm: 45, facade: "ldsp" },
    segment: "ECONOMY",
    address: ADDR.obrazets3,
    wishes: "Комод в детскую на шесть ящиков.",
    createdDaysAgo: 12,
    publishedDaysAgo: 11.9,
    cancelled: { daysAgo: 9, reason: "Купили готовый комод" },
    wizardStep: 6,
    offers: [{ executor: "samat", price: 85_000, durationDays: 10, warrantyMonths: 12, comment: "Сделаю за 10 дней.", sentDaysAgo: 11 }],
  },
  {
    key: "bathroom-no-deal",
    mode: "TENDER",
    client: "aigerim",
    type: "bathroom",
    style: "modern",
    details: { widthCm: 100, facade: "veneer", countertop: "artificial_stone" },
    segment: "PREMIUM",
    address: ADDR.demo12,
    wishes: "Подвесная тумба под раковину и пенал.",
    createdDaysAgo: 20,
    publishedDaysAgo: 19.9,
    wizardStep: 6,
    offers: [
      {
        executor: "asel",
        price: 330_000,
        durationDays: 20,
        warrantyMonths: 24,
        comment: "Орех с влагостойкой пропиткой. Выезд на замер 10 000 ₸, только если не договоримся.",
        sentDaysAgo: 19,
        chosen: {
          daysAgo: 17,
          measurement: {
            status: "NO_DEAL",
            bookedDaysAgo: 16.8,
            visitDaysAgo: 15,
            result: "Ниша нестандартная, цена после замера — 410 000 ₸. Заказчик не согласился. Плата за выезд — 10 000 ₸.",
          },
        },
      },
      {
        executor: "agash",
        price: 390_000,
        durationDays: 25,
        warrantyMonths: 36,
        comment: "Сделаем в шпоне, замер включён в стоимость.",
        sentDaysAgo: 6,
      },
    ],
  },
];

type CompletedInput = {
  key: string;
  client: ClientKey;
  executor: ExecutorKey;
  type: FurnitureSlug;
  style: StyleKey;
  details: RequestDetails;
  segment: Segment;
  address: string;
  title: string;
  price: number;
  finalPrice: number;
  template: StageTemplateKey;
  startDaysAgo: number;
  durationDays: number;
  rating: 1 | 2 | 3 | 4 | 5;
  review: string;
};

/** Завершённая сделка прошлых месяцев: из них складываются рейтинг и отзывы исполнителей. */
function completed(o: CompletedInput): RequestSpec {
  const s = o.startDaysAgo;
  const done = s - o.durationDays;
  return {
    key: o.key,
    mode: "TENDER",
    client: o.client,
    type: o.type,
    style: o.style,
    details: o.details,
    segment: o.segment,
    address: o.address,
    wishes: "",
    createdDaysAgo: s,
    publishedDaysAgo: s - 0.1,
    wizardStep: 6,
    offers: [
      {
        executor: o.executor,
        price: o.price,
        durationDays: o.durationDays,
        warrantyMonths: 24,
        comment: "",
        sentDaysAgo: s - 0.7,
        chosen: {
          daysAgo: s - 1.5,
          measurement: { status: "DONE", bookedDaysAgo: s - 1.7, visitDaysAgo: s - 3, result: "Замер выполнен, проект согласован.", finalPrice: o.finalPrice },
        },
      },
    ],
    deal: {
      title: o.title,
      template: o.template,
      createdDaysAgo: s - 3.5,
      signedDaysAgo: s - 5,
      progress: "done",
      lastStepDaysAgo: done,
      review: { rating: o.rating, text: o.review, daysAgo: done - 0.6 },
    },
  };
}

const HISTORY: RequestSpec[] = [
  completed({
    key: "h-erlan-kitchen", client: "olga", executor: "erlan", type: "kitchen", style: "modern",
    details: { widthCm: 320, facade: "mdf_enamel", countertop: "ldsp", hardware: "soft_close" }, segment: "COMFORT", address: ADDR.maket21,
    title: "Кухня 3,2 м под потолок", price: 1_050_000, finalPrice: 1_100_000, template: "advance-50", startDaysAgo: 95, durationDays: 35,
    rating: 5, review: "Кухню сделали за пять недель, как договаривались. Фотоотчёты по каждому этапу — в цех ездить не пришлось.",
  }),
  completed({
    key: "h-erlan-wardrobe", client: "arman", executor: "erlan", type: "wardrobe", style: "minimalism",
    details: { widthCm: 200, facade: "mdf_film", hardware: "soft_close" }, segment: "COMFORT", address: ADDR.sample4,
    title: "Шкаф-купе в нишу", price: 350_000, finalPrice: 360_000, template: "no-prepayment", startDaysAgo: 70, durationDays: 20,
    rating: 5, review: "Аккуратный монтаж, убрали за собой. Двери катаются бесшумно.",
  }),
  completed({
    key: "h-agash-closet", client: "saule", executor: "agash", type: "walk-in-closet", style: "classic",
    details: { facade: "veneer", hardware: "premium" }, segment: "PREMIUM", address: ADDR.probny7,
    title: "Гардеробная под потолок", price: 1_400_000, finalPrice: 1_450_000, template: "three-part", startDaysAgo: 120, durationDays: 40,
    rating: 5, review: "Гардеробная под потолок, монтаж за один день. Оплата по этапам — спокойно для обеих сторон.",
  }),
  completed({
    key: "h-kim-office", client: "erbolat", executor: "kim", type: "office", style: "scandi",
    details: { facade: "mdf_film", hardware: "soft_close" }, segment: "COMFORT", address: ADDR.shablon15,
    title: "Домашний кабинет", price: 500_000, finalPrice: 520_000, template: "advance-50", startDaysAgo: 80, durationDays: 25,
    rating: 4, review: "Кабинет удобный. Срок сдвинули на четыре дня из-за фасадов, но предупредили заранее.",
  }),
  completed({
    key: "h-timur-wardrobe", client: "zhanna", executor: "timur", type: "wardrobe", style: "modern",
    details: { widthCm: 260, facade: "ldsp", hardware: "standard" }, segment: "ECONOMY", address: ADDR.chernovik9,
    title: "Шкаф-купе в спальню", price: 230_000, finalPrice: 240_000, template: "no-prepayment", startDaysAgo: 75, durationDays: 15,
    rating: 5, review: "Быстро и недорого. Замер бесплатно, всё точно по размеру.",
  }),
  completed({
    key: "h-timur-hallway", client: "arman", executor: "timur", type: "hallway", style: "modern",
    details: { facade: "ldsp", hardware: "standard" }, segment: "ECONOMY", address: ADDR.sample4,
    title: "Прихожая со шкафом", price: 170_000, finalPrice: 180_000, template: "advance-50", startDaysAgo: 40, durationDays: 14,
    rating: 4, review: "Прихожая хорошая, но монтажника пришлось ждать два дня.",
  }),
  completed({
    key: "h-asel-table", client: "olga", executor: "asel", type: "table", style: "modern",
    details: { widthCm: 180, facade: "solid_wood" }, segment: "PREMIUM", address: ADDR.maket21,
    title: "Обеденный стол из карагача", price: 430_000, finalPrice: 450_000, template: "advance-50", startDaysAgo: 50, durationDays: 30,
    rating: 5, review: "Стол из карагача — очень красиво. Масло-воск, ручная работа, всё по эскизу.",
  }),
  completed({
    key: "h-qazaq-shelving", client: "saule", executor: "qazaq", type: "shelving", style: "loft",
    details: { facade: "mdf_film" }, segment: "COMFORT", address: ADDR.probny7,
    title: "Стеллаж-перегородка", price: 250_000, finalPrice: 260_000, template: "three-part", startDaysAgo: 45, durationDays: 20,
    rating: 4, review: "Стеллаж крепкий, всё ровно. Менеджер иногда долго отвечал.",
  }),
  completed({
    key: "h-dala-bedroom", client: "zhanna", executor: "dala", type: "bedroom", style: "scandi",
    details: { facade: "mdf_film", hardware: "soft_close" }, segment: "COMFORT", address: ADDR.chernovik9,
    title: "Спальня с мягким изголовьем", price: 620_000, finalPrice: 640_000, template: "advance-50", startDaysAgo: 100, durationDays: 30,
    rating: 5, review: "Спальня с мягким изголовьем — всё как на эскизе, тумбы с доводчиками.",
  }),
];

export const REQUESTS: RequestSpec[] = [...HISTORY, ...ACTIVE];

/** Отчёты исполнителя при сдаче этапа — по названию этапа шаблона. */
export const STAGE_REPORTS: Record<string, string> = {
  "Аванс на материалы": "Материалы закуплены: плиты, кромка, фурнитура. Чеки и фото во вложении.",
  Изготовление: "Корпуса собраны, фасады получены из покраски. Фото из цеха во вложении.",
  "Доставка, монтаж и сдача": "Мебель установлена, фасады отрегулированы, мусор вывезли.",
};

// ─── уведомления ─────────────────────────────────────────────────────────────

export type PersonRef = { client: ClientKey } | { executor: ExecutorKey } | { operator: true };

export type LinkRef =
  | { to: "request" | "executorRequest" | "deal" | "operatorDispute"; request: string }
  | { to: "operatorExecutor"; executor: ExecutorKey };

export type NotificationSpec = {
  user: PersonRef;
  kind: string;
  title: string;
  body: string;
  link?: LinkRef;
  daysAgo: number;
  read?: true;
};

export const NOTIFICATIONS: NotificationSpec[] = [
  // Айгерим
  { user: { client: "aigerim" }, kind: "offer.received", title: "Новый отклик на заявку", body: "На заявку «Кухня» пришёл третий отклик: 980 000 ₸, срок 35 дней.", link: { to: "request", request: "tender-kitchen" }, daysAgo: 1.2 },
  { user: { client: "aigerim" }, kind: "deal.stage.submitted", title: "Этап сдан — проверьте работу", body: "Исполнитель сдал этап «Изготовление» по сделке «Шкаф-купе в спальню, 2,8 м». Если не ответить в течение 5 дней после сдачи, этап примется автоматически.", link: { to: "deal", request: "wardrobe-submitted" }, daysAgo: 1 },
  { user: { client: "aigerim" }, kind: "deal.contract.ready", title: "Договор готов к подписи", body: "Сделка «Прихожая с антресолью»: проверьте договор и подпишите ЭЦП.", link: { to: "deal", request: "contracting-hallway" }, daysAgo: 4 },
  { user: { client: "aigerim" }, kind: "measurement.no_deal", title: "Замер завершён без сделки", body: "По заявке «Мебель для ванной» сделка не состоялась. Плата за выезд — 10 000 ₸, оплачивается напрямую исполнителю. Заявка снова открыта для откликов.", link: { to: "request", request: "bathroom-no-deal" }, daysAgo: 15, read: true },
  // Данияр
  { user: { client: "daniyar" }, kind: "measurement.scheduled", title: "Замер назначен", body: "Исполнитель приедет на замер по заявке «ТВ-зона» через 2 дня в 11:00.", link: { to: "request", request: "measuring-tv" }, daysAgo: 1.8 },
  { user: { client: "daniyar" }, kind: "dispute.opened", title: "Спор открыт", body: "Оператор рассмотрит спор по сделке «Детская для двоих» и позиции обеих сторон.", link: { to: "deal", request: "kids-dispute" }, daysAgo: 2, read: true },
  { user: { client: "daniyar" }, kind: "deal.completed", title: "Сделка завершена", body: "Все этапы по сделке «Кухня с островом, шпон дуба» закрыты. Спасибо за отзыв!", link: { to: "deal", request: "kitchen-completed" }, daysAgo: 12, read: true },
  // Мадина
  { user: { client: "madina" }, kind: "offer.chosen", title: "Отклик выбран", body: "Адрес передан исполнителю по заявке «Шкаф-купе». Договоритесь о замере в чате.", link: { to: "request", request: "chosen-wardrobe" }, daysAgo: 0.6 },
  { user: { client: "madina" }, kind: "deal.payment.marked", title: "Оплата отмечена", body: "Вы отметили оплату аванса 174 000 ₸. Ждём, когда исполнитель подтвердит получение.", link: { to: "deal", request: "office-advance" }, daysAgo: 0.3, read: true },
  // Исполнители
  { user: { executor: "erlan" }, kind: "deal.contract.ready", title: "Договор готов к подписи", body: "Сделка «Прихожая с антресолью» на 315 000 ₸: подпишите договор ЭЦП.", link: { to: "deal", request: "contracting-hallway" }, daysAgo: 4 },
  { user: { executor: "erlan" }, kind: "request.new", title: "Новая заявка в вашем сегменте", body: "Кухня 3,4 м, сегмент «Комфорт», Астана.", link: { to: "executorRequest", request: "tender-kitchen" }, daysAgo: 3.2, read: true },
  { user: { executor: "erlan" }, kind: "offer.declined", title: "Заказчик выбрал другой отклик", body: "По заявке «Кабинет» выбран другой исполнитель.", link: { to: "executorRequest", request: "office-advance" }, daysAgo: 13, read: true },
  { user: { executor: "qazaq" }, kind: "deal.payment.marked", title: "Заказчик отметил оплату", body: "Аванс 174 000 ₸ по сделке «Кабинет со стеллажом до потолка». Проверьте поступление и подтвердите.", link: { to: "deal", request: "office-advance" }, daysAgo: 0.3 },
  { user: { executor: "kim" }, kind: "dispute.opened", title: "Заказчик открыл спор", body: "Сделка «Детская для двоих»: оператор рассмотрит позиции обеих сторон.", link: { to: "deal", request: "kids-dispute" }, daysAgo: 2, read: true },
  { user: { executor: "dala" }, kind: "measurement.reminder", title: "Замер через 2 дня", body: "Заявка «ТВ-зона»: замер в 11:00. Если сделка не состоится, плата за выезд — 10 000 ₸.", link: { to: "executorRequest", request: "measuring-tv" }, daysAgo: 1.8 },
  { user: { executor: "asel" }, kind: "request.direct", title: "Заказчик хочет похожее", body: "Новая заявка по вашей работе «Обеденный стол из карагача».", link: { to: "executorRequest", request: "direct-table" }, daysAgo: 1 },
  { user: { executor: "timur" }, kind: "offer.accepted", title: "Ваш отклик выбран", body: "Адрес заказчика открыт. Договоритесь о замере в чате.", link: { to: "executorRequest", request: "chosen-wardrobe" }, daysAgo: 0.6 },
  { user: { executor: "agash" }, kind: "review.received", title: "Новый отзыв", body: "Оценка 4 из 5 по сделке «Кухня с островом, шпон дуба».", link: { to: "deal", request: "kitchen-completed" }, daysAgo: 11, read: true },
  { user: { executor: "samat" }, kind: "registration.approved", title: "Профиль подтверждён", body: "Вам присвоен сегмент «Эконом». Теперь вы видите заявки этого сегмента.", daysAgo: 28, read: true },
  { user: { executor: "almas" }, kind: "registration.received", title: "Заявка на регистрацию принята", body: "Оператор проверит данные в течение рабочего дня.", daysAgo: 1.5 },
  { user: { executor: "express" }, kind: "registration.rejected", title: "Регистрация отклонена", body: "Фотографии портфолио найдены на сторонних сайтах. Загрузите фото собственных работ и подайте заявку снова.", daysAgo: 12 },
  // Оператор
  { user: { operator: true }, kind: "registration.pending", title: "Новая регистрация исполнителя", body: "Самозанятый, кухни и прихожие. Проверьте данные и присвойте сегмент.", link: { to: "operatorExecutor", executor: "almas" }, daysAgo: 1.5 },
  { user: { operator: true }, kind: "dispute.opened", title: "Открыт спор", body: "Сделка «Детская для двоих»: качество фасадов. Позиции сторон заполнены.", link: { to: "operatorDispute", request: "kids-dispute" }, daysAgo: 2 },
];
