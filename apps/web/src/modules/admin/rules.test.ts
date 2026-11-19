import { describe, expect, it } from "vitest";
import { OVERRIDES, computeAccess, editableFields, fieldAccess, modelReadonly, visibleFields } from "./rules";
import { ADMIN_MODELS, ENUMS } from "./schema.gen";

const all = ADMIN_MODELS.flatMap((m) => m.fields.map((f) => ({ model: m.name, field: f, key: `${m.name}.${f.name}` })));
const keysWith = (access: string) => all.filter((x) => fieldAccess(x.model, x.field.name) === access).map((x) => x.key).sort();
const fieldsOf = (model: string) => ADMIN_MODELS.find((m) => m.name === model)?.fields ?? [];

// Явные списки: новое поле схемы меняет один из них, и тест требует решения — скрыть, оставить только для чтения
// или открыть. Поле ПДн без признака в имени (Enc/Hash/Last4) не станет видимым или редактируемым молча.
const HIDDEN = [
  "ExecutorProfile.binIinEnc", "ExecutorProfile.binIinHash", "ExecutorProfile.binIinLast4",
  "ExecutorProfile.payoutIbanEnc", "ExecutorProfile.payoutIbanLast4",
  "ExecutorProfile.signerIinEnc", "ExecutorProfile.signerIinHash",
  "OtpCode.codeHash",
  "PaymentWebhookEvent.payload",
  "PushSubscription.auth", "PushSubscription.endpoint", "PushSubscription.p256dh",
  "Session.tokenHash",
  "Signature.certIinLast4", "Signature.certSubject", "Signature.signature",
  "StoredFile.previewKey", "StoredFile.storageKey",
  "User.iinEnc", "User.iinHash", "User.iinLast4",
].sort();

const EDITABLE = [
  "ExecutorHighlight.position",
  "ExecutorProfile.about", "ExecutorProfile.city", "ExecutorProfile.district", "ExecutorProfile.measurementFee",
  "ExecutorProfile.measurementTerms", "ExecutorProfile.streetAddress", "ExecutorProfile.yearsExperience",
  "FurnitureType.active", "FurnitureType.name", "FurnitureType.slug", "FurnitureType.sortOrder",
  "MaterialPrice.active", "MaterialPrice.name", "MaterialPrice.priceKzt",
  "PortfolioItem.description", "PortfolioItem.featured", "PortfolioItem.place", "PortfolioItem.priceFrom",
  "PortfolioItem.published", "PortfolioItem.title",
  "Request.address", "Request.city", "Request.complex", "Request.customType", "Request.district", "Request.wishes",
  "TypicalEstimate.typicalHeightCm", "TypicalEstimate.typicalWidthCm",
].sort();

describe("реестр правил покрывает всю схему", () => {
  it("у каждого поля каждой модели есть правило", () => {
    for (const x of all) expect(["hidden", "readonly", "editable"]).toContain(fieldAccess(x.model, x.field.name));
  });

  it("скрытые поля — ровно явный список", () => {
    expect(keysWith("hidden")).toEqual(HIDDEN);
  });

  it("редактируемые поля — ровно явный список", () => {
    expect(keysWith("editable")).toEqual(EDITABLE);
  });

  it("неизвестные модель или поле — hidden", () => {
    expect(fieldAccess("Nope", "x")).toBe("hidden");
    expect(fieldAccess("Deal", "nope")).toBe("hidden");
    expect(fieldAccess("Deal", "toString")).toBe("hidden");
    expect(fieldAccess("constructor", "name")).toBe("hidden");
    expect(visibleFields("Nope")).toEqual([]);
    expect(modelReadonly("Nope")).toBe(true);
  });
});

describe("скрыто совсем", () => {
  it("каждое поле на Enc, Hash, Last4 в любой модели — hidden", () => {
    const secret = all.filter((x) => /(Enc|Hash|Last4)$/.test(x.field.name));
    expect(secret.length).toBeGreaterThan(0);
    for (const x of secret) expect(fieldAccess(x.model, x.field.name), x.key).toBe("hidden");
  });

  it("ключи push-подписки — hidden", () => {
    for (const f of ["p256dh", "auth", "endpoint"]) expect(fieldAccess("PushSubscription", f)).toBe("hidden");
  });

  it("исключение не открывает скрытое", () => {
    const open = { User: { "*": "editable", iinHash: "editable" }, PushSubscription: { auth: "readonly" } } as const;
    expect(computeAccess("User", "iinHash", open)).toBe("hidden");
    expect(computeAccess("PushSubscription", "auth", open)).toBe("hidden");
  });

  it("visibleFields не содержит скрытых полей", () => {
    for (const m of ADMIN_MODELS) for (const f of visibleFields(m.name)) expect(fieldAccess(m.name, f.name)).not.toBe("hidden");
    expect(visibleFields("User").map((f) => f.name)).not.toEqual(expect.arrayContaining(["iinEnc"]));
    expect(visibleFields("User").map((f) => f.name)).toContain("fullName");
  });
});

describe("только чтение", () => {
  it("каждое поле-статус (перечисление на Status) — не editable", () => {
    const statuses = all.filter((x) => x.field.kind === "enum" && /Status$/.test(x.field.type));
    expect(statuses.map((x) => x.key)).toEqual(expect.arrayContaining(["Deal.status", "Dispute.openedInStatus", "ExecutorProfile.kycStatus"]));
    for (const x of statuses) expect(fieldAccess(x.model, x.field.name), x.key).not.toBe("editable");
  });

  it("модели только для чтения целиком", () => {
    const models = ["MoneyTransaction", "AuditEvent", "PaymentWebhookEvent", "Document", "Signature", "HandSignature", "User", "Session", "OtpCode", "Job", "RateLimitBucket", "AiUsage", "PushSubscription"];
    for (const m of models) {
      for (const f of fieldsOf(m)) expect(fieldAccess(m, f.name), `${m}.${f.name}`).not.toBe("editable");
      expect(modelReadonly(m), m).toBe(true);
    }
  });

  it("id, createdAt, updatedAt, @updatedAt, BigInt, Json, списки, связи, внешние ключи — readonly или hidden", () => {
    for (const x of all) {
      const f = x.field;
      const fk = fieldsOf(x.model).some((o) => o.relationFields.includes(f.name));
      const locked = f.id || ["id", "createdAt", "updatedAt"].includes(f.name) || f.updatedAt || ["BigInt", "Json"].includes(f.type) || f.list || f.kind === "object" || fk;
      if (locked) expect(fieldAccess(x.model, f.name), x.key).not.toBe("editable");
    }
    expect(fieldAccess("Deal", "priceTiyn")).toBe("readonly");
    expect(fieldAccess("Request", "details")).toBe("readonly");
    expect(fieldAccess("MaterialPrice", "segments")).toBe("readonly");
    expect(fieldAccess("MaterialPrice", "updatedById")).toBe("readonly");
    expect(fieldAccess("PortfolioItem", "executorId")).toBe("readonly");
    expect(fieldAccess("Request", "client")).toBe("readonly");
    expect(fieldAccess("FurnitureType", "createdAt")).toBe("readonly");
    expect(fieldAccess("MaterialPrice", "updatedAt")).toBe("readonly");
  });

  it("DateTime моделей со статусной машиной — readonly", () => {
    const models = ["Deal", "Request", "Offer", "Dispute", "Measurement", "SiteMeasurement", "Project", "MeasureDeposit", "PriceProposal", "RequestInvitation", "ExecutorProfile"];
    for (const m of models) for (const f of fieldsOf(m).filter((f) => f.type === "DateTime")) expect(fieldAccess(m, f.name), `${m}.${f.name}`).toBe("readonly");
    expect(fieldAccess("Deal", "signedAt")).toBe("readonly");
    expect(fieldAccess("Request", "desiredDate")).toBe("readonly");
  });

  it("исключение не открывает запертое: статус, деньги, журналы, ключ", () => {
    const open = {
      Deal: { status: "editable", priceTiyn: "editable", id: "editable" },
      MoneyTransaction: { "*": "editable", error: "editable" },
      AuditEvent: { action: "editable" },
      User: { sessions: "editable" },
    } as const;
    expect(computeAccess("Deal", "status", open)).toBe("readonly");
    expect(computeAccess("Deal", "priceTiyn", open)).toBe("readonly");
    expect(computeAccess("Deal", "id", open)).toBe("readonly");
    expect(computeAccess("MoneyTransaction", "error", open)).toBe("readonly");
    expect(computeAccess("AuditEvent", "action", open)).toBe("readonly");
    expect(computeAccess("User", "sessions", open)).toBe("readonly");
  });
});

describe("исключения", () => {
  it("поле: открыть мягкое правило, закрыть редактируемое", () => {
    expect(computeAccess("Deal", "title", { Deal: { title: "editable" } })).toBe("editable");
    expect(computeAccess("Deal", "signedAt", { Deal: { signedAt: "editable" } })).toBe("editable");
    expect(computeAccess("FurnitureType", "slug", { FurnitureType: { slug: "readonly" } })).toBe("readonly");
    expect(computeAccess("FurnitureType", "name", { FurnitureType: { name: "hidden" } })).toBe("hidden");
  });

  it("модель «*»: заменяет правило модели, признаки полей остаются", () => {
    const open = { Deal: { "*": "editable" } } as const;
    expect(computeAccess("Deal", "title", open)).toBe("editable");
    expect(computeAccess("Deal", "signedAt", open)).toBe("readonly");
    expect(computeAccess("Deal", "clientId", open)).toBe("readonly");
    const closed = { FurnitureType: { "*": "readonly" } } as const;
    expect(computeAccess("FurnitureType", "name", closed)).toBe("readonly");
    const hidden = { FurnitureType: { "*": "hidden", name: "readonly" } } as const;
    expect(computeAccess("FurnitureType", "slug", hidden)).toBe("hidden");
    expect(computeAccess("FurnitureType", "name", hidden)).toBe("readonly");
  });

  it("каждое исключение OVERRIDES ссылается на существующее поле и что-то решает", () => {
    for (const [model, fields] of Object.entries(OVERRIDES)) {
      for (const [field, access] of Object.entries(fields)) {
        if (field !== "*") expect(fieldsOf(model).map((f) => f.name), `${model}.${field}`).toContain(field);
        if (field !== "*") expect(fieldAccess(model, field), `${model}.${field}`).toBe(access);
        expect(ADMIN_MODELS.map((m) => m.name)).toContain(model);
      }
    }
  });
});

describe("справочники открыты для правки", () => {
  it("виды мебели: name, active, sortOrder, slug", () => {
    for (const f of ["name", "active", "sortOrder", "slug"]) expect(fieldAccess("FurnitureType", f)).toBe("editable");
    expect(modelReadonly("FurnitureType")).toBe(false);
  });

  it("цены материалов: priceKzt (целые тенге справочника) и name; автор правки — только чтение", () => {
    expect(fieldAccess("MaterialPrice", "priceKzt")).toBe("editable");
    expect(fieldAccess("MaterialPrice", "name")).toBe("editable");
    expect(fieldAccess("MaterialPrice", "updatedById")).toBe("readonly");
  });

  it("editableFields — поля с доступом editable, перечисления — члены ENUMS", () => {
    expect(editableFields("FurnitureType").map((f) => f.name)).toEqual(["slug", "name", "active", "sortOrder"]);
    for (const m of ADMIN_MODELS) {
      for (const f of editableFields(m.name)) {
        expect(fieldAccess(m.name, f.name)).toBe("editable");
        if (f.kind === "enum") expect(Object.keys(ENUMS)).toContain(f.type);
      }
    }
  });

  it("модель без единственного @id — только чтение (нет карточки)", () => {
    expect(modelReadonly("PortfolioDealPhoto")).toBe(true);
    expect(fieldAccess("PortfolioDealPhoto", "sortOrder")).toBe("readonly");
  });
});
