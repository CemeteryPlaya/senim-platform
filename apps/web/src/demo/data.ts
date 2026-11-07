import type { DisputeReason, KycStatus, LegalForm, PreContractFlow, Segment } from "@/generated/prisma/enums";
import type { CountertopKey, DEFAULT_FURNITURE_TYPES, FacadeKey, HardwareKey, StyleKey } from "@/verticals/furniture";
import { testBin, testIin } from "./kz-id";
import type { PortfolioFileKey } from "./portfolio-files";

/**
 * Демо-данные «Сенім» — только описание. Логика вставки — в seed.ts.
 * Все сроки — «дней назад» (или «через N дней») от момента сида, чтобы демо не устаревало.
 * Телефоны +7 700 000 XX XX, ИИН/БИН с нулевым порядковым номером, адреса вымышленные.
 * Статусы заявок и откликов не задаются, а выводятся из фактов (seed.ts); сделки проходят свой путь
 * настоящими сервисами (deals.ts) — описать несогласованную историю нельзя.
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

/** Замерщик площадки (сценарий 2, ADR-005): сотрудник, как оператор, — только эта роль. */
export const MEASURER: PersonSpec = {
  fullName: "Нуржан Сейтказин",
  phone: "+77000000401",
  iin: testIin("900115", 3, 41),
  isDemo: true,
  joinedDaysAgo: 60,
};

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
  /** Где делали: город и район (встреча 31.10, п. 3) — не точный адрес. */
  place: string;
  /** «Подборка Сенім» во «Вдохновении». */
  featured?: boolean;
};

type Registration =
  | { status: "APPROVED"; segment: Segment; reviewedDaysAgo: number }
  | { status: "PENDING" }
  | { status: "REJECTED"; rejectReason: string; reviewedDaysAgo: number };

/**
 * Форма работы и подписант договора (ADR-003): самозанятый — он сам (ФИО — наименование), ИП — владелец
 * (ФИО — ownerName), у обоих ИИН/БИН профиля — ИИН владельца (person.iin). ТОО — директор: им в демо
 * назначен владелец аккаунта (person — ФИО и тестовый ИИН с верной контрольной цифрой).
 */
type Legal =
  | { legalForm: Extract<LegalForm, "SELF_EMPLOYED">; legalName: string }
  | { legalForm: Extract<LegalForm, "IP">; legalName: string; ownerName: string }
  | { legalForm: Extract<LegalForm, "TOO">; legalName: string; bin: string };

type Terms = { measurement: "FREE" } | { measurement: "INCLUDED" } | { measurement: "FEE_IF_NO_DEAL"; fee: number };

export type ExecutorSpec = Legal &
  Terms & {
    person: PersonSpec;
    registration: Registration;
    registeredDaysAgo: number;
    about: string;
    yearsExperience: number;
    /** Адрес мастерской (№6): район и улица — тестовые, без реальных данных; город — Астана по умолчанию. */
    workshop: { district: string; street: string };
    specializations: readonly FurnitureSlug[];
    portfolio: readonly PortfolioSpec[];
    /** Также заказчик на том же аккаунте (ADR-004): роли EXECUTOR и CLIENT. */
    alsoClient?: true;
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
    workshop: { district: "Есильский район", street: "ул. Тестовая, 1 (демо)" },
    about:
      "Делаю корпусную мебель 9 лет, небольшой цех на левом берегу. ЛДСП Egger и Kronospan, фурнитура Blum и Hettich. Замер и 3D-проект бесплатно.",
    specializations: ["kitchen", "wardrobe", "hallway"],
    portfolio: [
      { key: "erlan-kitchen", file: "kitchen-sage", type: "kitchen", style: "modern", title: "Кухня в новостройке, 3,4 м", description: "Фасады МДФ в эмали цвета шалфей, столешница под дуб, верхние шкафы до потолка.", priceFrom: 900_000, place: "Астана, Есильский район", featured: true },
      { key: "erlan-wardrobe", file: "wardrobe-oak", type: "wardrobe", style: "modern", title: "Шкаф-купе с зеркальной дверью", description: "Три двери, средняя — зеркало. Внутри штанга, полки и ящики с доводчиками.", priceFrom: 320_000, place: "Астана, Алматинский район" },
      { key: "erlan-hallway", file: "hallway-graphite", type: "hallway", style: "loft", title: "Прихожая с банкеткой", description: "Закрытый шкаф для верхней одежды, открытая вешалка, мягкая банкетка и зеркало.", priceFrom: 240_000, place: "Астана, Сарыаркинский район" },
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
    workshop: { district: "Алматинский район", street: "ул. Тестовая, 2 (демо)" },
    about:
      "Мебельное производство полного цикла: цех 1 200 м², станки с ЧПУ, три бригады монтажников. Шпон, массив, кварцевые столешницы. Гарантия 3 года.",
    specializations: ["kitchen", "walk-in-closet", "table", "bathroom"],
    portfolio: [
      { key: "agash-island", file: "kitchen-island-oak", type: "kitchen", style: "modern", title: "Кухня с островом, шпон дуба", description: "Остров с барной зоной, столешница из кварцевого агломерата, фурнитура Blum.", priceFrom: 2_400_000, place: "Астана, Есильский район", featured: true },
      { key: "agash-closet", file: "closet-walnut", type: "walk-in-closet", style: "classic", title: "Гардеробная под потолок, орех", description: "Открытые секции, штанги на двух уровнях, ящики с бархатными вставками.", priceFrom: 1_300_000, place: "Косшы" },
      { key: "agash-neoclassic", file: "kitchen-neoclassic", type: "kitchen", style: "neoclassic", title: "Кухня в стиле неоклассика", description: "Фрезерованные фасады в эмали, латунные ручки, столешница из искусственного камня.", priceFrom: 2_100_000, place: "Астана, район Нура" },
    ],
  },
  kim: {
    person: { fullName: "Руслан Ким", phone: "+77000000203", iin: testIin("870921", 3, 23), isDemo: true, joinedDaysAgo: 250 },
    legalForm: "IP",
    legalName: "ИП Ким Руслан Владимирович",
    ownerName: "Ким Руслан Владимирович",
    registration: { status: "APPROVED", segment: "COMFORT", reviewedDaysAgo: 249 },
    registeredDaysAgo: 250,
    measurement: "FEE_IF_NO_DEAL",
    fee: FEE,
    yearsExperience: 6,
    workshop: { district: "Сарыаркинский район", street: "ул. Тестовая, 3 (демо)" },
    about:
      "Детская и корпусная мебель. Материалы класса E0.5, закруглённые кромки, мягкие доводчики. Выезд на замер — 10 000 ₸, только если сделка не состоится.",
    specializations: ["kids-room", "wardrobe", "office"],
    portfolio: [
      { key: "kim-kids", file: "kids-bunk", type: "kids-room", style: "scandi", title: "Детская для двоих", description: "Двухъярусная кровать с ящиками, лестница-полки, письменный стол с тумбой.", priceFrom: 650_000, place: "Астана, район Байконыр", featured: true },
      { key: "kim-office", file: "office-white", type: "office", style: "scandi", title: "Домашний кабинет со стеллажом", description: "Стеллаж с закрытыми ящиками внизу, стол с тумбой, всё в белом и дубе.", priceFrom: 420_000, place: "Астана, Алматинский район" },
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
    workshop: { district: "район Байконыр", street: "ул. Тестовая, 4 (демо)" },
    about: "Шкафы-купе и гардеробные из ЛДСП. Профиль Aristo, зеркала с пескоструйным рисунком. Работаю быстро, замер бесплатно.",
    specializations: ["wardrobe", "walk-in-closet", "hallway"],
    portfolio: [
      { key: "timur-wardrobe", file: "wardrobe-white", type: "wardrobe", style: "minimalism", title: "Шкаф-купе 2,8 м в нишу", description: "Белое ЛДСП, зеркальная дверь по центру, внутри полки под обувь.", priceFrom: 210_000, place: "Астана, Сарыаркинский район" },
      { key: "timur-closet", file: "closet-light", type: "walk-in-closet", style: "scandi", title: "Гардеробная в спальне", description: "Открытая система: штанги, полки, ящики. Светлый дуб.", priceFrom: 280_000, place: "Астана, район Байконыр" },
    ],
  },
  asel: {
    person: { fullName: "Асель Нурланова", phone: "+77000000205", iin: testIin("960730", 4, 25), isDemo: true, joinedDaysAgo: 180 },
    legalForm: "IP",
    legalName: "ИП Нурланова Асель Ерлановна",
    ownerName: "Нурланова Асель Ерлановна",
    registration: { status: "APPROVED", segment: "PREMIUM", reviewedDaysAgo: 179 },
    registeredDaysAgo: 180,
    measurement: "FEE_IF_NO_DEAL",
    fee: FEE,
    yearsExperience: 4,
    workshop: { district: "район Нура", street: "ул. Тестовая, 5 (демо)" },
    about: "Столярная мастерская: столы, комоды и тумбы для ванной из массива карагача, дуба и ореха. Масло-воск, ручная работа.",
    specializations: ["table", "bathroom", "dresser"],
    portfolio: [
      { key: "asel-table", file: "table-karagach", type: "table", style: "modern", title: "Обеденный стол из карагача", description: "Столешница из цельных ламелей карагача, масло-воск, ножки из массива.", priceFrom: 420_000, place: "Астана, Есильский район", featured: true },
      { key: "asel-vanity", file: "bathroom-walnut", type: "bathroom", style: "minimalism", title: "Тумба под раковину из ореха", description: "Подвесная тумба с влагостойкой пропиткой и круглое зеркало в раме.", priceFrom: 290_000, place: "Астана, район Нура" },
      { key: "asel-dresser", file: "dresser-oak", type: "dresser", style: "scandi", title: "Комод из дуба на ножках", description: "Шесть ящиков на скрытых направляющих, ручки из латуни.", priceFrom: 360_000, place: "Астана, Алматинский район" },
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
    workshop: { district: "Есильский район", street: "ул. Тестовая, 6 (демо)" },
    about:
      "Корпусная мебель для дома и офиса. Своё производство в промзоне Астаны, замер включён в стоимость заказа. Работаем с физлицами и компаниями.",
    specializations: ["office", "kitchen", "shelving", "living-room"],
    portfolio: [
      { key: "qazaq-office", file: "office-walnut", type: "office", style: "classic", title: "Кабинет руководителя", description: "Стеллаж под потолок из шпона ореха, стол с тумбой, скрытая проводка.", priceFrom: 750_000, place: "Астана, Есильский район" },
      { key: "qazaq-shelving", file: "shelving-loft", type: "shelving", style: "loft", title: "Стеллаж-перегородка в стиле лофт", description: "Металлический каркас, полки из массива сосны, зонирует комнату.", priceFrom: 230_000, place: "Астана, Сарыаркинский район", featured: true },
    ],
  },
  dala: {
    person: { fullName: "Нурлан Абдрахманов", phone: "+77000000207", iin: testIin("880512", 3, 27), isDemo: true, joinedDaysAgo: 280 },
    legalForm: "IP",
    legalName: "ИП Абдрахманов Нурлан Канатович",
    ownerName: "Абдрахманов Нурлан Канатович",
    registration: { status: "APPROVED", segment: "COMFORT", reviewedDaysAgo: 278 },
    alsoClient: true,
    registeredDaysAgo: 280,
    measurement: "FEE_IF_NO_DEAL",
    fee: FEE,
    yearsExperience: 7,
    workshop: { district: "Алматинский район", street: "ул. Тестовая, 7 (демо)" },
    about: "Мастерская полного цикла: кухни, спальни и ТВ-зоны. Помогаем с проектом и подбираем материалы под бюджет.",
    specializations: ["kitchen", "bedroom", "living-room", "kids-room"],
    portfolio: [
      { key: "dala-bedroom", file: "bedroom-beige", type: "bedroom", style: "scandi", title: "Спальня с мягким изголовьем", description: "Кровать с изголовьем во всю стену и две прикроватные тумбы.", priceFrom: 560_000, place: "Астана, Алматинский район", featured: true },
      { key: "dala-tv", file: "tv-zone-scandi", type: "living-room", style: "scandi", title: "ТВ-зона с подвесными тумбами", description: "Реечная панель, подвесная тумба на всю стену, полки для декора.", priceFrom: 380_000, place: "Астана, район Байконыр" },
      { key: "dala-kitchen", file: "kitchen-terracotta", type: "kitchen", style: "modern", title: "Кухня терракотового цвета, 3 м", description: "Фасады МДФ в плёнке, тёмная столешница, встроенная мойка.", priceFrom: 820_000, place: "Косшы" },
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
    workshop: { district: "Сарыаркинский район", street: "ул. Тестовая, 8 (демо)" },
    about: "Начинающий мастер: прихожие, шкафы и комоды из ЛДСП. Работаю аккуратно и недорого.",
    specializations: ["hallway", "wardrobe", "dresser"],
    portfolio: [
      { key: "samat-hallway", file: "hallway-sonoma", type: "hallway", style: "modern", title: "Прихожая в коридор", description: "Шкаф, открытая вешалка и банкетка в цвете дуб сонома.", priceFrom: 130_000, place: "Астана, район Нура" },
      { key: "samat-dresser", file: "dresser-white", type: "dresser", style: "scandi", title: "Комод для детской", description: "Белый комод на шесть ящиков с голубыми ручками.", priceFrom: 75_000, place: "Астана, Сарыаркинский район" },
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
    workshop: { district: "район Байконыр", street: "ул. Тестовая, 9 (демо)" },
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
    workshop: { district: "район Нура", street: "ул. Тестовая, 10 (демо)" },
    about: "Мебель по низким ценам за 7 дней.",
    specializations: ["wardrobe", "kitchen"],
    portfolio: [],
  },
} as const satisfies Record<string, ExecutorSpec>;

export type ExecutorKey = keyof typeof EXECUTORS;

// ─── проверка документов мастеров (KYC, решение 2.2.8) ───────────────────────

/** Документы — тестовые PDF «ТЕСТОВЫЙ ДОКУМЕНТ» (seed.ts); нет записи — мастер документов не загружал. */
export type KycSpec = { status: Extract<KycStatus, "VERIFIED">; reviewedDaysAgo: number } | { status: "PENDING"; uploadedDaysAgo: number } | { status: "REJECTED"; reason: string; reviewedDaysAgo: number };

export const KYC: Partial<Record<ExecutorKey, KycSpec>> = {
  erlan: { status: "VERIFIED", reviewedDaysAgo: 290 },
  agash: { status: "VERIFIED", reviewedDaysAgo: 390 },
  kim: { status: "VERIFIED", reviewedDaysAgo: 240 },
  asel: { status: "VERIFIED", reviewedDaysAgo: 170 },
  qazaq: { status: "VERIFIED", reviewedDaysAgo: 340 },
  dala: { status: "VERIFIED", reviewedDaysAgo: 270 },
  // В очереди оператора: документы загружены, решения нет.
  samat: { status: "PENDING", uploadedDaysAgo: 0.5 },
  timur: { status: "REJECTED", reason: "Фото удостоверения нечитаемо: загрузите снимок без бликов, обе стороны", reviewedDaysAgo: 3 },
};

// ─── заявки и отклики ────────────────────────────────────────────────────────

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

/** Замер исполнителем — только сценарии до договора (флаг preContractFlows). */
export type MeasurementSpec =
  | { status: "SCHEDULED"; bookedDaysAgo: number; inDays: number }
  | { status: "DONE"; bookedDaysAgo: number; visitDaysAgo: number; result: string; finalPrice: number }
  | { status: "NO_DEAL"; bookedDaysAgo: number; visitDaysAgo: number; result: string };

/** Ход торга после цены отклика (её мастер предлагает первым): кто и какую цену предложил следом. */
export type RoundSpec = { by: "client" | "executor"; priceKzt: number; daysAgo: number };

export type OfferSpec = {
  executor: ExecutorKey;
  /** Цена отклика в тенге — первое предложение торга (путь ТЗ). */
  price: number;
  durationDays: number;
  warrantyMonths: number;
  comment: string;
  sentDaysAgo: number;
  /** Путь ТЗ: встречные цены по порядку; последняя ждёт ответа другой стороны (её и принимают в deals.ts). */
  rounds?: readonly RoundSpec[];
  /** Сценарии до договора: заказчик выбрал отклик. Остальные отклики, присланные раньше, отклоняются в этот момент. */
  chosen?: { daysAgo: number; measurement?: MeasurementSpec };
  messages?: MessageSpec[];
};

type Targeting = { mode: "TENDER" } | { mode: "DIRECT"; target: ExecutorKey; portfolioItem: string };

/** Заказчик заявки: персона-заказчик или исполнитель, который заказывал как заказчик (ADR-004). */
export type ClientRef = ClientKey | { executor: ExecutorKey };

export type GeoPoint = { lat: number; lng: number };

export type RequestSpec = Targeting & {
  key: string;
  client: ClientRef;
  type: FurnitureSlug;
  style: StyleKey;
  details: RequestDetails;
  /** Выбор заказчика; null — ещё не выбран (черновик). */
  segment: Segment | null;
  address: Address | null;
  desiredInDays?: number;
  wishes: string;
  createdDaysAgo: number;
  wizardStep: number;
  /** Нет — заявка ещё черновик. */
  publishedDaysAgo?: number;
  cancelled?: { daysAgo: number; reason: string };
  offers: OfferSpec[];
  /** Сценарий до договора (флаг preContractFlows, ADR-005); нет — путь ТЗ: торг и оферта. */
  flow?: PreContractFlow;
  /** Сценарий 2: замер площадки назначен демо-замерщику. */
  site?: { assignedDaysAgo: number };
};

/** Тестовые адреса с координатами (центр Астаны): по ним — мягкая GPS-проверка сдачи работы. */
type Address = { text: string; point: GeoPoint };

const ADDR = {
  demo12: { text: "Астана, ул. Демонстрационная, 12, кв. 45", point: { lat: 51.128207, lng: 71.430411 } },
  primer8: { text: "Астана, пр. Примерный, 8, кв. 101", point: { lat: 51.0905, lng: 71.4187 } },
  obrazets3: { text: "Астана, ул. Образцовая, 3, кв. 17", point: { lat: 51.1605, lng: 71.4704 } },
  test2: { text: "Астана, мкр. Тестовый-2, д. 5, кв. 30", point: { lat: 51.1477, lng: 71.3915 } },
  maket21: { text: "Астана, ул. Макетная, 21, кв. 9", point: { lat: 51.1098, lng: 71.4022 } },
  sample4: { text: "Астана, пр. Условный, 4, кв. 66", point: { lat: 51.1283, lng: 71.4606 } },
  probny7: { text: "Астана, ул. Пробная, 7, кв. 112", point: { lat: 51.1696, lng: 71.4248 } },
  shablon15: { text: "Астана, ул. Шаблонная, 15, кв. 3", point: { lat: 51.0767, lng: 71.4469 } },
  chernovik9: { text: "Астана, мкр. Черновой, д. 9, кв. 54", point: { lat: 51.1352, lng: 71.3611 } },
} as const satisfies Record<string, Address>;

/** Заявка пути ТЗ с одним откликом — под сделку (deals.ts принимает последнюю цену торга). */
function dealRequest(o: {
  key: string;
  client: ClientRef;
  executor: ExecutorKey;
  type: FurnitureSlug;
  style: StyleKey;
  details: RequestDetails;
  segment: Segment;
  address: Address;
  wishes: string;
  daysAgo: number;
  price: number;
  durationDays: number;
  comment: string;
  rounds?: readonly RoundSpec[];
  messages?: MessageSpec[];
  /** Другие отклики: при акцепте цены их отклоняет requests.acceptPrice. */
  others?: OfferSpec[];
}): RequestSpec {
  return {
    key: o.key,
    mode: "TENDER",
    client: o.client,
    type: o.type,
    style: o.style,
    details: o.details,
    segment: o.segment,
    address: o.address,
    desiredInDays: 30,
    wishes: o.wishes,
    createdDaysAgo: o.daysAgo,
    publishedDaysAgo: o.daysAgo - 0.1,
    wizardStep: 6,
    offers: [
      {
        executor: o.executor,
        price: o.price,
        durationDays: o.durationDays,
        warrantyMonths: 24,
        comment: o.comment,
        sentDaysAgo: o.daysAgo - 0.5,
        rounds: o.rounds,
        messages: o.messages,
      },
      ...(o.others ?? []),
    ],
  };
}

/** Заявки без сделки: черновик, тендер с торгом в разных раундах, прямой запрос, отменённая. */
const OPEN_REQUESTS: RequestSpec[] = [
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
        // Встречная цена покупателя ждёт ответа мастера.
        executor: "erlan",
        price: 1_050_000,
        durationDays: 30,
        warrantyMonths: 24,
        comment: "Сделаю фасады в эмали, фурнитура Blum. Замер бесплатно, 3D-проект покажу на замере.",
        sentDaysAgo: 2.9,
        rounds: [{ by: "client", priceKzt: 980_000, daysAgo: 2.3 }],
        messages: [
          { from: "client", text: "Здравствуйте! Можно сделать фасады без ручек?", daysAgo: 2.5 },
          { from: "executor", text: "Да, с профилем Gola — это плюс 40 000 ₸. Образцы покажу на замере.", daysAgo: 2.4 },
        ],
      },
      {
        // Цена отклика ждёт ответа покупателя.
        executor: "qazaq",
        price: 1_180_000,
        durationDays: 25,
        warrantyMonths: 24,
        comment: "Своё производство, срок фиксируем в оферте. Замер входит в стоимость.",
        sentDaysAgo: 2.1,
        messages: [
          { from: "executor", text: "Добрый день! Удобнее обсудить по телефону: [контакт скрыт]", daysAgo: 2.0, masked: true },
          { from: "client", text: "Давайте здесь, в чате платформы.", daysAgo: 1.9 },
          { from: "executor", text: "Хорошо. Столешницу предлагаю компакт-плиту 12 мм — она тоньше и прочнее.", daysAgo: 1.8 },
        ],
      },
      {
        // Третий раунд: мастер ответил на встречную цену своей — ждёт покупателя.
        executor: "dala",
        price: 1_020_000,
        durationDays: 35,
        warrantyMonths: 18,
        comment: "Фасады МДФ эмаль, столешница компакт-плита.",
        sentDaysAgo: 1.2,
        rounds: [
          { by: "client", priceKzt: 940_000, daysAgo: 1.0 },
          { by: "executor", priceKzt: 990_000, daysAgo: 0.7 },
        ],
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
];

/** Заявки под сделки (deals.ts): по одной на каждый шаг пути сделки ТЗ. */
const DEAL_REQUESTS: RequestSpec[] = [
  dealRequest({
    key: "deal-offer-hallway", client: "aigerim", executor: "erlan", type: "hallway", style: "minimalism",
    details: { widthCm: 220, heightCm: 250, depthCm: 45, facade: "mdf_film", hardware: "soft_close", color: "Графит" }, segment: "COMFORT", address: ADDR.demo12,
    wishes: "Нужна антресоль над входной дверью.", daysAgo: 6, price: 330_000, durationDays: 21, comment: "Антресоль над дверью сделаю в цвет шкафа.",
    rounds: [
      { by: "client", priceKzt: 300_000, daysAgo: 5 },
      { by: "executor", priceKzt: 315_000, daysAgo: 4.5 },
    ],
    others: [{ executor: "kim", price: 340_000, durationDays: 18, warrantyMonths: 24, comment: "Сделаю с доводчиками и подсветкой.", sentDaysAgo: 5.2 }],
  }),
  dealRequest({
    key: "deal-signed-shelving", client: "madina", executor: "qazaq", type: "shelving", style: "loft",
    details: { widthCm: 260, heightCm: 240, facade: "mdf_film" }, segment: "COMFORT", address: ADDR.test2,
    wishes: "Стеллаж-перегородка между кухней и гостиной.", daysAgo: 8, price: 260_000, durationDays: 20, comment: "Металлический каркас, полки из массива сосны.",
  }),
  dealRequest({
    key: "deal-manual-hold-office", client: "daniyar", executor: "kim", type: "office", style: "modern",
    details: { widthCm: 300, heightCm: 270, facade: "mdf_film", countertop: "compact", hardware: "soft_close" }, segment: "COMFORT", address: ADDR.primer8,
    wishes: "Стеллаж до потолка и стол для двух мониторов.", daysAgo: 10, price: 600_000, durationDays: 25, comment: "Стеллаж под потолок и стол с тумбой.",
    rounds: [{ by: "client", priceKzt: 580_000, daysAgo: 8 }],
  }),
  dealRequest({
    key: "deal-paid-wardrobe", client: "aigerim", executor: "timur", type: "wardrobe", style: "modern",
    details: { widthCm: 240, heightCm: 260, depthCm: 60, facade: "ldsp", hardware: "standard", color: "Белый, одна дверь — зеркало" }, segment: "ECONOMY", address: ADDR.demo12,
    wishes: "Шкаф в прихожую, внутри полки под обувь.", daysAgo: 9, price: 290_000, durationDays: 14, comment: "Профиль Aristo, зеркало серебро.",
    others: [{ executor: "samat", price: 260_000, durationDays: 18, warrantyMonths: 12, comment: "Сделаю недорого и аккуратно.", sentDaysAgo: 8.2 }],
  }),
  dealRequest({
    key: "deal-paid-dispute-bedroom", client: "zhanna", executor: "dala", type: "bedroom", style: "scandi",
    details: { facade: "mdf_film", hardware: "soft_close" }, segment: "COMFORT", address: ADDR.chernovik9,
    wishes: "Кровать с мягким изголовьем во всю стену и две тумбы.", daysAgo: 20, price: 640_000, durationDays: 30, comment: "Изголовье в ткани на выбор, тумбы с доводчиками.",
  }),
  dealRequest({
    key: "deal-progress-kitchen", client: "aigerim", executor: "erlan", type: "kitchen", style: "modern",
    details: { widthCm: 320, heightCm: 270, depthCm: 60, facade: "mdf_enamel", countertop: "ldsp", hardware: "soft_close", color: "Шалфей" }, segment: "COMFORT", address: ADDR.demo12,
    wishes: "Кухня 3,2 м под потолок.", daysAgo: 25, price: 1_050_000, durationDays: 35, comment: "Фасады МДФ в эмали, верхние шкафы до потолка.",
    rounds: [
      { by: "client", priceKzt: 1_000_000, daysAgo: 23 },
      { by: "executor", priceKzt: 1_020_000, daysAgo: 22.5 },
    ],
  }),
  dealRequest({
    key: "deal-ready-closet", client: "daniyar", executor: "agash", type: "walk-in-closet", style: "classic",
    details: { facade: "veneer", hardware: "premium" }, segment: "PREMIUM", address: ADDR.primer8,
    wishes: "Гардеробная под потолок, открытые секции.", daysAgo: 40, price: 1_450_000, durationDays: 30, comment: "Шпон ореха, ящики с бархатными вставками.",
  }),
  dealRequest({
    key: "deal-ready-far-tv", client: "madina", executor: "dala", type: "living-room", style: "scandi",
    details: { widthCm: 320, heightCm: 260, facade: "mdf_film", hardware: "soft_close", color: "Светлое дерево и белый" }, segment: "COMFORT", address: ADDR.obrazets3,
    wishes: "Реечная панель за телевизором и подвесная тумба.", daysAgo: 30, price: 460_000, durationDays: 21, comment: "Похожую ТВ-зону делали в прошлом месяце, фото в портфолио.",
  }),
  dealRequest({
    key: "deal-ready-dispute-kids", client: "daniyar", executor: "kim", type: "kids-room", style: "scandi",
    details: { facade: "mdf_film", hardware: "soft_close", color: "Белый и голубой", unknown: ["size"] }, segment: "COMFORT", address: ADDR.primer8,
    wishes: "Двухъярусная кровать с ящиками, шкаф и стол для двоих детей.", daysAgo: 35, price: 720_000, durationDays: 28, comment: "Двухъярусная кровать, лестница-полки, стол с тумбой.",
  }),
  dealRequest({
    key: "deal-accepted-manual-kitchen", client: "olga", executor: "agash", type: "kitchen", style: "neoclassic",
    details: { widthCm: 420, heightCm: 280, depthCm: 60, facade: "veneer", countertop: "quartz", hardware: "premium", color: "Натуральный дуб, столешница белый мрамор" }, segment: "PREMIUM", address: ADDR.maket21,
    wishes: "Остров с барной зоной, встроенная техника.", daysAgo: 60, price: 2_750_000, durationDays: 40, comment: "Кухня 4,2 м и остров 1,8 м, шпон дуба.",
  }),
  dealRequest({
    key: "deal-done-table", client: "olga", executor: "asel", type: "table", style: "modern",
    details: { widthCm: 180, facade: "solid_wood" }, segment: "PREMIUM", address: ADDR.maket21,
    wishes: "Обеденный стол из карагача на шесть человек.", daysAgo: 50, price: 450_000, durationDays: 30, comment: "Ламели карагача, масло-воск.",
  }),
  dealRequest({
    key: "deal-done-manual-wardrobe", client: "arman", executor: "timur", type: "wardrobe", style: "minimalism",
    details: { widthCm: 200, facade: "mdf_film", hardware: "soft_close" }, segment: "ECONOMY", address: ADDR.sample4,
    wishes: "Шкаф-купе в нишу.", daysAgo: 70, price: 360_000, durationDays: 20, comment: "Двери на алюминиевом профиле, внутри штанга и полки.",
  }),
  dealRequest({
    key: "deal-split-office", client: "erbolat", executor: "kim", type: "office", style: "scandi",
    details: { facade: "mdf_film", hardware: "soft_close" }, segment: "COMFORT", address: ADDR.shablon15,
    wishes: "Домашний кабинет: стол, стеллаж, тумба.", daysAgo: 45, price: 520_000, durationDays: 25, comment: "Стеллаж с закрытыми ящиками внизу, стол с тумбой.",
  }),
  dealRequest({
    key: "deal-cancelled-dresser", client: "saule", executor: "samat", type: "dresser", style: "scandi",
    details: { widthCm: 100, facade: "ldsp" }, segment: "ECONOMY", address: ADDR.probny7,
    wishes: "Комод на пять ящиков.", daysAgo: 15, price: 85_000, durationDays: 10, comment: "Белый комод, ручки на выбор.",
  }),
  dealRequest({
    key: "deal-refunded-hallway", client: "arman", executor: "samat", type: "hallway", style: "modern",
    details: { facade: "ldsp", hardware: "standard" }, segment: "ECONOMY", address: ADDR.sample4,
    wishes: "Прихожая со шкафом и банкеткой.", daysAgo: 18, price: 180_000, durationDays: 14, comment: "Шкаф, вешалка и банкетка в цвете дуб сонома.",
  }),
  dealRequest({
    key: "deal-refund-dispute-wardrobe", client: "zhanna", executor: "erlan", type: "wardrobe", style: "modern",
    details: { widthCm: 260, facade: "mdf_film", hardware: "soft_close" }, segment: "COMFORT", address: ADDR.chernovik9,
    wishes: "Шкаф-купе в спальню.", daysAgo: 28, price: 360_000, durationDays: 20, comment: "Зеркальная дверь по центру.",
  }),
];

export const REQUESTS: RequestSpec[] = [...OPEN_REQUESTS, ...DEAL_REQUESTS];

/**
 * Исполнитель «Дала» (ИП Абдрахманов) сам заказывает шкаф как заказчик (ADR-004). Сеется после REQUESTS.
 * ИИН заказчика в аккаунте и ИИН профиля ИП совпадают — это один человек (OPEN_QUESTIONS №28).
 */
export const DUAL_ROLE_REQUESTS: RequestSpec[] = [
  dealRequest({
    key: "deal-dual-role-wardrobe", client: { executor: "dala" }, executor: "timur", type: "wardrobe", style: "modern",
    details: { widthCm: 180, facade: "ldsp", hardware: "standard" }, segment: "ECONOMY", address: ADDR.sample4,
    wishes: "Шкаф в прихожую для себя.", daysAgo: 40, price: 250_000, durationDays: 18, comment: "ЛДСП Egger, фурнитура стандартная.",
  }),
];

/** Материалы проекта после замера (сценарии до договора, ADR-005). */
export const PROJECT_MATERIALS = "Корпус — ЛДСП Egger 16 мм, фасады по заявке, кромка ПВХ 2 мм, фурнитура с доводчиками.";

/**
 * Сценарии до договора 1–5 (флаг preContractFlows, ADR-005): по одной заявке на шаге, с которого основатели
 * проходят сценарий. При выключенном флаге экраны их читают, но новых шагов не предлагают. Сеются последними.
 */
export const PRE_CONTRACT_REQUESTS: RequestSpec[] = [
  {
    key: "flow1-chosen-wardrobe",
    flow: "EXECUTOR_MEASURE",
    mode: "TENDER",
    client: "madina",
    type: "wardrobe",
    style: "modern",
    details: { widthCm: 240, heightCm: 260, depthCm: 60, facade: "ldsp", hardware: "standard", color: "Белый" },
    segment: "ECONOMY",
    address: ADDR.obrazets3,
    desiredInDays: 30,
    wishes: "Шкаф в спальню, внутри полки под бельё.",
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
    key: "flow1-measuring-tv",
    flow: "EXECUTOR_MEASURE",
    mode: "TENDER",
    client: "daniyar",
    type: "living-room",
    style: "scandi",
    details: { widthCm: 300, heightCm: 260, facade: "mdf_film", hardware: "soft_close", color: "Светлое дерево" },
    segment: "COMFORT",
    address: ADDR.primer8,
    desiredInDays: 35,
    wishes: "ТВ-зона в спальне.",
    createdDaysAgo: 6,
    publishedDaysAgo: 5.9,
    wizardStep: 6,
    offers: [
      {
        executor: "dala",
        price: 420_000,
        durationDays: 21,
        warrantyMonths: 18,
        comment: "Приеду с образцами.",
        sentDaysAgo: 5.2,
        chosen: { daysAgo: 2.0, measurement: { status: "SCHEDULED", bookedDaysAgo: 1.8, inDays: 2 } },
        messages: [{ from: "executor", text: "Приеду на замер послезавтра в 11:00, возьму образцы реек.", daysAgo: 1.8 }],
      },
      { executor: "qazaq", price: 520_000, durationDays: 20, warrantyMonths: 24, comment: "Замер включён в стоимость.", sentDaysAgo: 4.8 },
    ],
  },
  {
    key: "flow1-no-deal-bathroom",
    flow: "EXECUTOR_MEASURE",
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
        comment: "Тумба из ореха с влагостойкой пропиткой.",
        sentDaysAgo: 19,
        chosen: {
          daysAgo: 17,
          measurement: { status: "NO_DEAL", bookedDaysAgo: 16.8, visitDaysAgo: 15, result: "Ниша нестандартная, цена после замера — 410 000 ₸. Заказчик не согласился." },
        },
      },
      { executor: "agash", price: 390_000, durationDays: 25, warrantyMonths: 36, comment: "Сделаем в шпоне, гарантия 3 года.", sentDaysAgo: 6 },
    ],
  },
  {
    key: "flow2-site-kitchen",
    flow: "PLATFORM_MEASURER",
    mode: "TENDER",
    client: "madina",
    type: "kitchen",
    style: "modern",
    details: { unknown: ["size"], facade: "mdf_film", hardware: "soft_close", color: "Белый и дуб" },
    segment: "COMFORT",
    address: ADDR.test2,
    desiredInDays: 45,
    wishes: "Кухня под потолок, встроенный холодильник.",
    createdDaysAgo: 1.2,
    publishedDaysAgo: 1.1,
    wizardStep: 6,
    site: { assignedDaysAgo: 0.8 },
    offers: [],
  },
  {
    key: "flow3-contract-wardrobe",
    flow: "CONTRACT_FIRST",
    mode: "TENDER",
    client: "daniyar",
    type: "wardrobe",
    style: "minimalism",
    details: { widthCm: 240, heightCm: 260, facade: "ldsp", hardware: "standard" },
    segment: "ECONOMY",
    address: ADDR.maket21,
    desiredInDays: 30,
    wishes: "Шкаф-купе в спальню, одна дверь — зеркало.",
    createdDaysAgo: 3,
    publishedDaysAgo: 2.9,
    wizardStep: 6,
    offers: [
      { executor: "timur", price: 280_000, durationDays: 20, warrantyMonths: 12, comment: "Сделаю по вашим размерам, замер и проект — первым этапом договора.", sentDaysAgo: 2.5, chosen: { daysAgo: 0.4 } },
      { executor: "samat", price: 260_000, durationDays: 25, warrantyMonths: 12, comment: "ЛДСП Egger, фурнитура стандартная.", sentDaysAgo: 2.2 },
    ],
  },
  {
    key: "flow4-deposit-hallway",
    flow: "MEASURE_DEPOSIT",
    mode: "TENDER",
    client: "madina",
    type: "hallway",
    style: "modern",
    details: { widthCm: 160, facade: "ldsp", hardware: "standard" },
    segment: "ECONOMY",
    address: ADDR.shablon15,
    desiredInDays: 25,
    wishes: "Прихожая с банкеткой и зеркалом.",
    createdDaysAgo: 2.5,
    publishedDaysAgo: 2.4,
    wizardStep: 6,
    offers: [
      { executor: "samat", price: 150_000, durationDays: 14, warrantyMonths: 12, comment: "Похожую прихожую делал недавно, фото в портфолио.", sentDaysAgo: 2, chosen: { daysAgo: 0.3 } },
    ],
  },
  {
    key: "flow5-self-dresser",
    flow: "SELF_MEASURE",
    mode: "TENDER",
    client: "daniyar",
    type: "dresser",
    style: "scandi",
    details: { widthCm: 120, heightCm: 85, depthCm: 45, facade: "mdf_film", hardware: "soft_close", color: "Белый" },
    segment: "COMFORT",
    address: ADDR.probny7,
    desiredInDays: 20,
    wishes: "Комод в детскую, размеры снял сам по инструкции.",
    createdDaysAgo: 1.5,
    publishedDaysAgo: 1.4,
    wizardStep: 6,
    offers: [
      { executor: "kim", price: 190_000, durationDays: 18, warrantyMonths: 18, comment: "Посчитал по вашим размерам, контрольный замер — первым этапом.", sentDaysAgo: 1 },
      { executor: "erlan", price: 210_000, durationDays: 15, warrantyMonths: 24, comment: "Фасады МДФ, доводчики Blum.", sentDaysAgo: 0.8 },
    ],
  },
];

// ─── сделки: путь ТЗ настоящими сервисами (deals.ts) ─────────────────────────

/** Фото сдачи и «Хода работ» — из демо-SVG портфолио (seed переводит их в JPEG и загружает через files). */
export type ProgressSpec = { title: string; text: string; photos: readonly PortfolioFileKey[] };

export type DisputeSpec = {
  by: "client" | "executor";
  reason: DisputeReason;
  description: string;
  clientPosition: string;
  executorPosition: string;
};

/** Итог спора (ADR-009 раздел 3); masterShareKzt — доля мастера Y из цены X при разделе. */
export type ResolutionSpec = { outcome: "FULL_REFUND"; rationale: string } | { outcome: "PARTIAL_SPLIT"; masterShareKzt: number; rationale: string };

/**
 * Шаги сделки по порядку — ровно те действия, что делают люди в приложении:
 *  sign — обе стороны подписывают оферту (собственноручно и ЭЦП mock); pay — покупатель оплачивает;
 *  bank — оператор подтверждает ждущие операции manual банковским документом (тестовый скан);
 *  start, progress, ready (фото и место сдачи: у адреса или в ~2 км), signAct (обе стороны), signActClient
 *  (только покупатель — ждём ЭЦП мастера), cancel, dispute, resolve.
 */
export type DealStep =
  | "sign"
  | "pay"
  | "bank"
  | "start"
  | { progress: ProgressSpec }
  | { ready: { at: "address" | "far"; photos: readonly PortfolioFileKey[] } }
  | "signAct"
  | "signActClient"
  | { cancel: "client" | "executor"; reason: string }
  | { dispute: DisputeSpec }
  | { resolve: ResolutionSpec };

export type DealPlan = {
  /** Ключ заявки из REQUESTS / DUAL_ROLE_REQUESTS: принимается последняя цена торга её первого отклика. */
  request: string;
  provider: "mock" | "manual";
  steps: readonly DealStep[];
};

const READY_PHOTOS = {
  closet: ["closet-walnut", "closet-light"],
  tv: ["tv-zone-scandi"],
  kids: ["kids-bunk"],
  kitchen: ["kitchen-neoclassic", "kitchen-island-oak"],
  table: ["table-karagach"],
  wardrobe: ["wardrobe-oak"],
  office: ["office-white"],
} as const satisfies Record<string, readonly PortfolioFileKey[]>;

const KIDS_DISPUTE: DisputeSpec = {
  by: "client",
  reason: "QUALITY",
  description: "Цвет фасадов не совпадает с согласованным: вместо голубого — серо-синий. На двух деталях отходит кромка.",
  clientPosition: "Прошу переделать фасады в согласованный цвет и заменить детали с кромкой. Подписывать акт в таком виде не готов.",
  executorPosition: "Цвет соответствует образцу RAL 5024 из оферты, на фото оттенок искажён. Кромку переклеим по гарантии, перекрашивать фасады за свой счёт не согласен.",
};

/** Сделки во всех статусах ТЗ (п. 9) — на mock и на manual. Порядок задаёт номера сделок. */
export const DEALS: readonly DealPlan[] = [
  // CREATED: оферта ещё не подписана.
  { request: "deal-offer-hallway", provider: "mock", steps: [] },
  // CREATED: оферта заключена, ждёт оплаты.
  { request: "deal-signed-shelving", provider: "mock", steps: ["sign"] },
  // CREATED на manual: оплата ждёт подтверждения оператора по выписке банка.
  { request: "deal-manual-hold-office", provider: "manual", steps: ["sign", "pay"] },
  // PAID_HOLD: деньги в банке под защитой, мастер ещё не начал.
  { request: "deal-paid-wardrobe", provider: "mock", steps: ["sign", "pay"] },
  // PAID_HOLD + открытый спор: мастер не выходит на связь.
  {
    request: "deal-paid-dispute-bedroom",
    provider: "mock",
    steps: [
      "sign",
      "pay",
      {
        dispute: {
          by: "client",
          reason: "DEADLINE",
          description: "Мастер две недели не начинает работу и не отвечает в чате.",
          clientPosition: "Прошу вернуть деньги: сроки сорваны, договориться не получается.",
          executorPosition: "Задержали ткань для изголовья у поставщика, готовы начать на следующей неделе.",
        },
      },
    ],
  },
  // IN_PROGRESS с «Ходом работ».
  {
    request: "deal-progress-kitchen",
    provider: "mock",
    steps: [
      "sign",
      "pay",
      "start",
      { progress: { title: "Материалы закуплены", text: "Плиты, кромка и фурнитура Blum на складе цеха.", photos: ["kitchen-sage"] } },
      { progress: { title: "Корпуса собраны", text: "Корпуса нижних шкафов собраны, фасады ушли в покраску.", photos: ["kitchen-terracotta"] } },
    ],
  },
  // READY: работа сдана у адреса заказа, акт ждёт подписей.
  { request: "deal-ready-closet", provider: "mock", steps: ["sign", "pay", "start", { ready: { at: "address", photos: READY_PHOTOS.closet } }] },
  // READY: сдано вдали от адреса (предупреждение), покупатель подписал акт — ждём ЭЦП мастера.
  { request: "deal-ready-far-tv", provider: "mock", steps: ["sign", "pay", "start", { ready: { at: "far", photos: READY_PHOTOS.tv } }, "signActClient"] },
  // READY + открытый спор по качеству.
  { request: "deal-ready-dispute-kids", provider: "mock", steps: ["sign", "pay", "start", { ready: { at: "address", photos: READY_PHOTOS.kids } }, { dispute: KIDS_DISPUTE }] },
  // ACCEPTED на manual: акт подписан, выплата ждёт подтверждения оператора.
  {
    request: "deal-accepted-manual-kitchen",
    provider: "manual",
    steps: ["sign", "pay", "bank", "start", { ready: { at: "address", photos: READY_PHOTOS.kitchen } }, "signAct"],
  },
  // SPLIT_PAYOUT: обычная выплата (mock).
  { request: "deal-done-table", provider: "mock", steps: ["sign", "pay", "start", { ready: { at: "address", photos: READY_PHOTOS.table } }, "signAct"] },
  // SPLIT_PAYOUT на manual: все операции подтверждены банковскими документами.
  {
    request: "deal-done-manual-wardrobe",
    provider: "manual",
    steps: ["sign", "pay", "bank", "start", { ready: { at: "address", photos: READY_PHOTOS.wardrobe } }, "signAct", "bank"],
  },
  // SPLIT_PAYOUT по спору: раздел — мастеру часть, остаток — покупателю (REFUND).
  {
    request: "deal-split-office",
    provider: "mock",
    steps: [
      "sign",
      "pay",
      "start",
      { ready: { at: "address", photos: READY_PHOTOS.office } },
      {
        dispute: {
          by: "client",
          reason: "SCOPE",
          description: "Стеллаж не установлен: мастер сдал только стол и тумбу.",
          clientPosition: "Готов заплатить за стол и тумбу, стеллаж закажу у другого мастера.",
          executorPosition: "Стеллаж не встал из-за кривой стены; стол и тумба сделаны по оферте.",
        },
      },
      { resolve: { outcome: "PARTIAL_SPLIT", masterShareKzt: 300_000, rationale: "Стол и тумба сданы и приняты по фото, стеллаж не изготовлен: мастеру — 300 000 ₸ из 520 000 ₸." } },
    ],
  },
  // CANCELLED: покупатель отменил до оплаты.
  { request: "deal-cancelled-dresser", provider: "mock", steps: ["sign", { cancel: "client", reason: "Нашли готовый комод" }] },
  // REFUNDED: отмена после оплаты — деньги вернулись на карту.
  { request: "deal-refunded-hallway", provider: "mock", steps: ["sign", "pay", { cancel: "client", reason: "Переезжаем, прихожая не нужна" }] },
  // REFUNDED по спору на manual: полный возврат подтверждён оператором.
  {
    request: "deal-refund-dispute-wardrobe",
    provider: "manual",
    steps: [
      "sign",
      "pay",
      "bank",
      "start",
      {
        dispute: {
          by: "client",
          reason: "QUALITY",
          description: "Двери не закрываются, корпус перекошен.",
          clientPosition: "Прошу вернуть деньги и забрать шкаф.",
          executorPosition: "Согласен на возврат: переделать в срок не успеем.",
        },
      },
      { resolve: { outcome: "FULL_REFUND", rationale: "Обе стороны согласны на возврат; работа не принята." } },
      "bank",
    ],
  },
  // Мастер «Дала» в роли покупателя (ADR-004): завершённая сделка.
  { request: "deal-dual-role-wardrobe", provider: "mock", steps: ["sign", "pay", "start", { ready: { at: "address", photos: READY_PHOTOS.wardrobe } }, "signAct"] },
];

// ─── уведомления ─────────────────────────────────────────────────────────────

/** Уведомления до сделок (регистрация, отклики, замеры). Уведомления сделок и денег шлют сами сервисы (deals.ts). */
export type PersonRef = { client: ClientKey } | { executor: ExecutorKey } | { operator: true };

export type LinkRef = { to: "request" | "executorRequest"; request: string } | { to: "operatorExecutor"; executor: ExecutorKey };

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
  { user: { client: "aigerim" }, kind: "offer.received", title: "Новый отклик на заявку", body: "На заявку «Кухня» пришёл отклик: 1 020 000 ₸, срок 35 дней.", link: { to: "request", request: "tender-kitchen" }, daysAgo: 1.2 },
  { user: { client: "aigerim" }, kind: "measurement.no_deal", title: "Замер завершён без сделки", body: "По заявке «Мебель для ванной» сделка не состоялась. Плата за выезд — 10 000 ₸, оплачивается напрямую исполнителю. Заявка снова открыта для откликов.", link: { to: "request", request: "flow1-no-deal-bathroom" }, daysAgo: 15, read: true },
  { user: { client: "daniyar" }, kind: "measurement.scheduled", title: "Замер назначен", body: "Исполнитель приедет на замер по заявке «ТВ-зона» через 2 дня в 11:00.", link: { to: "request", request: "flow1-measuring-tv" }, daysAgo: 1.8 },
  { user: { client: "madina" }, kind: "offer.chosen", title: "Отклик выбран", body: "Адрес передан исполнителю по заявке «Шкаф». Договоритесь о замере в чате.", link: { to: "request", request: "flow1-chosen-wardrobe" }, daysAgo: 0.6 },
  { user: { executor: "erlan" }, kind: "request.new", title: "Новая заявка в вашем сегменте", body: "Кухня 3,4 м, сегмент «Комфорт», Астана.", link: { to: "executorRequest", request: "tender-kitchen" }, daysAgo: 3.2, read: true },
  { user: { executor: "dala" }, kind: "measurement.reminder", title: "Замер через 2 дня", body: "Заявка «ТВ-зона»: замер в 11:00. Если сделка не состоится, плата за выезд — 10 000 ₸.", link: { to: "executorRequest", request: "flow1-measuring-tv" }, daysAgo: 1.8 },
  { user: { executor: "asel" }, kind: "request.direct", title: "Заказчик хочет похожее", body: "Новая заявка по вашей работе «Обеденный стол из карагача».", link: { to: "executorRequest", request: "direct-table" }, daysAgo: 1 },
  { user: { executor: "timur" }, kind: "offer.accepted", title: "Ваш отклик выбран", body: "Адрес заказчика открыт. Договоритесь о замере в чате.", link: { to: "executorRequest", request: "flow1-chosen-wardrobe" }, daysAgo: 0.6 },
  { user: { executor: "samat" }, kind: "registration.approved", title: "Профиль подтверждён", body: "Вам присвоен сегмент «Эконом». Теперь вы видите заявки этого сегмента.", daysAgo: 28, read: true },
  { user: { executor: "almas" }, kind: "registration.received", title: "Заявка на регистрацию принята", body: "Оператор проверит данные в течение рабочего дня.", daysAgo: 1.5 },
  { user: { executor: "express" }, kind: "registration.rejected", title: "Регистрация отклонена", body: "Фотографии портфолио найдены на сторонних сайтах. Загрузите фото собственных работ и подайте заявку снова.", daysAgo: 12 },
  { user: { operator: true }, kind: "registration.pending", title: "Новая регистрация исполнителя", body: "Самозанятый, кухни и прихожие. Проверьте данные и присвойте сегмент.", link: { to: "operatorExecutor", executor: "almas" }, daysAgo: 1.5 },
];
