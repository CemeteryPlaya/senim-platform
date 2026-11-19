import { describe, expect, it } from "vitest";
import { type Access, OVERRIDES, computeAccess, editableFields, fieldAccess, modelReadonly, visibleFields } from "./rules";
import { ADMIN_MODELS, ENUMS } from "./schema.gen";

const all = ADMIN_MODELS.flatMap((m) => m.fields.map((f) => ({ model: m.name, field: f, key: `${m.name}.${f.name}` })));
const fieldsOf = (model: string) => ADMIN_MODELS.find((m) => m.name === model)?.fields ?? [];

// Полная карта доступа «модель → поле»: новое поле или модель схемы меняет вычисленную карту, и тест требует решения —
// скрыть, оставить только для чтения или открыть. Поле ПДн без признака в имени (Enc/Hash/Last4) не станет видимым
// или редактируемым молча. Поля, которых в группе нет, в модели отсутствуют.
type Groups = { hidden?: readonly string[]; readonly?: readonly string[]; editable?: readonly string[] };
const ACCESS_MAP: Readonly<Record<string, Groups>> = {
  User: {
    hidden: ["iinEnc", "iinHash", "iinLast4"],
    readonly: ["id", "phone", "role", "roles", "fullName", "instagram", "email", "emailVerifiedAt", "blockedAt", "createdAt", "updatedAt", "sessions", "executorProfile", "requests", "clientDeals", "signatures", "messages", "notifications", "reviews", "disputesOpened", "disputesResolved", "files", "siteMeasurements", "materialPrices", "priceProposals", "handSignatures", "publicConsents", "pushSubscriptions"],
  },
  Session: {
    hidden: ["tokenHash"],
    readonly: ["id", "userId", "user", "userAgent", "activeRole", "createdAt", "lastSeenAt", "expiresAt", "revokedAt"],
  },
  OtpCode: {
    hidden: ["codeHash"],
    readonly: ["id", "phone", "attempts", "expiresAt", "consumedAt", "createdAt"],
  },
  ExecutorProfile: {
    hidden: ["binIinEnc", "binIinHash", "binIinLast4", "signerIinEnc", "signerIinHash", "payoutIbanEnc", "payoutIbanLast4"],
    readonly: ["id", "userId", "user", "publicNumber", "legalForm", "legalName", "signerFullName", "segment", "status", "rejectReason", "measurementTerms", "measurementFee", "ratingAvg", "reviewsCount", "completedDeals", "addedByOperator", "kycStatus", "kycRejectReason", "kycReviewedAt", "createdAt", "updatedAt", "reviewedAt", "specializations", "portfolio", "offers", "invitations", "directRequests", "deals", "reviews", "grade", "kycDocuments", "highlights"],
    editable: ["about", "yearsExperience", "city", "district", "streetAddress"],
  },
  ExecutorHighlight: {
    readonly: ["id", "executorId", "executor", "portfolioItemId", "portfolioItem", "dealId", "deal"],
    editable: ["position"],
  },
  FurnitureType: {
    readonly: ["id", "slug", "createdAt", "executors", "portfolio", "requests", "typicalEstimate"],
    editable: ["name", "active", "sortOrder"],
  },
  MaterialPrice: {
    readonly: ["id", "category", "unit", "segments", "updatedById", "updatedBy", "createdAt", "updatedAt"],
    editable: ["name", "priceKzt", "active"],
  },
  TypicalEstimate: {
    readonly: ["furnitureTypeId", "furnitureType", "productUnit", "markup", "perUnit", "updatedAt"],
    editable: ["typicalWidthCm", "typicalHeightCm"],
  },
  PortfolioItem: {
    readonly: ["id", "executorId", "executor", "furnitureTypeId", "furnitureType", "style", "title", "description", "dealId", "deal", "createdAt", "clientKey", "photos", "dealPhotos", "requests", "highlight"],
    editable: ["priceFrom", "published", "place", "featured"],
  },
  PortfolioDealPhoto: {
    readonly: ["portfolioItemId", "portfolioItem", "fileId", "file", "sortOrder"],
  },
  Review: {
    readonly: ["id", "dealId", "deal", "executorId", "executor", "authorId", "author", "rating", "text", "createdAt"],
  },
  Request: {
    readonly: ["id", "number", "clientId", "client", "mode", "targetExecutorId", "targetExecutor", "portfolioItemId", "portfolioItem", "furnitureTypeId", "furnitureType", "style", "details", "segment", "segmentSuggested", "city", "address", "district", "complex", "addressLat", "addressLng", "desiredDate", "status", "preContractFlow", "wizardStep", "designConfirmedAt", "clientKey", "publishedAt", "closedAt", "createdAt", "updatedAt", "photos", "offers", "measurements", "deal", "visualizations", "siteMeasurement", "projects", "offerRetries", "invitations"],
    editable: ["customType", "wishes"],
  },
  RequestInvitation: {
    readonly: ["id", "requestId", "request", "executorId", "executor", "status", "reason", "clientKey", "createdAt", "decidedAt"],
  },
  Offer: {
    readonly: ["id", "requestId", "request", "executorId", "executor", "priceTiyn", "durationDays", "warrantyMonths", "measurementTerms", "measurementFee", "comment", "status", "round", "chatClosedAt", "chatClosedReason", "clientPhoneSharedAt", "createdAt", "updatedAt", "measurement", "deal", "messages", "proposals", "projects", "deposit"],
  },
  Measurement: {
    readonly: ["id", "offerId", "offer", "requestId", "request", "scheduledAt", "status", "result", "finalPrice", "feeAccrued", "doneAt", "createdAt", "updatedAt"],
  },
  SiteMeasurement: {
    readonly: ["id", "requestId", "request", "measurerId", "measurer", "assignedById", "status", "widthCm", "heightCm", "depthCm", "notes", "assignedAt", "doneAt", "updatedAt"],
  },
  Project: {
    readonly: ["id", "requestId", "request", "offerId", "offer", "version", "status", "materials", "costLines", "durationDays", "warrantyMonths", "totalPrice", "changeNote", "createdAt", "decidedAt"],
  },
  MeasureDeposit: {
    readonly: ["id", "offerId", "offer", "amount", "status", "markedAt", "confirmedAt"],
  },
  OfferRetry: {
    readonly: ["id", "requestId", "request", "executorId", "round", "reason", "operatorId", "createdAt"],
  },
  PriceProposal: {
    readonly: ["id", "offerId", "offer", "authorId", "author", "party", "amountTiyn", "status", "createdAt", "decidedAt", "decidedById"],
  },
  Deal: {
    readonly: ["id", "number", "requestId", "request", "offerId", "offer", "clientId", "client", "executorId", "executor", "title", "priceTiyn", "protectionTiyn", "buyerTotalTiyn", "guaranteeTiyn", "payoutTiyn", "platformIncomeTiyn", "durationDays", "warrantyMonths", "paymentProvider", "status", "createdAt", "updatedAt", "signedAt", "paidAt", "startedAt", "readyAt", "acceptedAt", "completedAt", "cancelledAt", "readyLat", "readyLng", "readyAccuracyM", "readyDistanceM", "readyWithinRadius", "publicId", "portfolioConsentAt", "progressReports", "documents", "disputes", "review", "portfolioItem", "transactions", "deliveryPhotos", "publicConsents", "showcase", "highlight"],
  },
  ProgressReport: {
    readonly: ["id", "dealId", "deal", "authorId", "title", "text", "createdAt", "clientKey", "photos"],
  },
  DealShowcase: {
    readonly: ["dealId", "deal", "photos", "price", "address", "signature", "signedAs", "textVersion", "updatedAt", "updatedById"],
  },
  DealPublicConsent: {
    readonly: ["id", "dealId", "deal", "party", "userId", "user", "grantedAt", "revokedAt"],
  },
  Dispute: {
    readonly: ["id", "dealId", "deal", "openedInStatus", "openedById", "openedBy", "reason", "description", "clientPosition", "executorPosition", "status", "outcome", "masterShareTiyn", "rationale", "resolvedById", "resolvedBy", "createdAt", "resolvedAt", "attachments", "transactions"],
  },
  Grade: {
    readonly: ["executorId", "executor", "level", "completedOrdersCount", "advancePercent", "updatedAt"],
  },
  MoneyTransaction: {
    readonly: ["id", "seq", "dealId", "deal", "type", "status", "amountTiyn", "idempotencyKey", "provider", "isTest", "parentId", "parent", "children", "disputeId", "dispute", "externalRef", "basisDocumentId", "basisDocument", "bankDocNumber", "bankDocDate", "bankDocFileId", "bankDocFile", "actorId", "confirmedById", "error", "createdAt", "settledAt"],
  },
  PaymentWebhookEvent: {
    hidden: ["payload"],
    readonly: ["id", "provider", "externalEventId", "receivedAt", "processedAt", "error"],
  },
  Document: {
    readonly: ["id", "dealId", "deal", "kind", "version", "number", "fileId", "file", "sha256", "status", "createdAt", "signedAt", "signatures", "handSignatures", "transactions"],
  },
  Signature: {
    hidden: ["signature", "certSubject", "certIinLast4"],
    readonly: ["id", "documentId", "document", "userId", "user", "party", "method", "signedSha256", "certSerial", "verified", "signedAt"],
  },
  HandSignature: {
    readonly: ["id", "documentId", "document", "userId", "user", "party", "imageFileId", "imageFile", "typedName", "documentSha256", "ip", "userAgent", "signedAt"],
  },
  StoredFile: {
    hidden: ["storageKey", "previewKey"],
    readonly: ["id", "provider", "purpose", "contentType", "size", "sha256", "phash", "width", "height", "isAiGenerated", "uploadedById", "uploadedBy", "sortOrder", "createdAt", "hiddenAt", "hiddenById", "portfolioItemId", "portfolioItem", "requestId", "request", "progressReportId", "progressReport", "dealId", "deal", "executorProfileId", "executorProfile", "disputeId", "dispute", "messageId", "message", "visualizationId", "visualization", "document", "visualizationSrc", "portfolioDealPhotos", "bankDocFor", "handSignature"],
  },
  Message: {
    readonly: ["id", "offerId", "offer", "senderId", "sender", "body", "wasMasked", "createdAt", "clientKey", "attachments"],
  },
  PushSubscription: {
    hidden: ["endpoint", "p256dh", "auth"],
    readonly: ["id", "userId", "user", "userAgent", "createdAt", "lastUsedAt"],
  },
  Notification: {
    readonly: ["id", "userId", "user", "kind", "title", "body", "link", "readAt", "createdAt"],
  },
  AuditEvent: {
    readonly: ["id", "seq", "actorId", "actorRole", "action", "entityType", "entityId", "scope", "before", "after", "meta", "ip", "userAgent", "createdAt"],
  },
  Job: {
    readonly: ["id", "kind", "payload", "dedupeKey", "status", "runAt", "attempts", "maxAttempts", "lockedAt", "lastError", "createdAt", "finishedAt"],
  },
  RateLimitBucket: {
    readonly: ["key", "windowStart", "count"],
  },
  PlatformSetting: {
    readonly: ["key", "value", "updatedAt"],
  },
  AiUsage: {
    readonly: ["id", "provider", "operation", "model", "requestId", "userId", "inputTokens", "outputTokens", "images", "costUsdMicros", "createdAt"],
  },
  Visualization: {
    readonly: ["id", "requestId", "request", "sourceFileId", "sourceFile", "prompt", "status", "error", "costUsdMicros", "createdAt", "finishedAt", "results"],
  },
};

/** Ошибки исключений: нет модели или поля; исключение не меняет ни одного доступа по сравнению с правилами без него. */
function overrideProblems(overrides: Readonly<Record<string, Readonly<Record<string, Access>>>>): string[] {
  const problems: string[] = [];
  for (const [model, fields] of Object.entries(overrides)) {
    if (!ADMIN_MODELS.some((m) => m.name === model)) {
      problems.push(`${model}: нет модели`);
      continue;
    }
    for (const key of Object.keys(fields)) {
      if (key !== "*" && !fieldsOf(model).some((f) => f.name === key)) {
        problems.push(`${model}.${key}: нет поля`);
        continue;
      }
      const without = { ...overrides, [model]: Object.fromEntries(Object.entries(fields).filter(([k]) => k !== key)) };
      const targets = key === "*" ? fieldsOf(model).map((f) => f.name) : [key];
      if (!targets.some((f) => computeAccess(model, f, overrides) !== computeAccess(model, f, without))) problems.push(`${model}.${key}: не меняет доступ`);
    }
  }
  return problems;
}

function computedMap(): Record<string, Groups> {
  const out: Record<string, Groups> = {};
  for (const m of ADMIN_MODELS) {
    const groups: Groups = {};
    for (const access of ["hidden", "readonly", "editable"] as const) {
      const names = m.fields.filter((f) => fieldAccess(m.name, f.name) === access).map((f) => f.name);
      if (names.length > 0) groups[access] = names;
    }
    out[m.name] = groups;
  }
  return out;
}

describe("реестр правил покрывает всю схему", () => {
  it("вычисленный доступ каждого поля — ровно карта ACCESS_MAP", () => {
    expect(computedMap()).toEqual(ACCESS_MAP);
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
    expect(computeAccess("FurnitureType", "slug", { FurnitureType: { slug: "editable" } })).toBe("editable");
    expect(computeAccess("FurnitureType", "name", { FurnitureType: { name: "readonly" } })).toBe("readonly");
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

  it("каждое исключение OVERRIDES ссылается на существующее поле и меняет доступ по сравнению с правилами без него", () => {
    expect(overrideProblems(OVERRIDES)).toEqual([]);
    // Проверка сама ловит опечатку и исключение, совпадающее с правилом по умолчанию.
    expect(overrideProblems({ Nope: { x: "readonly" } })).toEqual(["Nope: нет модели"]);
    expect(overrideProblems({ Deal: { nope: "readonly" } })).toEqual(["Deal.nope: нет поля"]);
    expect(overrideProblems({ Deal: { title: "readonly", status: "editable", "*": "readonly" } })).toEqual([
      "Deal.title: не меняет доступ", "Deal.status: не меняет доступ", "Deal.*: не меняет доступ",
    ]);
    expect(overrideProblems({ Deal: { title: "editable" }, FurnitureType: { "*": "readonly" } })).toEqual([]);
  });
});

describe("справочники открыты для правки", () => {
  it("виды мебели: name, active, sortOrder; slug (адрес раздела) — только чтение", () => {
    for (const f of ["name", "active", "sortOrder"]) expect(fieldAccess("FurnitureType", f)).toBe("editable");
    expect(fieldAccess("FurnitureType", "slug")).toBe("readonly");
    expect(modelReadonly("FurnitureType")).toBe(false);
  });

  it("поля с правилами предметной области и адрес заявки — только чтение", () => {
    for (const f of ["measurementTerms", "measurementFee"]) expect(fieldAccess("ExecutorProfile", f)).toBe("readonly");
    for (const f of ["title", "description"]) expect(fieldAccess("PortfolioItem", f)).toBe("readonly");
    for (const f of ["city", "address", "district", "complex", "addressLat", "addressLng"]) expect(fieldAccess("Request", f)).toBe("readonly");
  });

  it("цены материалов: priceKzt (целые тенге справочника) и name; автор правки — только чтение", () => {
    expect(fieldAccess("MaterialPrice", "priceKzt")).toBe("editable");
    expect(fieldAccess("MaterialPrice", "name")).toBe("editable");
    expect(fieldAccess("MaterialPrice", "updatedById")).toBe("readonly");
  });

  it("editableFields — поля с доступом editable, перечисления — члены ENUMS", () => {
    expect(editableFields("FurnitureType").map((f) => f.name)).toEqual(["name", "active", "sortOrder"]);
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
