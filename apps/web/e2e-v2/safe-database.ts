/**
 * Проверка базы перед пересевом набора `flows` (reseed.setup.ts): пересев стирает данные, поэтому годится только база
 * нового интерфейса — имя ровно `senim_v2web_<строчные буквы, цифры, _>`. Любая другая (senim, senim_test, senim_e2e),
 * имя с `/`, `..`, процентным кодом или в другом регистре, а также параметр адреса, которым драйвер мог бы подменить базу
 * (`?database=`, `?dbname=`), — отказ до первого запроса.
 */

const SAFE_DATABASE_PREFIX = "senim_v2web_";
const SAFE_NAME = /^senim_v2web_[a-z0-9_]+$/;
/** Параметры адреса, которыми драйверы задают базу в обход пути. */
const DATABASE_PARAMS = ["database", "dbname", "db"];

/** Имя базы из адреса или ошибка с понятным текстом. */
export function assertSafeDatabase(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("E2E_DATABASE_URL не разобрать как адрес базы: пересев не выполняется.");
  }
  const name = parsed.pathname.replace(/^\/+/, "");
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      `Пересев отказан: база «${name || "(без имени)"}» — не «${SAFE_DATABASE_PREFIX}…» строчными буквами. Набор flows работает только на базе нового интерфейса (например, ${SAFE_DATABASE_PREFIX}e2e).`,
    );
  }
  for (const key of parsed.searchParams.keys()) {
    if (DATABASE_PARAMS.includes(key.toLowerCase())) {
      throw new Error(`Пересев отказан: параметр «${key}» в E2E_DATABASE_URL может подменить базу.`);
    }
  }
  return name;
}
