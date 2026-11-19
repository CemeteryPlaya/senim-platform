import { describe, expect, it } from "vitest";
import { parseEnums, parseSchema } from "./schema-parse";

const SOURCE = `
// Комментарий файла
generator client {
  provider = "prisma-client"
}

/// Статус
enum DealStatus {
  CREATED // создана
  PAID_HOLD
  @@map("deal_status")
}

model User {
  id String @id @default(cuid())
}

/// Документация модели
model Deal {
  id        String     @id @default(cuid()) // ключ
  /// Документация поля
  note      String?
  title     String     @default("a // не комментарий")
  tags      String[]
  status    DealStatus @default(CREATED)
  price     BigInt
  updatedAt DateTime   @updatedAt
  clientId  String
  client    User       @relation("X", fields: [clientId], references: [id], onDelete: Cascade)
  offers    Offer[]

  @@index([clientId])
  @@unique([clientId, title])
}

model Offer {
  dealId String
  userId String
  deal   Deal   @relation(fields: [dealId, userId], references: [id, clientId])

  @@id([dealId, userId])
}
`;

describe("parseSchema", () => {
  const models = parseSchema(SOURCE);
  const deal = models.find((m) => m.name === "Deal");
  const field = (name: string) => deal?.fields.find((f) => f.name === name);

  it("разбирает модели в порядке схемы, генератор и перечисления — не модели", () => {
    expect(models.map((m) => m.name)).toEqual(["User", "Deal", "Offer"]);
  });

  it("разбирает поля и их признаки, блочные атрибуты и комментарии пропускает", () => {
    expect(deal?.fields.map((f) => f.name)).toEqual(["id", "note", "title", "tags", "status", "price", "updatedAt", "clientId", "client", "offers"]);
    expect(field("id")).toEqual({
      name: "id", kind: "scalar", type: "String", required: true, list: false, id: true, updatedAt: false, hasDefault: true, relationFields: [],
    });
    expect(field("note")).toMatchObject({ kind: "scalar", type: "String", required: false, list: false, id: false, hasDefault: false });
    expect(field("title")).toMatchObject({ type: "String", required: true, hasDefault: true });
    expect(field("tags")).toMatchObject({ kind: "scalar", type: "String", required: true, list: true });
    expect(field("status")).toMatchObject({ kind: "enum", type: "DealStatus", required: true, hasDefault: true });
    expect(field("price")).toMatchObject({ kind: "scalar", type: "BigInt" });
    expect(field("updatedAt")).toMatchObject({ kind: "scalar", type: "DateTime", updatedAt: true, hasDefault: false });
    expect(field("client")).toEqual({
      name: "client", kind: "object", type: "User", required: true, list: false, id: false, updatedAt: false, hasDefault: false, relationFields: ["clientId"],
    });
    expect(field("offers")).toMatchObject({ kind: "object", type: "Offer", list: true, relationFields: [] });
  });

  it("idField — единственное поле с @id; составной ключ — null", () => {
    expect(deal?.idField).toBe("id");
    const offer = models.find((m) => m.name === "Offer");
    expect(offer?.idField).toBeNull();
    expect(offer?.fields.find((f) => f.name === "deal")?.relationFields).toEqual(["dealId", "userId"]);
  });

  it("неизвестный тип поля — ошибка, а не молчаливый пропуск", () => {
    expect(() => parseSchema("model A {\n  id String @id\n  b Nope\n}")).toThrow(/Nope/);
    expect(() => parseSchema('model A {\n  id String @id\n  b Unsupported("x")\n}')).toThrow(/A/);
  });
});

describe("parseEnums", () => {
  it("значения перечислений без комментариев и блочных атрибутов", () => {
    expect(parseEnums(SOURCE)).toEqual({ DealStatus: ["CREATED", "PAID_HOLD"] });
  });
});
