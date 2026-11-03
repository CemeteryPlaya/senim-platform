import type { Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { db, transaction, type Tx } from "@/platform/db";
import { fail } from "@/platform/errors";
import { isEnabled } from "@/platform/features";
import { isMaterialCategory, isMaterialUnit, MATERIAL_CATEGORIES, type MaterialCategory, type MaterialUnit } from "@/verticals/furniture";
import { assertOperator } from "./access";
import type { AddMaterialPriceInput, ChangeMaterialPriceInput } from "./schemas";

/**
 * Справочник средних рыночных цен материалов (ADR-007, ответ №33). Из активных строк калькулятор
 * вертикали считает вилку по уровням в мастере заявки. Каждое изменение — в журнале (до и после).
 */

const t = ru.materials.errors;
const entity = (id: string) => ({ type: "material_price", id });

/** Справочник — часть калькулятора материалов (флаг materialsCalculator, ADR-009): выключен — оператору FORBIDDEN. */
function assertBookOperator(user: CurrentUser): void {
  if (!isEnabled("materialsCalculator")) fail.forbidden(t.off);
  assertOperator(user);
}

export type MaterialPriceRow = {
  id: string;
  category: MaterialCategory;
  name: string;
  unit: MaterialUnit;
  priceKzt: number;
  segments: Segment[];
  active: boolean;
  /** Демонстрационная цифра из сида: оператор ещё не заменил её реальной. */
  isDemo: boolean;
  updatedAt: Date;
  updatedBy: string | null;
};

const CATEGORY_ORDER = new Map(MATERIAL_CATEGORIES.map((c, i) => [c, i]));

/** Строки пишет только этот сервис и сид, поэтому неизвестный ключ — поломка, а не ввод. */
function keysOf(row: { id: string; category: string; unit: string }): { category: MaterialCategory; unit: MaterialUnit } {
  if (!isMaterialCategory(row.category) || !isMaterialUnit(row.unit)) throw new Error(`MaterialPrice ${row.id}: неизвестная категория или единица`);
  return { category: row.category, unit: row.unit };
}

/** Все строки: по разделам в порядке вертикали, внутри — по названию. Архив — с active: false. */
export async function listMaterialPrices(user: CurrentUser): Promise<MaterialPriceRow[]> {
  assertBookOperator(user);
  const rows = await db.materialPrice.findMany({
    orderBy: [{ name: "asc" }, { unit: "asc" }],
    select: {
      id: true,
      category: true,
      name: true,
      unit: true,
      priceKzt: true,
      segments: true,
      active: true,
      isDemo: true,
      updatedAt: true,
      updatedBy: { select: { fullName: true } },
    },
  });
  return rows
    .map(({ updatedBy, ...row }) => ({ ...row, ...keysOf(row), updatedBy: updatedBy?.fullName ?? null }))
    .sort((a, b) => CATEGORY_ORDER.get(a.category)! - CATEGORY_ORDER.get(b.category)!);
}

/** Один писатель справочника за раз: проверка «такого материала нет» и вставка не разъезжаются. */
const lockBook = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('MaterialPrice'))`;

export async function addMaterialPrice(user: CurrentUser, input: AddMaterialPriceInput): Promise<{ id: string }> {
  assertBookOperator(user);
  return transaction(async (tx) => {
    await lockBook(tx);
    const taken = await tx.materialPrice.count({
      where: { category: input.category, unit: input.unit, name: { equals: input.name, mode: "insensitive" } },
    });
    if (taken > 0) fail.conflict(t.nameTaken);
    const created = await tx.materialPrice.create({ data: { ...input, updatedById: user.id } });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "material_price.added",
      entity: entity(created.id),
      after: { category: input.category, name: input.name, unit: input.unit, priceKzt: input.priceKzt, segments: input.segments },
    });
    return { id: created.id };
  });
}

/**
 * Новая цена. Меняется только та цена, которую оператор видел (`from`): повтор того же сохранения
 * ничего не делает, а цену, уже изменённую другим, не перезаписывает. Пометка «демо» снимается.
 */
export async function changeMaterialPrice(user: CurrentUser, input: ChangeMaterialPriceInput): Promise<void> {
  assertBookOperator(user);
  await transaction(async (tx) => {
    const [current] = await tx.$queryRaw<{ priceKzt: number; active: boolean; isDemo: boolean }[]>`
      SELECT "priceKzt", "active", "isDemo" FROM "MaterialPrice" WHERE "id" = ${input.id} FOR UPDATE`;
    if (!current) return fail.notFound();
    if (!current.active) return fail.conflict(t.archived);
    if (current.priceKzt === input.to) return;
    if (current.priceKzt !== input.from) return fail.conflict(t.priceChanged);

    await tx.materialPrice.update({ where: { id: input.id }, data: { priceKzt: input.to, isDemo: false, updatedById: user.id } });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "material_price.price_changed",
      entity: entity(input.id),
      before: { priceKzt: current.priceKzt, isDemo: current.isDemo },
      after: { priceKzt: input.to, isDemo: false },
    });
  });
}

/** В архив или обратно. Материал в архиве не входит в расчёт. Повтор того же действия ничего не меняет. */
export async function setMaterialPriceActive(user: CurrentUser, input: { id: string; active: boolean }): Promise<void> {
  assertBookOperator(user);
  await transaction(async (tx) => {
    const updated = await tx.materialPrice.updateMany({ where: { id: input.id, active: !input.active }, data: { active: input.active, updatedById: user.id } });
    if (updated.count === 0) {
      if (!(await tx.materialPrice.count({ where: { id: input.id } }))) fail.notFound();
      return;
    }
    await recordAudit(tx, {
      actor: actorOf(user),
      action: input.active ? "material_price.restored" : "material_price.archived",
      entity: entity(input.id),
      before: { active: !input.active },
      after: { active: input.active },
    });
  });
}
