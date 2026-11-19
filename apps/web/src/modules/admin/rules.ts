// Реестр правил доступа админки: модель → поле → hidden | readonly | editable. Единственное место решений —
// чтение (select, поиск, фильтры, связи) и правка берут доступ только отсюда. Спека:
// docs/superpowers/specs/2026-11-20-admin-panel-design.md, раздел «Правила доступа к данным».
//
// Порядок решения для поля (сомнение — в сторону строгого):
//   1. Неизвестные модель или поле — hidden.
//   2. Секрет или ПДн (имя на Enc/Hash/Last4, HIDDEN_FIELDS) — hidden без исключений, OVERRIDES не открывает.
//   3. OVERRIDES со значением hidden — hidden (закрыть можно что угодно).
//   4. Запертое (LOCKED): ключ, createdAt/updatedAt, связь, список, тип без безопасного разбора (BigInt, Json, Float…),
//      статус, модель без единственного @id, журнал денег и журнал аудита — readonly; OVERRIDES не открывает.
//   5. OVERRIDES для поля — как в нём сказано.
//   6. Правило модели: OVERRIDES["*"] или READONLY_MODELS.
//   7. Признак поля: внешний ключ, ссылка …Id, ключ …Key, отметка времени модели со статусной машиной, READONLY_FIELDS.
//   8. Остальное — editable.
import { ADMIN_MODELS } from "./schema.gen";
import type { AdminField, AdminModel } from "./schema-parse";

export type Access = "hidden" | "readonly" | "editable";
type Overrides = Readonly<Record<string, Readonly<Record<string, Access>>>>;

/**
 * Явные исключения владельца после показа: `{ Модель: { поле: доступ } }`, ключ `"*"` — правило всей модели (поля
 * с признаком «только чтение» им не открываются — для них нужен ключ поля). Секреты и запертые поля не открываются
 * ничем; тест падает, если исключение ничего не меняет.
 */
export const OVERRIDES: Overrides = {};

/** ПДн и секреты без признака в имени. Новое поле с ПДн — сюда (тест перечисляет скрытые поля явно). */
const HIDDEN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // Ключи push-подписки: с ними можно слать человеку уведомления от имени площадки (спека).
  PushSubscription: ["endpoint", "p256dh", "auth"],
  // CMS подписи несёт сертификат, а субъект сертификата НУЦ РК — ИИН (SERIALNUMBER=IIN…): решение владельца 4.
  Signature: ["signature", "certSubject"],
  // Путь в хранилище открывает файл (в т. ч. сканы KYC) в обход прав files; у vercel-blob это публичный адрес.
  StoredFile: ["storageKey", "previewKey"],
  // Сырое тело вебхука провайдера: данные плательщика и подпись провайдера.
  PaymentWebhookEvent: ["payload"],
};

const SECRET_SUFFIX = /(Enc|Hash|Last4)$/;

/** Запертые модели: правка запрещена решением владельца или триггером базы — OVERRIDES не открывает. */
const LOCKED_MODELS: ReadonlySet<string> = new Set([
  "MoneyTransaction", // решение владельца 3: журнал денег — только чтение
  "AuditEvent", // журнал аудита только на добавление (триггер)
]);

/** Только чтение — вся модель. */
const READONLY_MODELS: ReadonlySet<string> = new Set([
  // Спека: юридический след, источник правды identity (ADR-013), технические таблицы.
  "PaymentWebhookEvent",
  "Document",
  "Signature",
  "HandSignature",
  "User",
  "Session",
  "OtpCode",
  "Job",
  "RateLimitBucket",
  "AiUsage",
  "PushSubscription",
  // Решение исполнителя плана: записи процесса заявки и сделки — предложения сторон, условия оферты, отметки,
  // доказательства, согласия, решения оператора. Их меняют только процессы: правка в обход ломает переходы, деньги
  // и юридический след («админка не обходит статусные машины»).
  "Deal", // снимок оферты: сроки, провайдер платежей, GPS сдачи в акте
  "Offer", // предложение мастера; round — попытка по OfferRetry
  "PriceProposal", // торг, фиксирующий цену X
  "Project", // версия проекта, одобренная покупателем
  "Measurement", // итог замера и плата за выезд
  "MeasureDeposit", // отметки о залоге напрямую мастеру
  "SiteMeasurement", // размеры, снятые замерщиком
  "Dispute", // итог спора оформлен операциями журнала денег
  "OfferRetry", // решение оператора
  "RequestInvitation", // ответ мастера на приглашение
  "DealShowcase", // выбор покупателя для витрины (согласие, аудит deal.showcase.changed)
  "DealPublicConsent", // согласие стороны на витрину
  "Message", // чат — доказательство в споре; маскирование контактов до оферты
  "Review", // слова покупателя; рейтинг мастера считается из отзывов
  "ProgressReport", // отчёт мастера в ленте сделки
  "Grade", // вычисляется после выплаты; advancePercent = 0 (авансов нет)
  "StoredFile", // назначение файла задаёт права доступа; hiddenAt скрывает файл с контактами
  "Visualization", // задача ИИ и её стоимость
  "Notification", // отправленное человеку сообщение
]);

/** Только чтение — отдельные поля моделей, открытых для правки. */
const READONLY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // Проекция identity (partyColumns), номер «Исполнитель №N», счётчики из сделок и отзывов, решения оператора.
  ExecutorProfile: ["legalForm", "legalName", "signerFullName", "kycRejectReason", "publicNumber", "reviewsCount", "completedDeals", "addedByOperator", "segment", "rejectReason"],
  // Номер заявки и поля процесса: режим, сценарий до договора, шаг мастера, ценовая группа (кому видна), ключ стиля.
  Request: ["number", "mode", "preContractFlow", "wizardStep", "segment", "segmentSuggested", "style"],
  // Ключи вертикали (verticals/furniture), проверяемые zod на входе.
  MaterialPrice: ["category", "unit"],
  TypicalEstimate: ["productUnit"],
  PortfolioItem: ["style"],
};

/** Модели со статусной машиной: их DateTime — отметки переходов (спека). */
const STATE_MACHINE_MODELS: ReadonlySet<string> = new Set([
  "Deal", "Request", "Offer", "Dispute", "Measurement", "SiteMeasurement", "Project", "MeasureDeposit", "PriceProposal", "RequestInvitation", "ExecutorProfile",
]);

/** Типы, которые модуль правки разбирает безопасно; прочие (BigInt, Json, Float, Decimal, Bytes) — только чтение. */
const EDITABLE_SCALARS: ReadonlySet<string> = new Set(["String", "Int", "Boolean", "DateTime"]);

const MODELS: ReadonlyMap<string, AdminModel> = new Map(ADMIN_MODELS.map((m) => [m.name, m]));

const has = (table: Readonly<Record<string, readonly string[]>>, model: string, field: string) => Object.hasOwn(table, model) && table[model].includes(field);

function isSecret(model: string, field: AdminField): boolean {
  return SECRET_SUFFIX.test(field.name) || has(HIDDEN_FIELDS, model, field.name);
}

function isLocked(model: AdminModel, field: AdminField): boolean {
  if (LOCKED_MODELS.has(model.name) || model.idField === null) return true;
  if (field.id || field.name === "id" || field.name === "createdAt" || field.name === "updatedAt" || field.updatedAt) return true;
  if (field.kind === "object" || field.list) return true;
  if (field.kind === "enum") return /Status$/.test(field.type); // решение владельца 2: статусы не меняются
  return !EDITABLE_SCALARS.has(field.type);
}

function isReadonlyByFeature(model: AdminModel, field: AdminField): boolean {
  if (model.fields.some((f) => f.relationFields.includes(field.name))) return true; // внешний ключ
  if (/Id$/.test(field.name) || /Key$/.test(field.name)) return true; // ссылка без FK, ключ повтора или хранилища
  if (field.type === "DateTime" && STATE_MACHINE_MODELS.has(model.name)) return true;
  return has(READONLY_FIELDS, model.name, field.name);
}

const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/** Доступ к полю с заданными исключениями; fieldAccess — с OVERRIDES. Отдельно — для теста порядка правил. */
export function computeAccess(modelName: string, fieldName: string, overrides: Overrides): Access {
  const model = MODELS.get(modelName);
  const field = model?.fields.find((f) => f.name === fieldName);
  if (!model || !field) return "hidden";
  if (isSecret(model.name, field)) return "hidden";
  const forModel = own(overrides, model.name) ?? {};
  const fieldOverride = own(forModel, field.name);
  const modelOverride = own(forModel, "*");
  if (fieldOverride === "hidden" || (fieldOverride === undefined && modelOverride === "hidden")) return "hidden";
  if (isLocked(model, field)) return "readonly";
  if (fieldOverride) return fieldOverride;
  const modelRule = modelOverride ?? (READONLY_MODELS.has(model.name) ? "readonly" : undefined);
  if (modelRule === "readonly") return "readonly";
  return isReadonlyByFeature(model, field) ? "readonly" : "editable";
}

export function fieldAccess(model: string, field: string): Access {
  return computeAccess(model, field, OVERRIDES);
}

/** Поля модели, которые можно выбирать и показывать (вместе со связями), в порядке схемы. */
export function visibleFields(model: string): readonly AdminField[] {
  return (MODELS.get(model)?.fields ?? []).filter((f) => fieldAccess(model, f.name) !== "hidden");
}

/** Поля модели, открытые для правки. */
export function editableFields(model: string): readonly AdminField[] {
  return (MODELS.get(model)?.fields ?? []).filter((f) => fieldAccess(model, f.name) === "editable");
}

/** Модель только для чтения: неизвестна или ни одного редактируемого поля. */
export function modelReadonly(model: string): boolean {
  return editableFields(model).length === 0;
}
