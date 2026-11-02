import { describe, expect, it } from "vitest";
import { plainText as rawText, type PdfSpec } from "../pdf/spec";
import { acceptanceActSpec, gpsLine } from "./acceptance-act";
import { contractSpec } from "./contract";
import { moneyStatementSpec } from "./money-statement";
import { releaseReceiptSpec } from "./release-receipt";
import { signatureSheetSpec } from "./signature-sheet";
import { subjectDetails } from "./subject";
import type { AcceptanceActData, ContractData, DealMoney, MoneyStatementData, ReleaseReceiptData, SignatureSheetData } from "./types";

// Суммы форматируются с неразрывными пробелами; в ожиданиях — обычные.
const plainText = (spec: PdfSpec) => rawText(spec).replace(/[  ]/g, " ");

/** X = 1 000 000 ₸: защита 20 000, итого 1 020 000, гарантия 40 000, выплата 960 000, доход 60 000. */
const MONEY: DealMoney = {
  priceTiyn: 100_000_000n,
  protectionTiyn: 2_000_000n,
  buyerTotalTiyn: 102_000_000n,
  guaranteeTiyn: 4_000_000n,
  payoutTiyn: 96_000_000n,
  platformIncomeTiyn: 6_000_000n,
};

const contract = (over: Partial<ContractData> = {}): ContractData => ({
  number: "Д-0014/2026",
  version: 1,
  issuedAt: new Date("2026-11-05T06:00:00Z"),
  city: "Астана",
  client: { fullName: "Сапарова Айгерим Болатовна", iin: "900101300123" },
  executor: { legalForm: "TOO", legalName: "ТОО «Ағаш Шебер»", binIin: "210140012345", signerFullName: "Тулегенов Бауыржан Серикович" },
  subject: { title: "Кухня угловая", details: ["Ширина: 320 см"], address: "ул. Кенесары, 40, кв. 12" },
  money: MONEY,
  durationDays: 30,
  warrantyMonths: 12,
  provider: "MANUAL",
  isDemo: false,
  ...over,
});

const act = (over: Partial<AcceptanceActData> = {}): AcceptanceActData => ({
  number: "А-0014",
  version: 1,
  issuedAt: new Date("2026-11-20T06:00:00Z"),
  city: "Астана",
  contractNumber: "Д-0014/2026",
  dealTitle: "Кухня угловая",
  clientName: "Сапарова Айгерим Болатовна",
  executorName: "ТОО «Ағаш Шебер»",
  money: MONEY,
  readyAt: new Date("2026-11-19T10:00:00Z"),
  photos: [{ image: null, sha256: "ab".repeat(32) }],
  gps: { distanceM: 120, withinRadius: true, radiusM: 500, accuracyM: 15 },
  executorHandSigns: false,
  isDemo: false,
  ...over,
});

const FORBIDDEN_FOR_PARTIES = /эскроу|комисси/i;

describe("оферта", () => {
  it("раскрывает стороны с ИИН/БИН и показывает деньги сделки терминами ТЗ", () => {
    const text = plainText(contractSpec(contract()));
    expect(text).toContain("Сапарова Айгерим Болатовна, ИИН 900101300123");
    expect(text).toContain("ТОО «Ағаш Шебер», БИН 210140012345, в лице директора Тулегенов Бауыржан Серикович");
    expect(text).toContain("1 000 000 ₸");
    expect(text).toContain("Защита сделки (2%)");
    expect(text).toContain("20 000 ₸");
    expect(text).toContain("Итого к оплате Покупателем");
    expect(text).toContain("1 020 000 ₸");
    expect(text).toContain("Гарантия оплаты и клиента (4%)");
    expect(text).toContain("К выплате Мастеру");
    expect(text).toContain("960 000 ₸");
    expect(text).not.toMatch(/комисси/i);
  });

  it("порядок денег: эскроу-счёт банка, платформа деньги не принимает; отмена до начала работ — полный возврат; спор", () => {
    const text = plainText(contractSpec(contract()));
    expect(text).toContain("резервируются на эскроу-счёте банка");
    expect(text).toContain("не принимает и не хранит денежные средства");
    expect(text).toMatch(/до начала работ Покупатель может отменить сделку: банк возвращает Покупателю всю оплаченную сумму/);
    expect(text).toMatch(/выплата заморожена/);
    expect(text).toMatch(/«Создана» → «Оплачена, деньги под защитой банка» → «В работе» → «Готово к приёмке» → «Принята» → «Выплачено»/);
    expect(text).toContain("12 месяцев");
  });

  it("пометка о юридической проверке — в колонтитуле; тестовая сделка помечена, реальная — нет", () => {
    const real = contractSpec(contract());
    expect(real.footer).toContain("Шаблон требует юридической проверки");
    expect(plainText(real)).not.toContain("Тестовая сделка");
    expect(plainText(contractSpec(contract({ provider: "MOCK" })))).toContain("Тестовая сделка");
    expect(plainText(contractSpec(contract({ isDemo: true })))).toContain("Тестовая сделка");
  });

  it("ИП и самозанятый — ИИН; покупатель без ИИН — только ФИО", () => {
    const ip = plainText(contractSpec(contract({ executor: { legalForm: "IP", legalName: "ИП Нурланов", binIin: "880101300111", signerFullName: null }, client: { fullName: "Иванов Иван", iin: null } })));
    expect(ip).toContain("ИП Нурланов (индивидуальный предприниматель), ИИН 880101300111");
    expect(ip).toContain("Иванов Иван, далее — «Покупатель»");
  });
});

describe("акт приёмки (макет стр. 18)", () => {
  it("работа, сумма, дата сдачи, фото с хэшем; реквизиты сторон не раскрываются", () => {
    const text = plainText(acceptanceActSpec(act()));
    expect(text).toContain("Кухня угловая");
    expect(text).toContain("1 000 000 ₸");
    expect(text).toContain("960 000 ₸");
    expect(text).toContain("Фото 1 (файл недоступен) · SHA-256 abababababababab");
    expect(text).toContain("Д-0014/2026");
    expect(text).not.toContain("210140012345");
    expect(text).not.toContain("900101300123");
    expect(text).not.toMatch(/комисси/i);
  });

  it("GPS: в радиусе, вне радиуса — предупреждение, без геолокации", () => {
    expect(gpsLine({ distanceM: 120, withinRadius: true, radiusM: 500, accuracyM: 15 })).toBe("Отметка геолокации сдачи: 120 м до адреса заказа, точность ±15 м — в радиусе 500 м.");
    expect(gpsLine({ distanceM: 1800, withinRadius: false, radiusM: 500, accuracyM: null })).toBe("Отметка геолокации сдачи: 1800 м до адреса заказа — вне радиуса 500 м — предупреждение.");
    expect(gpsLine(null)).toBe("Геолокация при сдаче не передана.");
  });

  it("собственноручная подпись мастера на акте — только при флаге", () => {
    const sigs = (d: AcceptanceActData) => acceptanceActSpec(d).blocks.find((b) => b.kind === "signatures");
    expect(JSON.stringify(sigs(act()))).toContain("\"caption\":\"ЭЦП — в листе подписей\"");
    expect(JSON.stringify(sigs(act({ executorHandSigns: true })))).not.toContain("\"caption\":\"ЭЦП — в листе подписей\"");
  });
});

describe("выписка по деньгам", () => {
  const statement = (over: Partial<MoneyStatementData> = {}): MoneyStatementData => ({
    number: "В-0014",
    version: 2,
    issuedAt: new Date("2026-11-21T06:00:00Z"),
    contractNumber: "Д-0014/2026",
    dealTitle: "Кухня угловая",
    money: MONEY,
    entries: [
      { type: "HOLD", status: "SUCCEEDED", amountTiyn: 102_000_000n, at: new Date("2026-11-06T06:00:00Z"), operationRef: "П-17", isTest: false },
      { type: "SPLIT_MASTER", status: "PENDING", amountTiyn: 96_000_000n, at: new Date("2026-11-21T05:00:00Z"), operationRef: null, isTest: false },
    ],
    bankBalanceTiyn: 102_000_000n,
    isDemo: false,
    ...over,
  });

  it("таймлайн операций журнала с суммами, статусом и номером; остаток в банке", () => {
    const text = plainText(moneyStatementSpec(statement()));
    expect(text).toContain("Деньги покупателя зарезервированы в банке");
    expect(text).toContain("1 020 000 ₸");
    expect(text).toContain("проведено, № П-17");
    expect(text).toContain("Выплачено мастеру");
    expect(text).toContain("ожидает подтверждения банка");
    expect(text).toContain("Остаток денег сделки в банке по проведённым операциям: 1 020 000 ₸.");
  });

  it("покупатель и мастер видят выписку: без «эскроу» и «комиссии»; пустой журнал — честная строка", () => {
    expect(plainText(moneyStatementSpec(statement()))).not.toMatch(FORBIDDEN_FOR_PARTIES);
    expect(plainText(moneyStatementSpec(statement({ entries: [] })))).toContain("Операций с деньгами пока не было.");
  });
});

describe("расписка на раскрытие (manual)", () => {
  const receipt = (over: Partial<ReleaseReceiptData> = {}): ReleaseReceiptData => ({
    number: "Р-0014",
    version: 1,
    issuedAt: new Date("2026-11-21T06:00:00Z"),
    city: "Астана",
    contractNumber: "Д-0014/2026",
    actNumber: "А-0014",
    actSha256: "cd".repeat(32),
    client: { fullName: "Сапарова Айгерим Болатовна", iin: "900101300123" },
    executor: { legalForm: "IP", legalName: "ИП Нурланов", binIin: "880101300111", signerFullName: null, iban: "KZ86125KZT5004100100" },
    money: MONEY,
    release: { masterTiyn: 96_000_000n, platformTiyn: 6_000_000n, refundTiyn: 0n },
    ...over,
  });

  it("крупная пометка «требует юридической проверки» в начале и в конце", () => {
    const spec = releaseReceiptSpec(receipt());
    const notices = spec.blocks.filter((b) => b.kind === "notice");
    expect(notices).toHaveLength(2);
    expect(spec.blocks[0].kind).toBe("notice");
    expect(spec.blocks.at(-1)?.kind).toBe("notice");
    expect(JSON.stringify(notices[0])).toContain("ШАБЛОН ТРЕБУЕТ ЮРИДИЧЕСКОЙ ПРОВЕРКИ");
  });

  it("суммы раскрытия, IBAN мастера и основание — акт с хэшем", () => {
    const text = plainText(releaseReceiptSpec(receipt()));
    expect(text).toContain("960 000 ₸");
    expect(text).toContain("60 000 ₸");
    expect(text).toContain("KZ86125KZT5004100100");
    expect(text).toContain(`акт приёмки № А-0014 к договору № Д-0014/2026 (SHA-256 подписанного файла: ${"cd".repeat(32)})`);
    expect(text).not.toContain("Возврат Покупателю");
    expect(plainText(releaseReceiptSpec(receipt({ release: { masterTiyn: 48_000_000n, platformTiyn: 3_000_000n, refundTiyn: 51_000_000n }, actNumber: null })))).toContain("Возврат Покупателю (депоненту)");
  });
});

describe("лист подписей", () => {
  const SHA = "ef".repeat(32);
  const sheet = (over: Partial<SignatureSheetData> = {}): SignatureSheetData => ({
    documentTitle: "Оферта № Д-0014/2026, версия 1",
    sha256: SHA,
    issuedAt: new Date("2026-11-06T06:00:00Z"),
    parties: [
      {
        party: "CLIENT",
        role: "Покупатель",
        name: "Сапарова Айгерим",
        hand: { image: null, typedName: "Сапарова Айгерим", signedAt: new Date("2026-11-06T05:00:00Z"), documentSha256: SHA },
        ecp: { method: "EGOV_QR", signedAt: new Date("2026-11-06T05:01:00Z"), signedSha256: SHA, certSubject: "САПАРОВА АЙГЕРИМ", certSerial: "4F01", certIinLast4: "0123" },
      },
      { party: "EXECUTOR", role: "Мастер", name: "ИП Нурланов", hand: null, ecp: null },
    ],
    ...over,
  });

  it("подписанный хэш, напечатанное имя, ЭЦП с маской ИИН; кто не подписал — «нет»", () => {
    const text = plainText(signatureSheetSpec(sheet()));
    expect(text).toContain(SHA);
    expect(text).toContain("Собственноручная подпись (напечатанное имя): Сапарова Айгерим");
    expect(text).toContain("сертификат № 4F01, владелец САПАРОВА АЙГЕРИМ, ИИН •••• 0123");
    expect(text).toContain("хэш совпадает с хэшем документа");
    expect(text).toContain("Собственноручная подпись: нет.");
    expect(text).toContain("ЭЦП: нет.");
    expect(text).not.toContain("900101300123");
  });
});

describe("параметры заказа из заявки", () => {
  it("переводит ключи каталога в названия и пропускает пустое", () => {
    expect(
      subjectDetails({
        furnitureType: "Кухня",
        style: "modern",
        details: { widthCm: 320, depthCm: 60, facade: "mdf_enamel", unknown: ["countertop"], color: "белый" },
        wishes: "  ",
      }),
    ).toEqual(["Тип мебели: Кухня", "Стиль: Современный", "Размеры: ширина 320 см, глубина 60 см", "Фасады: МДФ эмаль", "Цвет: белый"]);
  });

  it("неожиданный JSON не ломает оферту", () => {
    expect(subjectDetails({ furnitureType: null, style: null, details: { widthCm: "много" }, wishes: "Без ручек" })).toEqual(["Пожелания: Без ручек"]);
    expect(subjectDetails({ furnitureType: null, style: null, details: null, wishes: "" })).toEqual([]);
  });
});
