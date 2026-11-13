import type { ReactNode } from "react";

export type ColumnsProps = { count: 2 | 3; children: ReactNode };

/** Полные имена классов: Tailwind собирает только то, что записано целиком. */
const COLUMNS = { 2: "desktop:grid-cols-2", 3: "desktop:grid-cols-3" } as const;

/**
 * Ряд равных колонок: на компьютере сетка из `count` колонок с зазором группы (12 px), дети растянуты по высоте ряда
 * (карточки одной высоты); на телефоне одна колонка. Для карточек одного уровня — три шага, пара тарифов. Серверный
 * компонент.
 */
export function Columns({ count, children }: ColumnsProps) {
  return (
    <div className={`flex min-w-0 flex-col gap-stack-group *:min-w-0 desktop:grid desktop:items-stretch ${COLUMNS[count]}`}>{children}</div>
  );
}
