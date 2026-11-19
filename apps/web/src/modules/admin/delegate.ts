// Делегат Prisma по имени модели из реестра. Админка обходит все модели одной формой запроса, поэтому делегат сужается
// до общей формы ModelDelegate: аргументы строятся только из видимых полей реестра (meta.ts), а их имена и типы
// Prisma проверяет при выполнении (тест read.int открывает список и карточку каждой модели).
import { Prisma, type Db } from "@/platform/db";

type Args = Readonly<Record<string, unknown>>;

/** Методы делегата модели, которыми пользуется админка. */
export type ModelDelegate = {
  findMany(args: Args): Promise<Record<string, unknown>[]>;
  findUnique(args: Args): Promise<Record<string, unknown> | null>;
  count(args?: Args): Promise<number>;
  updateMany(args: Args): Promise<{ count: number }>;
};

type ModelName = Prisma.ModelName;
/** Карта делегатов клиента: модель `Deal` — свойство `deal`. */
type DelegateKey = Uncapitalize<ModelName>;

const MODEL_NAMES: ReadonlySet<string> = new Set(Object.values(Prisma.ModelName));

const isModelName = (name: string): name is ModelName => MODEL_NAMES.has(name);
const keyOf = (model: ModelName) => `${model.charAt(0).toLowerCase()}${model.slice(1)}` as DelegateKey;

/** Делегат модели клиента или транзакции; неизвестное имя (в том числе `toString`, `$transaction`) — null. */
export function delegateOf(client: Db, model: string): ModelDelegate | null {
  if (!isModelName(model)) return null;
  const delegate: Db[DelegateKey] = client[keyOf(model)];
  // Сужение до общей формы: у каждого делегата Prisma эти методы есть, но их перегрузки не сводятся к одной сигнатуре.
  return delegate as unknown as ModelDelegate;
}
