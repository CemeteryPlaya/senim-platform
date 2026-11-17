// Вью-модель экрана «Лучшие работы»: порядок и отметки без React и сервера.

export type BestRef = { kind: "work" | "deal"; id: string };

export const refKey = (r: BestRef): string => `${r.kind}:${r.id}`;

/** Выбранные по сохранённой позиции. */
export function initialSelected(candidates: { kind: "work" | "deal"; id: string; selected: boolean; position: number | null }[]): BestRef[] {
  return candidates
    .filter((c) => c.selected)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(({ kind, id }) => ({ kind, id }));
}

export const isFull = (selected: readonly BestRef[], max: number): boolean => selected.length >= max;

/** Отметка: снимает выбранную, иначе добавляет в конец; сверх предела набор не меняется (тот же массив). */
export function toggleRef(selected: BestRef[], ref: BestRef, max: number): BestRef[] {
  const key = refKey(ref);
  if (selected.some((s) => refKey(s) === key)) return selected.filter((s) => refKey(s) !== key);
  if (isFull(selected, max)) return selected;
  return [...selected, ref];
}

/** Стрелка: меняет с соседом; на краю — тот же массив. */
export function moveRef(selected: BestRef[], index: number, direction: "up" | "down"): BestRef[] {
  const to = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= selected.length || to < 0 || to >= selected.length) return selected;
  const next = [...selected];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}
