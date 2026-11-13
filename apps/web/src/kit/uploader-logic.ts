/** Чистая логика загрузчика фото (Uploader): отбор выбранных файлов и ход загрузки. Без React и браузера — проверяется юнит-тестами. */

type Named = { name: string; type: string };

/**
 * Подходит ли файл под `accept` input (список через запятую: «image/*», «image/jpeg», «.heic»). Пустой `accept` —
 * подходит любой.
 */
export function matchesAccept(file: Named, accept: string | undefined): boolean {
  const rules = (accept ?? "")
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/**
 * Файлы, которые уйдут в `onAdd`: подходящие под `accept`, не больше свободных мест (`max` минус уже добавленные).
 * Лишние отбрасываются молча: кнопка при заполнении отключена, а перетаскивание — единственный путь за предел.
 */
export function takeFiles<T extends Named>(files: readonly T[], taken: number, max: number, accept?: string): T[] {
  const free = Math.max(0, max - taken);
  return files.filter((file) => matchesAccept(file, accept)).slice(0, free);
}

/** Целые проценты 0–100 из хода загрузки (доля 0–100); не число — `null` (ход неизвестен, показываем пульсацию). */
export function progressPercent(progress: number | undefined): number | null {
  if (progress === undefined || !Number.isFinite(progress)) return null;
  return Math.round(Math.min(100, Math.max(0, progress)));
}

/** Разбор выбранных файлов: принятые, отброшенные по типу и отброшенные сверх предела (в порядке выбора). */
export function sortFiles<T extends Named>(
  files: readonly T[],
  taken: number,
  max: number,
  accept?: string,
): { accepted: T[]; wrongType: T[]; overLimit: T[] } {
  const free = Math.max(0, max - taken);
  const fit = files.filter((file) => matchesAccept(file, accept));
  return {
    accepted: fit.slice(0, free),
    wrongType: files.filter((file) => !matchesAccept(file, accept)),
    overLimit: fit.slice(free),
  };
}
