// Метаданные чтения админки: какие поля выбирать из базы и как устроены связи. Всё строится только из видимых полей
// реестра (rules.ts), в том числе для связанной модели — по её собственным правилам: скрытое поле не попадает в select
// ни прямо, ни через связь. Связь «один» выбирает только ключ связанной записи, связь «много» — только число записей.
import { fieldAccess, visibleFields } from "./rules";
import { ADMIN_MODELS } from "./schema.gen";
import type { AdminField, AdminModel } from "./schema-parse";

const MODELS: ReadonlyMap<string, AdminModel> = new Map(ADMIN_MODELS.map((m) => [m.name, m]));

export function modelMeta(name: string): AdminModel | undefined {
  return MODELS.get(name);
}

/** Видимые скалярные поля (и перечисления) модели в порядке схемы — колонки таблицы и поля карточки. */
export function scalarFields(model: string): readonly AdminField[] {
  return visibleFields(model).filter((f) => f.kind !== "object");
}

/**
 * Связь карточки: «один» — ссылка на связанную запись по её ключу (`idField` null — у связанной модели нет
 * единственного видимого ключа, ссылки нет); «много» — число записей и поле связанной модели, по которому строится
 * отфильтрованный список (внешний ключ или, для «много ко многим», обратная связь).
 */
export type RelationMeta =
  | { name: string; model: string; kind: "one"; idField: string | null }
  | { name: string; model: string; kind: "many"; field: string };

/** Переход по связи в списке: равенство внешнего ключа или «есть связанная запись с этим ключом». */
export type Navigation = { kind: "fk" } | { kind: "some"; idField: string };

function visibleId(model: AdminModel): string | null {
  return model.idField !== null && fieldAccess(model.name, model.idField) !== "hidden" ? model.idField : null;
}

/** Обратная сторона связи: поле связанной модели того же отношения (по имени связи, если оно задано). */
function backReference(owner: AdminModel, field: AdminField): AdminField | undefined {
  const target = MODELS.get(field.type);
  if (!target) return undefined;
  const candidates = target.fields.filter(
    (f) =>
      f.kind === "object" &&
      f.type === owner.name &&
      !(target.name === owner.name && f.name === field.name) &&
      (f.relationName ?? null) === (field.relationName ?? null),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function relationOf(owner: AdminModel, field: AdminField): RelationMeta | null {
  const target = MODELS.get(field.type);
  if (!target) return null;
  if (!field.list) return { name: field.name, model: target.name, kind: "one", idField: visibleId(target) };
  const back = backReference(owner, field);
  if (!back) return null;
  // «Много ко многим» (без внешнего ключа) — переход по обратной связи; иначе — по единственному внешнему ключу.
  const via = back.list ? back.name : back.relationFields.length === 1 ? back.relationFields[0] : null;
  if (via === null || navigationOf(target.name, via) === null) return null;
  return { name: field.name, model: target.name, kind: "many", field: via };
}

/** Видимые связи модели в порядке схемы. Связь без перехода (составной ключ) не показывается — тест meta ловит такую. */
export function relationsOf(model: string): readonly RelationMeta[] {
  const owner = MODELS.get(model);
  if (!owner) return [];
  return visibleFields(model)
    .filter((f) => f.kind === "object")
    .map((f) => relationOf(owner, f))
    .filter((r): r is RelationMeta => r !== null);
}

/**
 * Можно ли отфильтровать список модели по полю `field` (переход из связи «много»): видимый скалярный внешний ключ
 * этой модели — равенство; видимая связь-список с видимым ключом связанной модели — «есть такая связанная запись».
 * Иначе (скрытое, обычное, неизвестное поле) — null.
 */
export function navigationOf(model: string, field: string): Navigation | null {
  const owner = MODELS.get(model);
  const f = owner?.fields.find((x) => x.name === field);
  if (!owner || !f || fieldAccess(model, field) === "hidden") return null;
  if (f.kind === "scalar" && !f.list && f.type === "String" && owner.fields.some((o) => o.relationFields.includes(f.name))) return { kind: "fk" };
  if (f.kind === "object" && f.list) {
    const target = MODELS.get(f.type);
    const idField = target ? visibleId(target) : null;
    if (idField) return { kind: "some", idField };
  }
  return null;
}

/** select для списка: только видимые скалярные поля. */
export function listSelect(model: string): Record<string, true> {
  return Object.fromEntries(scalarFields(model).map((f) => [f.name, true as const]));
}

/** select для карточки: видимые скаляры, ключ связанной записи для «один», число записей для «много». */
export function recordSelect(model: string): Record<string, unknown> {
  const select: Record<string, unknown> = { ...listSelect(model) };
  const counted: Record<string, true> = {};
  for (const r of relationsOf(model)) {
    if (r.kind === "many") counted[r.name] = true;
    else if (r.idField !== null) select[r.name] = { select: { [r.idField]: true } };
  }
  if (Object.keys(counted).length > 0) select._count = { select: counted };
  return select;
}
