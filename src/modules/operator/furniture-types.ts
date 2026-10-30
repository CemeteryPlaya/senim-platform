import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { db, transaction, type Tx } from "@/platform/db";
import { fail } from "@/platform/errors";
import { assertOperator } from "./access";
import { slugify } from "./slug";

/** Справочник FurnitureType: что заказчик выбирает на первом шаге заявки. */

const entity = (id: string) => ({ type: "furniture_type", id });

export async function listFurnitureTypes(user: CurrentUser) {
  assertOperator(user);
  return db.furnitureType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, slug: true, name: true, active: true, sortOrder: true, _count: { select: { requests: true } } },
  });
}

async function assertNameFree(tx: Tx, name: string, exceptId?: string) {
  const taken = await tx.furnitureType.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, id: exceptId ? { not: exceptId } : undefined },
    select: { id: true },
  });
  if (taken) fail.conflict(ru.operator.errors.typeNameTaken);
}

async function freeSlug(tx: Tx, name: string): Promise<string> {
  const base = slugify(name);
  const used = new Set((await tx.furnitureType.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((t) => t.slug));
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/** Блокирует справочник на время изменения: названия уникальны, порядок не перемешивается. */
const lockTypes = (tx: Tx) => tx.$queryRaw`SELECT id FROM "FurnitureType" FOR UPDATE`;

export async function addFurnitureType(user: CurrentUser, input: { name: string }): Promise<{ id: string }> {
  assertOperator(user);
  return transaction(async (tx) => {
    await lockTypes(tx);
    await assertNameFree(tx, input.name);
    const last = await tx.furnitureType.aggregate({ _max: { sortOrder: true } });
    const created = await tx.furnitureType.create({
      data: { name: input.name, slug: await freeSlug(tx, input.name), sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    await recordAudit(tx, { actor: actorOf(user), action: "furniture_type.added", entity: entity(created.id), after: { name: created.name, slug: created.slug } });
    return { id: created.id };
  });
}

export async function renameFurnitureType(user: CurrentUser, input: { id: string; name: string }): Promise<void> {
  assertOperator(user);
  await transaction(async (tx) => {
    await lockTypes(tx);
    const current = await tx.furnitureType.findUnique({ where: { id: input.id } });
    if (!current) return fail.notFound();
    if (current.name === input.name) return;
    await assertNameFree(tx, input.name, input.id);
    await tx.furnitureType.update({ where: { id: input.id }, data: { name: input.name } });
    await recordAudit(tx, { actor: actorOf(user), action: "furniture_type.renamed", entity: entity(input.id), before: { name: current.name }, after: { name: input.name } });
  });
}

/** Скрыть или вернуть тип. Повтор с тем же значением ничего не меняет и не пишет в журнал. */
export async function setFurnitureTypeActive(user: CurrentUser, input: { id: string; active: boolean }): Promise<void> {
  assertOperator(user);
  await transaction(async (tx) => {
    const updated = await tx.furnitureType.updateMany({ where: { id: input.id, active: !input.active }, data: { active: input.active } });
    if (updated.count === 0) {
      if (!(await tx.furnitureType.count({ where: { id: input.id } }))) fail.notFound();
      return;
    }
    await recordAudit(tx, {
      actor: actorOf(user),
      action: input.active ? "furniture_type.shown" : "furniture_type.hidden",
      entity: entity(input.id),
      before: { active: !input.active },
      after: { active: input.active },
    });
  });
}

/** Сдвинуть тип на одну позицию. Порядок нормализуется в 0..n-1. */
export async function moveFurnitureType(user: CurrentUser, input: { id: string; direction: "up" | "down" }): Promise<void> {
  assertOperator(user);
  await transaction(async (tx) => {
    await lockTypes(tx);
    const order = await tx.furnitureType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, sortOrder: true } });
    const from = order.findIndex((t) => t.id === input.id);
    if (from === -1) return fail.notFound();
    const to = input.direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= order.length) return;

    [order[from], order[to]] = [order[to], order[from]];
    for (const [index, type] of order.entries()) {
      if (type.sortOrder !== index) await tx.furnitureType.update({ where: { id: type.id }, data: { sortOrder: index } });
    }
    await recordAudit(tx, { actor: actorOf(user), action: "furniture_type.moved", entity: entity(input.id), before: { position: from + 1 }, after: { position: to + 1 } });
  });
}
