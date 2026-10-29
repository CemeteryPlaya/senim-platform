import type { PrismaClient } from "@/generated/prisma/client";
import type { DealStatus, StageStatus } from "@/generated/prisma/enums";
import { defaultStages, split, trancheFor } from "@/lib/deal/money";
import { hashDocument } from "@/lib/providers/signature";

const DAY = 86_400_000;
const at = (daysAgo: number, hour = 12) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setUTCHours(hour - 5, (daysAgo * 17) % 60, 0, 0); // часы по Астане (UTC+5)
  return d.getTime() > Date.now() ? new Date(Date.now() - 20 * 60_000) : d;
};

const users = [
  { id: "client-aigerim", role: "CLIENT", name: "Айгерим Сапарова", phone: "+7 701 555 12 34", iin: "940512450318", city: "Астана", avatar: "#C27A4A" },
  { id: "client-daniyar", role: "CLIENT", name: "Данияр Ахметов", phone: "+7 707 555 98 76", iin: "880217300542", city: "Алматы", avatar: "#5E7E95" },
  { id: "master-erlan", role: "MASTER", name: "Ерлан Жумабаев", phone: "+7 705 555 44 11", iin: "910803350217", city: "Астана", avatar: "#2F5D50" },
  { id: "master-agash", role: "MASTER", name: "ТОО «Ағаш Шебер»", phone: "+7 727 555 30 30", iin: "180640012345", city: "Алматы", avatar: "#8C6A4A" },
  { id: "master-ruslan", role: "MASTER", name: "Руслан Ким", phone: "+7 777 555 60 06", iin: "870921300811", city: "Алматы", avatar: "#7C8FA6" },
  { id: "master-timur", role: "MASTER", name: "Тимур Оспанов", phone: "+7 702 555 70 07", iin: "930114350664", city: "Астана", avatar: "#B8875A" },
  { id: "master-asel", role: "MASTER", name: "Асель Нурланова", phone: "+7 708 555 21 21", iin: "960730450129", city: "Шымкент", avatar: "#A2703F" },
  { id: "master-qazwood", role: "MASTER", name: "ТОО «Qazaq Wood»", phone: "+7 717 555 80 80", iin: "200340098765", city: "Астана", avatar: "#3A3633" },
  { id: "master-samat", role: "MASTER", name: "Самат Беков", phone: "+7 776 555 13 13", iin: "990402350990", city: "Караганда", avatar: "#E9B44C" },
  { id: "admin", role: "ADMIN", name: "Оператор платформы", phone: "+7 717 555 00 00", iin: "000000000000", city: "Астана", avatar: "#1F5145" },
] as const;

const reviews = (names: string[], texts: string[]) =>
  texts.map((text, i) => ({ author: names[i % names.length], text, rating: i === 2 ? 4 : 5 }));

const masters = [
  {
    userId: "master-erlan",
    displayName: "Ерлан Жумабаев",
    legalType: "SELF_EMPLOYED",
    specialties: ["Кухня", "Шкаф-купе", "Прихожая"],
    bio: "Делаю корпусную мебель 9 лет. Свой небольшой цех на левом берегу. Работаю с ЛДСП Egger и Kronospan, фурнитура Blum и Hettich. Замер и 3D-проект бесплатно.",
    rating: 4.9,
    reviewsCount: 41,
    completedDeals: 37,
    yearsExp: 9,
    priceFrom: 180_000,
    responseTime: "отвечает в течение часа",
    verified: true,
    portfolio: [
      { title: "Кухня в новостройке, 3,4 м", image: "/img/kitchen.svg" },
      { title: "Шкаф-купе с зеркалом", image: "/img/wardrobe.svg" },
      { title: "Прихожая с банкеткой", image: "/img/hallway.svg" },
    ],
    reviews: reviews(["Мадина К.", "Арман Т.", "Ольга С."], [
      "Кухню сделали за 4 недели, как договаривались. Фотоотчёты по каждому этапу — очень удобно, я не ездила в цех.",
      "Аккуратный монтаж, убрали за собой. Деньги через платформу — спокойно для обеих сторон.",
      "Немного сдвинули срок из-за фасадов, но предупредили заранее. Качеством довольны.",
    ]),
  },
  {
    userId: "master-agash",
    displayName: "ТОО «Ағаш Шебер»",
    legalType: "TOO",
    specialties: ["Кухня", "Гардеробная", "Мебель из массива"],
    bio: "Мебельная фабрика полного цикла в Алматы: собственное производство 1 200 м², станки с ЧПУ, 3 бригады монтажников. Гарантия 2 года.",
    rating: 4.8,
    reviewsCount: 126,
    completedDeals: 214,
    yearsExp: 12,
    priceFrom: 450_000,
    responseTime: "отвечает в течение 30 минут",
    verified: true,
    portfolio: [
      { title: "Кухня с островом из массива дуба", image: "/img/kitchen.svg" },
      { title: "Гардеробная под потолок", image: "/img/closet.svg" },
      { title: "Обеденная группа из карагача", image: "/img/table.svg" },
    ],
    reviews: reviews(["Данияр А.", "Сауле М.", "Игорь П."], [
      "Сделали кухню с островом, всё по проекту. Порадовало, что оплата шла траншами по этапам.",
      "Большая гардеробная, монтаж за один день. Рекомендую.",
      "Хорошее качество, но менеджер иногда долго отвечал.",
    ]),
  },
  {
    userId: "master-ruslan",
    displayName: "ИП Ким Р.",
    legalType: "IP",
    specialties: ["Детская", "Шкаф-купе", "Офисная мебель"],
    bio: "Детская и корпусная мебель. Безопасные материалы класса E0.5, закруглённые кромки, мягкие доводчики.",
    rating: 4.6,
    reviewsCount: 23,
    completedDeals: 29,
    yearsExp: 6,
    priceFrom: 150_000,
    responseTime: "отвечает в течение 2 часов",
    verified: true,
    portfolio: [
      { title: "Детская для двоих", image: "/img/kids.svg" },
      { title: "Кабинет со стеллажом", image: "/img/office.svg" },
    ],
    reviews: reviews(["Жанна Б.", "Ерболат Н."], ["Детская получилась яркой и крепкой.", "Сделал рабочий кабинет, всё ровно."]),
  },
  {
    userId: "master-timur",
    displayName: "Тимур Оспанов",
    legalType: "SELF_EMPLOYED",
    specialties: ["Шкаф-купе", "Гардеробная", "Прихожая"],
    bio: "Шкафы-купе и гардеробные системы. Профиль Aristo, зеркала с пескоструйным рисунком.",
    rating: 4.7,
    reviewsCount: 18,
    completedDeals: 22,
    yearsExp: 5,
    priceFrom: 120_000,
    responseTime: "отвечает в течение часа",
    verified: true,
    portfolio: [
      { title: "Шкаф-купе 2,8 м", image: "/img/wardrobe.svg" },
      { title: "Гардеробная в спальне", image: "/img/closet.svg" },
    ],
    reviews: reviews(["Алия Р.", "Максат Д."], ["Быстро и недорого.", "Шкаф стоит как влитой, двери катаются бесшумно."]),
  },
  {
    userId: "master-asel",
    displayName: "Асель Нурланова",
    legalType: "SELF_EMPLOYED",
    specialties: ["Мебель из массива", "Ванная"],
    bio: "Столярная мастерская: столы, консоли и тумбы для ванной из массива карагача и ореха. Масло-воск, ручная работа.",
    rating: 5.0,
    reviewsCount: 12,
    completedDeals: 14,
    yearsExp: 4,
    priceFrom: 90_000,
    responseTime: "отвечает в течение 3 часов",
    verified: true,
    portfolio: [
      { title: "Обеденный стол из карагача", image: "/img/table.svg" },
      { title: "Тумба под раковину", image: "/img/bathroom.svg" },
    ],
    reviews: reviews(["Гульнара Ш."], ["Стол — произведение искусства."]),
  },
  {
    userId: "master-qazwood",
    displayName: "ТОО «Qazaq Wood»",
    legalType: "TOO",
    specialties: ["Офисная мебель", "Кухня", "Шкаф-купе"],
    bio: "Корпоративная и жилая мебель под заказ. Работаем с юрлицами и физлицами, НДС.",
    rating: 4.5,
    reviewsCount: 57,
    completedDeals: 88,
    yearsExp: 8,
    priceFrom: 300_000,
    responseTime: "отвечает в течение дня",
    verified: true,
    portfolio: [
      { title: "Open space на 40 мест", image: "/img/office.svg" },
      { title: "Кухня для шоурума", image: "/img/kitchen.svg" },
    ],
    reviews: reviews(["ТОО «Nomad Tech»"], ["Обставили офис за 3 недели."]),
  },
  {
    userId: "master-samat",
    displayName: "Самат Беков",
    legalType: "SELF_EMPLOYED",
    specialties: ["Прихожая", "Шкаф-купе"],
    bio: "Начинающий мастер, работаю аккуратно и недорого. Сборка и установка мебели.",
    rating: 0,
    reviewsCount: 0,
    completedDeals: 0,
    yearsExp: 2,
    priceFrom: 80_000,
    responseTime: "новый мастер",
    verified: false,
    portfolio: [{ title: "Прихожая", image: "/img/hallway.svg" }],
    reviews: [],
  },
] as const;

type StagePlan = { status: StageStatus; report?: string; photos?: string[]; clientNote?: string; day?: number };

type DealPlan = {
  title: string;
  furnitureType: string;
  description: string;
  specs: { dimensions: string; materials: string; color: string };
  address: string;
  amount: number;
  advance: number;
  clientId: string;
  masterId: string;
  status: DealStatus;
  awaitingParty?: "CLIENT" | "MASTER";
  createdDaysAgo: number;
  deadlineInDays: number;
  signedBy?: ("CLIENT" | "MASTER")[];
  stages?: StagePlan[];
  dispute?: string;
  events: [number, number, string, string | null, string?, string?][]; // [daysAgo, hour, text, actorId|null, icon, image]
};

const STAGE_PHOTOS = ["/img/measure.svg", "/img/materials.svg", "/img/workshop.svg", "/img/install.svg"];

const deals: DealPlan[] = [
  {
    title: "Кухня с островом",
    furnitureType: "Кухня",
    description: "Угловая кухня с островом и барной стойкой, встроенная техника, фасады из массива дуба.",
    specs: { dimensions: "3,6 × 2,4 м + остров 1,8 м", materials: "Массив дуба, кварцевая столешница, Blum", color: "Натуральный дуб, столешница белый мрамор" },
    address: "Алматы, мкр. Самал-2, д. 58, кв. 14",
    amount: 1_250_000,
    advance: 40,
    clientId: "client-daniyar",
    masterId: "master-agash",
    status: "COMPLETED",
    createdDaysAgo: 46,
    deadlineInDays: -8,
    signedBy: ["CLIENT", "MASTER"],
    stages: [
      { status: "APPROVED", report: "Замер выполнен, 3D-проект согласован.", day: 44 },
      { status: "APPROVED", report: "Закуплен массив дуба и фурнитура Blum, чеки прикреплены.", day: 38 },
      { status: "APPROVED", report: "Корпуса и фасады готовы, покраска завершена.", day: 20 },
      { status: "APPROVED", report: "Кухня установлена, техника подключена.", day: 10 },
    ],
    events: [
      [46, 10, "Данияр Ахметов предлагает сделку на 1 250 000 ₸", "client-daniyar", "file"],
      [45, 15, "ТОО «Ағаш Шебер» принял(а) условия. Сформирован договор подряда", "master-agash", "check"],
      [45, 18, "Договор подписан обеими сторонами. Открыт эскроу-счёт", null, "bank"],
      [44, 11, "1 250 000 ₸ заморожены на эскроу-счёте. Мастер может приступать к работе", "client-daniyar", "lock"],
      [10, 19, "Сделка завершена. Мастеру перечислено 705 000 ₸, комиссия оператора 45 000 ₸", null, "coins"],
    ],
  },
  {
    title: "Шкаф-купе в спальню",
    furnitureType: "Шкаф-купе",
    description: "Встроенный шкаф-купе на всю стену, три двери, одна — зеркальная.",
    specs: { dimensions: "2,8 × 2,6 × 0,6 м", materials: "ЛДСП Egger 16 мм, профиль Aristo", color: "Дуб Галифакс, зеркало серебро" },
    address: "Астана, ул. Кабанбай батыра, 11, кв. 87",
    amount: 380_000,
    advance: 30,
    clientId: "client-aigerim",
    masterId: "master-timur",
    status: "COMPLETED",
    createdDaysAgo: 31,
    deadlineInDays: -12,
    signedBy: ["CLIENT", "MASTER"],
    stages: [
      { status: "APPROVED", report: "Замер выполнен.", day: 30 },
      { status: "APPROVED", report: "Материалы закуплены.", day: 27 },
      { status: "APPROVED", report: "Корпус и двери изготовлены.", day: 20 },
      { status: "APPROVED", report: "Шкаф установлен.", day: 16 },
    ],
    events: [
      [31, 12, "Айгерим Сапарова предлагает сделку на 380 000 ₸", "client-aigerim", "file"],
      [30, 9, "380 000 ₸ заморожены на эскроу-счёте. Мастер может приступать к работе", "client-aigerim", "lock"],
      [16, 18, "Сделка завершена. Мастеру перечислено 250 040 ₸, комиссия оператора 15 960 ₸", null, "coins"],
    ],
  },
  {
    title: "Детская комната",
    furnitureType: "Детская",
    description: "Двухъярусная кровать с ящиками, шкаф и письменный стол для двоих детей.",
    specs: { dimensions: "Комната 3,2 × 3,8 м", materials: "ЛДСП E0.5, кромка ПВХ 2 мм", color: "Белый + голубые и жёлтые фасады" },
    address: "Алматы, ул. Розыбакиева, 247, кв. 33",
    amount: 690_000,
    advance: 40,
    clientId: "client-daniyar",
    masterId: "master-ruslan",
    status: "DISPUTE",
    createdDaysAgo: 24,
    deadlineInDays: 4,
    signedBy: ["CLIENT", "MASTER"],
    stages: [
      { status: "APPROVED", report: "Замер и проект согласованы.", day: 22 },
      { status: "APPROVED", report: "Материалы закуплены, фото и чеки прикреплены.", day: 19 },
      { status: "SUBMITTED", report: "Корпуса изготовлены, готовы к доставке.", day: 3 },
      { status: "PENDING" },
    ],
    dispute: "Цвет фасадов не совпадает с согласованным проектом (жёлтый вместо голубого), на двух деталях отклеивается кромка.",
    events: [
      [24, 10, "Данияр Ахметов предлагает сделку на 690 000 ₸", "client-daniyar", "file"],
      [22, 14, "690 000 ₸ заморожены на эскроу-счёте. Мастер может приступать к работе", "client-daniyar", "lock"],
      [19, 16, "Мастеру перечислено 259 440 ₸ за этап «Закупка материалов» (комиссия 16 560 ₸)", null, "coins"],
      [3, 17, "Руслан Ким сдал(а) этап «Изготовление в цеху» и ждёт подтверждения", "master-ruslan", "upload", "/img/workshop.svg"],
      [2, 11, "Данияр Ахметов открыл(а) спор. Средства остаются замороженными до решения оператора", "client-daniyar", "alert"],
    ],
  },
  {
    title: "Кухонный гарнитур 3,2 м",
    furnitureType: "Кухня",
    description: "Прямая кухня под потолок: верхние шкафы в два ряда, встроенный холодильник и посудомойка, подсветка рабочей зоны.",
    specs: { dimensions: "3,2 × 2,7 м", materials: "ЛДСП Egger, фасады МДФ эмаль, фурнитура Blum", color: "Зелёный шалфей + дуб" },
    address: "Астана, пр. Мангилик Ел, 37, кв. 112",
    amount: 850_000,
    advance: 40,
    clientId: "client-aigerim",
    masterId: "master-erlan",
    status: "IN_PROGRESS",
    createdDaysAgo: 9,
    deadlineInDays: 21,
    signedBy: ["CLIENT", "MASTER"],
    stages: [
      { status: "APPROVED", report: "Замер сделан, 3D-проект согласовали по видеосвязи.", day: 7 },
      {
        status: "SUBMITTED",
        report: "Закупил ЛДСП Egger (12 листов), фасады МДФ заказаны в покраску, фурнитура Blum на складе. Чеки на фото.",
        photos: ["/img/materials.svg"],
        day: 0,
      },
      { status: "PENDING" },
      { status: "PENDING" },
    ],
    events: [
      [9, 10, "Айгерим Сапарова предлагает сделку на 800 000 ₸", "client-aigerim", "file"],
      [9, 13, "Ерлан Жумабаев предлагает изменить условия: сумма 800 000 ₸ → 850 000 ₸", "master-erlan", "edit"],
      [9, 13, "Добрый день! Фасады в эмали дороже плёночных на ~50 тыс. Зато не выгорают и легко моются. Если ок — подтверждайте 🙂", "master-erlan"],
      [9, 15, "Айгерим Сапарова принял(а) условия. Сформирован договор подряда", "client-aigerim", "check"],
      [8, 10, "Айгерим Сапарова подписал(а) договор ЭЦП НУЦ РК через eGov Mobile", "client-aigerim", "pen"],
      [8, 12, "Ерлан Жумабаев подписал(а) договор ЭЦП НУЦ РК через NCALayer", "master-erlan", "pen"],
      [8, 12, "Договор подписан обеими сторонами. Открыт эскроу-счёт", null, "bank"],
      [8, 16, "850 000 ₸ заморожены на эскроу-счёте. Мастер может приступать к работе", "client-aigerim", "lock"],
      [7, 18, "Ерлан Жумабаев сдал(а) этап «Замер и проект» и ждёт подтверждения", "master-erlan", "upload", "/img/measure.svg"],
      [7, 20, "Айгерим Сапарова подтвердил(а) этап «Замер и проект»", "client-aigerim", "check"],
      [0, 9, "Ерлан Жумабаев сдал(а) этап «Закупка материалов» и ждёт подтверждения", "master-erlan", "upload", "/img/materials.svg"],
      [0, 9, "Закупил ЛДСП Egger (12 листов), фасады МДФ заказаны в покраску, фурнитура Blum на складе. Чеки на фото.", "master-erlan"],
    ],
  },
  {
    title: "Прихожая с банкеткой",
    furnitureType: "Прихожая",
    description: "Прихожая: шкаф для верхней одежды, открытая вешалка с банкеткой, зеркало.",
    specs: { dimensions: "2,2 × 2,4 м", materials: "ЛДСП Kronospan, мягкая банкетка", color: "Графит + дуб сонома" },
    address: "Алматы, ул. Жандосова, 98, кв. 5",
    amount: 260_000,
    advance: 30,
    clientId: "client-daniyar",
    masterId: "master-erlan",
    status: "AWAITING_SIGNATURES",
    createdDaysAgo: 2,
    deadlineInDays: 18,
    signedBy: ["MASTER"],
    events: [
      [2, 11, "Данияр Ахметов предлагает сделку на 260 000 ₸", "client-daniyar", "file"],
      [1, 10, "Ерлан Жумабаев принял(а) условия. Сформирован договор подряда", "master-erlan", "check"],
      [1, 10, "Ерлан Жумабаев подписал(а) договор ЭЦП НУЦ РК через NCALayer", "master-erlan", "pen"],
    ],
  },
  {
    title: "Шкаф-купе в прихожую",
    furnitureType: "Шкаф-купе",
    description: "Шкаф-купе в нишу, две двери с зеркалами, внутри штанга и полки под обувь.",
    specs: { dimensions: "1,8 × 2,5 × 0,6 м", materials: "ЛДСП Egger, профиль Aristo", color: "Белый, зеркало графит" },
    address: "Астана, ул. Сыганак, 25, кв. 140",
    amount: 210_000,
    advance: 30,
    clientId: "client-aigerim",
    masterId: "master-timur",
    status: "PROPOSED",
    awaitingParty: "MASTER",
    createdDaysAgo: 0,
    deadlineInDays: 20,
    events: [[0, 8, "Айгерим Сапарова предлагает сделку на 210 000 ₸", "client-aigerim", "file"]],
  },
];

export async function seedDatabase(db: PrismaClient) {
  await db.$executeRawUnsafe(
    `TRUNCATE "Dispute", "DealEvent", "Transaction", "EscrowAccount", "Signature", "Stage", "Deal", "MasterProfile", "User" RESTART IDENTITY CASCADE`,
  );

  await db.user.createMany({ data: users.map((u) => ({ ...u })) });
  await db.masterProfile.createMany({
    data: masters.map((m) => ({
      ...m,
      specialties: [...m.specialties],
      portfolio: m.portfolio.map((p) => ({ ...p })),
      reviews: m.reviews.map((r) => ({ ...r })),
    })),
  });

  const userById = Object.fromEntries(users.map((u) => [u.id, u]));

  for (const plan of deals) {
    const created = at(plan.createdDaysAgo, 10);
    const advanced = !["PROPOSED"].includes(plan.status);
    const funded = ["IN_PROGRESS", "DISPUTE", "COMPLETED", "REFUNDED"].includes(plan.status);
    const closed = ["COMPLETED", "REFUNDED"].includes(plan.status);
    const stageTemplate = defaultStages(plan.advance);

    const deal = await db.deal.create({
      data: {
        title: plan.title,
        furnitureType: plan.furnitureType,
        description: plan.description,
        specs: plan.specs,
        address: plan.address,
        amount: plan.amount,
        deadline: new Date(Date.now() + plan.deadlineInDays * DAY),
        status: plan.status,
        awaitingParty: plan.awaitingParty ?? null,
        revision: plan.title.startsWith("Кухонный") ? 2 : 1,
        clientId: plan.clientId,
        masterId: plan.masterId,
        createdAt: created,
        signedAt: funded ? at(plan.createdDaysAgo - 1, 12) : null,
        fundedAt: funded ? at(plan.createdDaysAgo - 1, 16) : null,
        closedAt: closed ? at(plan.stages?.at(-1)?.day ?? 0, 19) : null,
        stages: {
          create: stageTemplate.map((s, i) => {
            const p = plan.stages?.[i];
            const status = p?.status ?? "PENDING";
            const photos = p?.photos ?? (status === "APPROVED" || status === "SUBMITTED" ? [STAGE_PHOTOS[i]] : []);
            return {
              ...s,
              order: i + 1,
              status,
              report: p?.report,
              photos,
              startedAt: status !== "PENDING" ? at((p?.day ?? 0) + 2, 9) : null,
              submittedAt: status === "SUBMITTED" || status === "APPROVED" ? at(p?.day ?? 0, 9) : null,
              approvedAt: status === "APPROVED" ? at(p?.day ?? 0, 20) : null,
            };
          }),
        },
      },
      include: { stages: true },
    });

    const contractNo = advanced ? `SD-${String(deal.number).padStart(4, "0")}/${created.getFullYear()}` : null;
    if (contractNo) await db.deal.update({ where: { id: deal.id }, data: { contractNo } });

    for (const party of plan.signedBy ?? []) {
      const u = userById[party === "CLIENT" ? plan.clientId : plan.masterId];
      await db.signature.create({
        data: {
          dealId: deal.id,
          userId: u.id,
          party,
          method: party === "CLIENT" ? "EGOV_QR" : "NCALAYER",
          signerName: u.name,
          iin: u.iin,
          certSerial: hashDocument(u.id + deal.id).slice(0, 20).toUpperCase(),
          docHash: hashDocument(`${deal.id}:${deal.revision}`),
          revision: deal.revision,
          signedAt: at(plan.createdDaysAgo - 1, party === "CLIENT" ? 10 : 12),
        },
      });
    }

    if (plan.signedBy?.length === 2) {
      let released = 0;
      const txs: { type: "DEPOSIT" | "RELEASE" | "COMMISSION"; amount: number; note: string; createdAt: Date }[] = [];
      if (funded) txs.push({ type: "DEPOSIT", amount: plan.amount, note: "Пополнение эскроу заказчиком", createdAt: at(plan.createdDaysAgo - 1, 16) });
      const approved = deal.stages.filter((s) => s.status === "APPROVED").sort((a, b) => a.order - b.order);
      for (const stage of approved) {
        const isLast = stage.order === deal.stages.length;
        const gross = isLast ? plan.amount - released : trancheFor(plan.amount, stage.payoutPercent);
        if (gross <= 0) continue;
        released += gross;
        const { commission, net } = split(gross);
        const when = stage.approvedAt ?? created;
        txs.push({ type: "RELEASE", amount: net, note: `Выплата за этап «${stage.title}»`, createdAt: when });
        txs.push({ type: "COMMISSION", amount: commission, note: "Комиссия оператора 6%", createdAt: when });
      }
      await db.escrowAccount.create({
        data: {
          dealId: deal.id,
          bank: "Банк-партнёр (демо)",
          iban: `KZ86 125K ZT50 04${String(deal.number).padStart(6, "0").slice(0, 2)} ${String(deal.number).padStart(6, "0").slice(2)}0000`,
          status: !funded ? "OPEN" : closed ? "CLOSED" : released > 0 ? "PARTIALLY_RELEASED" : "FUNDED",
          funded: funded ? plan.amount : 0,
          released,
          createdAt: at(plan.createdDaysAgo - 1, 12),
        },
      });
      if (txs.length) await db.transaction.createMany({ data: txs.map((t) => ({ ...t, dealId: deal.id })) });
    }

    await db.dealEvent.createMany({
      data: plan.events.map(([daysAgo, hour, text, actorId, icon, image]) => ({
        dealId: deal.id,
        kind: icon ? "SYSTEM" : "MESSAGE",
        actorId,
        text,
        icon: icon ?? null,
        image: image ?? null,
        createdAt: at(daysAgo, hour),
      })),
    });

    if (plan.dispute) {
      const stage = deal.stages.find((s) => s.status === "SUBMITTED");
      await db.dispute.create({
        data: { dealId: deal.id, stageId: stage?.id, openedById: plan.clientId, reason: plan.dispute, createdAt: at(2, 11) },
      });
      await db.dealEvent.create({
        data: { dealId: deal.id, kind: "MESSAGE", actorId: plan.clientId, text: plan.dispute, createdAt: at(2, 11) },
      });
    }
  }
}
