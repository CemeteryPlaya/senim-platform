import { describe, expect, it } from "vitest";
import { plainText as rawText, type PdfSpec } from "../pdf/spec";
import { contractSpec } from "./contract";
import { stageActSpec } from "./stage-act";
import { subjectDetails } from "./subject";
import type { ContractData, StageActData } from "./types";

// Суммы форматируются с неразрывными пробелами; в ожиданиях — обычные.
const plainText = (spec: PdfSpec) => rawText(spec).replace(/ /g, " ");

const contract = (over: Partial<ContractData> = {}): ContractData => ({
  number: "Д-0014/2026",
  version: 1,
  issuedAt: new Date("2026-10-30T06:00:00Z"),
  city: "Астана",
  paymentMode: "MANUAL",
  client: { fullName: "Сапарова Айгерим Болатовна", iin: "900101300123" },
  executor: { legalForm: "TOO", legalName: "ТОО «Ағаш Шебер»", binIin: "210140012345", signerFullName: "Тулегенов Бауыржан Серикович" },
  subject: { title: "Кухня угловая", details: ["Ширина: 320 см", "Фасады: МДФ, эмаль"], address: "ул. Кенесары, 40, кв. 12" },
  totalAmount: 1_250_000,
  stages: [
    { order: 1, title: "Аванс и материалы", description: "Закупка материалов", amount: 625_000, paymentDue: "ON_START" },
    { order: 2, title: "Изготовление и монтаж", description: "", amount: 625_000, paymentDue: "ON_ACCEPTANCE" },
  ],
  durationDays: 30,
  warrantyMonths: 12,
  autoAcceptDays: 5,
  ...over,
});

const act = (over: Partial<StageActData> = {}): StageActData => ({
  number: "А-0014-2",
  issuedAt: new Date("2026-11-20T06:00:00Z"),
  city: "Астана",
  paymentMode: "MANUAL",
  contractNumber: "Д-0014/2026",
  dealTitle: "Кухня угловая",
  stage: { order: 2, title: "Изготовление и монтаж", description: "Монтаж на объекте", amount: 625_000, paymentDue: "ON_ACCEPTANCE" },
  acceptedAt: new Date("2026-11-19T10:00:00Z"),
  acceptedAutomatically: false,
  autoAcceptDays: 5,
  ...over,
});

describe("договор подряда", () => {
  it("раскрывает исполнителя: наименование и БИН, заказчика — ФИО и ИИН", () => {
    const text = plainText(contractSpec(contract()));
    expect(text).toContain("ТОО «Ағаш Шебер»");
    expect(text).toContain("БИН 210140012345");
    expect(text).toContain("Сапарова Айгерим Болатовна");
    expect(text).toContain("ИИН 900101300123");
  });

  it("ТОО — в лице директора (ФИО подписанта из профиля), действующего на основании Устава", () => {
    const text = plainText(contractSpec(contract()));
    expect(text).toContain("ТОО «Ағаш Шебер», БИН 210140012345, в лице директора Тулегенов Бауыржан Серикович, действующего на основании Устава");
  });

  it("ИП и самозанятый — без «в лице»: сторона и есть подписант", () => {
    const ip = plainText(contractSpec(contract({ executor: { legalForm: "IP", legalName: "ИП «Дала»", binIin: "850505300111", signerFullName: "Жумабаев Ерлан" } })));
    expect(ip).toContain("ИП «Дала» (индивидуальный предприниматель), ИИН 850505300111");
    expect(ip).not.toContain("в лице");
  });

  it("для ИП и самозанятого пишет ИИН, а не БИН", () => {
    const text = plainText(contractSpec(contract({ executor: { legalForm: "SELF_EMPLOYED", legalName: "Жумабаев Ерлан Серикович", binIin: "850505300111", signerFullName: "Жумабаев Ерлан Серикович" } })));
    expect(text).toContain("Жумабаев Ерлан Серикович");
    expect(text).toContain("ИИН 850505300111");
    expect(text).not.toContain("БИН");
  });

  it("содержит предмет из заявки, цену и этапы с суммами и моментом оплаты", () => {
    const text = plainText(contractSpec(contract()));
    expect(text).toContain("Кухня угловая");
    expect(text).toContain("Фасады: МДФ, эмаль");
    expect(text).toContain("ул. Кенесары, 40, кв. 12");
    expect(text).toContain("1 250 000 ₸");
    expect(text).toContain("625 000 ₸");
    expect(text).toContain("Аванс и материалы");
    expect(text).toMatch(/до начала этапа/);
    expect(text).toMatch(/после приёмки этапа/);
  });

  it("описывает приёмку и автоприёмку через заданное число дней", () => {
    const text = plainText(contractSpec(contract({ autoAcceptDays: 7 })));
    expect(text).toMatch(/7 календарных дней/);
    expect(text).toMatch(/считается принятым/);
  });

  it("manual: оплата напрямую исполнителю, без слов «эскроу» и «безопасная оплата»", () => {
    const text = plainText(contractSpec(contract({ paymentMode: "MANUAL" })));
    expect(text).toMatch(/напрямую Исполнителю/);
    expect(text.toLowerCase()).not.toContain("эскроу");
    expect(text.toLowerCase()).not.toContain("безопасн");
    expect(text).toMatch(/Платформа «Сенім» не принимает и не хранит денежные средства/);
  });

  it("эскроу: оплата через счёт банка; симулятор честно помечен", () => {
    const bank = plainText(contractSpec(contract({ paymentMode: "BANK" })));
    expect(bank).toMatch(/эскроу-счёт в банке/);
    expect(bank).not.toMatch(/напрямую Исполнителю/);
    expect(bank).not.toMatch(/симулятор/i);
    const sim = plainText(contractSpec(contract({ paymentMode: "ESCROW_SIMULATOR" })));
    expect(sim).toMatch(/эскроу-счёт в банке/);
    expect(sim).toMatch(/симулятор банка/i);
  });

  it("помечает версию и редакцию шаблона до юридической проверки", () => {
    const spec = contractSpec(contract({ version: 3 }));
    expect(plainText(spec)).toMatch(/версия 3/);
    expect(spec.footer).toMatch(/до юридической проверки/);
  });

  it("не содержит телефонов", () => {
    expect(plainText(contractSpec(contract()))).not.toMatch(/\+7|телефон/i);
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

  it("неожиданный JSON не ломает договор", () => {
    expect(subjectDetails({ furnitureType: null, style: null, details: { widthCm: "много" }, wishes: "Без ручек" })).toEqual(["Пожелания: Без ручек"]);
    expect(subjectDetails({ furnitureType: null, style: null, details: null, wishes: "" })).toEqual([]);
  });
});

describe("акт этапа", () => {
  it("ссылается на договор и не раскрывает исполнителя", () => {
    const text = plainText(stageActSpec(act()));
    expect(text).toContain("А-0014-2");
    expect(text).toContain("Д-0014/2026");
    expect(text).toContain("Изготовление и монтаж");
    expect(text).toContain("625 000 ₸");
    expect(text).not.toContain("Ағаш");
  });

  it("отличает приёмку заказчиком от автоприёмки", () => {
    expect(plainText(stageActSpec(act()))).toMatch(/принят Заказчиком/);
    expect(plainText(stageActSpec(act({ acceptedAutomatically: true })))).toMatch(/автоматически/);
  });

  it("оплата по режиму: manual — напрямую, эскроу — банком", () => {
    const manual = plainText(stageActSpec(act()));
    expect(manual).toMatch(/напрямую Исполнителю/);
    expect(manual.toLowerCase()).not.toContain("эскроу");
    expect(plainText(stageActSpec(act({ paymentMode: "BANK" })))).toMatch(/с эскроу-счёта/);
  });

  it("этап без суммы — без строки об оплате", () => {
    const text = plainText(stageActSpec(act({ stage: { ...act().stage, amount: 0 } })));
    expect(text).toMatch(/без оплаты/);
  });
});
