import { describe, expect, it } from "vitest";
import { costByBom, estimateOrder, productQuantity, typicalEstimateSchema, type MaterialPrice, type TypicalEstimate } from "./calculator";

const price = (name: string, category: MaterialPrice["category"], unit: MaterialPrice["unit"], priceKzt: number, segments: MaterialPrice["segments"]): MaterialPrice => ({
  name,
  category,
  unit,
  priceKzt,
  segments,
});

const BOOK: MaterialPrice[] = [
  price("ЛДСП эконом", "carcass", "m2", 4_000, ["ECONOMY"]),
  price("ЛДСП Egger", "carcass", "m2", 6_000, ["COMFORT", "PREMIUM"]),
  price("Фанера", "carcass", "m2", 9_000, ["PREMIUM"]),
  price("ЛДСП-фасад", "facade", "m2", 5_000, ["ECONOMY"]),
  price("МДФ эмаль", "facade", "m2", 30_000, ["COMFORT"]),
  price("Акрил", "facade", "m2", 20_000, ["COMFORT"]),
  price("Шпон", "facade", "m2", 60_000, ["PREMIUM"]),
  // Тот же материал в другой единице не подменяет строку расчёта в м².
  price("ЛДСП лист", "carcass", "sheet", 25_000, ["ECONOMY", "COMFORT", "PREMIUM"]),
];

describe("costByBom: стоимость материалов по уровням", () => {
  const cases: {
    name: string;
    bom: Parameters<typeof costByBom>[0];
    expected: Partial<Record<"ECONOMY" | "COMFORT" | "PREMIUM", { from: number; to: number; missing: number }>>;
  }[] = [
    {
      name: "одна позиция, один материал на уровень — вилка в одну точку",
      bom: [{ category: "facade", unit: "m2", quantity: 2 }],
      expected: { ECONOMY: { from: 10_000, to: 10_000, missing: 0 } },
    },
    {
      name: "несколько материалов уровня — вилка от самого дешёвого до самого дорогого",
      bom: [{ category: "facade", unit: "m2", quantity: 2 }],
      expected: { COMFORT: { from: 40_000, to: 60_000, missing: 0 } },
    },
    {
      name: "материал нескольких уровней входит в каждый из них",
      bom: [{ category: "carcass", unit: "m2", quantity: 3 }],
      expected: { COMFORT: { from: 18_000, to: 18_000, missing: 0 }, PREMIUM: { from: 18_000, to: 27_000, missing: 0 } },
    },
    {
      name: "позиции складываются",
      bom: [
        { category: "carcass", unit: "m2", quantity: 3 },
        { category: "facade", unit: "m2", quantity: 1.5 },
      ],
      expected: { ECONOMY: { from: 19_500, to: 19_500, missing: 0 }, PREMIUM: { from: 108_000, to: 117_000, missing: 0 } },
    },
    {
      name: "дробное количество округляется до целого тенге в каждой позиции",
      bom: [{ category: "carcass", unit: "m2", quantity: 0.33333 }],
      expected: { ECONOMY: { from: 1_333, to: 1_333, missing: 0 } },
    },
    {
      name: "нет материала нужной категории и единицы — позиция в «не хватает», сумма неполная",
      bom: [
        { category: "facade", unit: "m2", quantity: 1 },
        { category: "countertop", unit: "lm", quantity: 1 },
      ],
      expected: { ECONOMY: { from: 5_000, to: 5_000, missing: 1 } },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = costByBom(c.bom, BOOK);
      for (const [segment, want] of Object.entries(c.expected)) {
        const got = result[segment as keyof typeof result];
        expect({ from: got.from, to: got.to, missing: got.missing.length }, segment).toEqual(want);
      }
    });
  }

  it("разбивка по позициям: материалы, цены и суммы", () => {
    const { COMFORT } = costByBom([{ category: "facade", unit: "m2", quantity: 2 }], BOOK);
    expect(COMFORT.lines).toEqual([
      { category: "facade", unit: "m2", quantity: 2, materials: ["Акрил", "МДФ эмаль"], priceMin: 20_000, priceMax: 30_000, costMin: 40_000, costMax: 60_000 },
    ]);
  });

  it("пустой справочник — все позиции в «не хватает»", () => {
    const bom = [{ category: "facade", unit: "m2", quantity: 1 }] as const;
    const result = costByBom(bom, []);
    expect(result.PREMIUM).toEqual({ from: 0, to: 0, lines: [], missing: [...bom] });
  });
});

const KITCHEN: TypicalEstimate = {
  productUnit: "lm",
  typicalWidthCm: 300,
  typicalHeightCm: 220,
  markup: 2,
  perUnit: [
    { category: "carcass", unit: "m2", quantity: 3 },
    { category: "facade", unit: "m2", quantity: 1.5 },
  ],
};

const WARDROBE: TypicalEstimate = { ...KITCHEN, productUnit: "front_m2", typicalWidthCm: 200, typicalHeightCm: 250 };

describe("productQuantity: сколько единиц изделия", () => {
  const cases: { name: string; estimate: TypicalEstimate; size: Parameters<typeof productQuantity>[1]; expected: ReturnType<typeof productQuantity> }[] = [
    { name: "погонный метр — по ширине", estimate: KITCHEN, size: { widthCm: 420 }, expected: { quantity: 4.2, typicalSize: false } },
    { name: "погонный метр: высота не нужна", estimate: KITCHEN, size: { widthCm: 250, heightCm: null }, expected: { quantity: 2.5, typicalSize: false } },
    { name: "размер «не знаю» — типовая ширина", estimate: KITCHEN, size: {}, expected: { quantity: 3, typicalSize: true } },
    { name: "м² фасада — ширина × высота", estimate: WARDROBE, size: { widthCm: 180, heightCm: 240 }, expected: { quantity: 4.32, typicalSize: false } },
    { name: "м² фасада: нет высоты — типовая высота", estimate: WARDROBE, size: { widthCm: 180 }, expected: { quantity: 4.5, typicalSize: true } },
    { name: "м² фасада: ничего не известно — типовой размер", estimate: WARDROBE, size: { widthCm: null, heightCm: null }, expected: { quantity: 5, typicalSize: true } },
  ];
  for (const c of cases) {
    it(c.name, () => expect(productQuantity(c.estimate, c.size)).toEqual(c.expected));
  }
});

describe("estimateOrder: вилка заказа по типовому расчёту", () => {
  it("материалы × количество изделия × коэффициент; размер известен", () => {
    const result = estimateOrder(KITCHEN, { widthCm: 200 }, BOOK);
    // Эконом на 1 п. м: корпус 3 × 4 000 + фасад 1,5 × 5 000 = 19 500; × 2 п. м × 2.
    expect(result.ECONOMY).toMatchObject({ from: 78_000, to: 78_000, typicalSize: false, quantity: 2 });
    // Комфорт: корпус 18 000 + фасад 30 000…45 000 → 48 000…63 000 на 1 п. м.
    expect(result.COMFORT).toMatchObject({ from: 192_000, to: 252_000 });
  });

  it("размер неизвестен — по типовому, с пометкой", () => {
    const result = estimateOrder(KITCHEN, {}, BOOK);
    expect(result.ECONOMY).toMatchObject({ from: 117_000, to: 117_000, typicalSize: true, quantity: 3 });
  });

  it("уровень без нужного материала — вилки нет, остальные уровни считаются", () => {
    const noPremiumFacade = BOOK.filter((p) => p.name !== "Шпон");
    const result = estimateOrder(KITCHEN, { widthCm: 100 }, noPremiumFacade);
    expect(result.PREMIUM).toBeNull();
    expect(result.ECONOMY).not.toBeNull();
  });

  it("разбивка — на весь заказ, без коэффициента", () => {
    const result = estimateOrder(KITCHEN, { widthCm: 200 }, BOOK);
    expect(result.ECONOMY?.materials.lines.map((l) => [l.category, l.quantity, l.costMin])).toEqual([
      ["carcass", 6, 24_000],
      ["facade", 3, 15_000],
    ]);
  });
});

describe("typicalEstimateSchema: типовой расчёт из базы", () => {
  it("принимает строки с известными категориями и единицами", () => {
    expect(typicalEstimateSchema.parse(KITCHEN)).toEqual(KITCHEN);
  });

  it("отклоняет неизвестную категорию, нулевое количество и коэффициент меньше 1", () => {
    expect(typicalEstimateSchema.safeParse({ ...KITCHEN, perUnit: [{ category: "glass", unit: "m2", quantity: 1 }] }).success).toBe(false);
    expect(typicalEstimateSchema.safeParse({ ...KITCHEN, perUnit: [{ category: "facade", unit: "m2", quantity: 0 }] }).success).toBe(false);
    expect(typicalEstimateSchema.safeParse({ ...KITCHEN, markup: 0.5 }).success).toBe(false);
  });
});
