"use client";

import { createContext, useContext, type ReactNode } from "react";

const TitleActionContext = createContext<ReactNode>(null);

/**
 * Действие оболочки в строке заголовка экрана (колокольчик на корневых экранах вкладок телефона): оболочка кладёт его
 * сюда, а `PageTitle` (или `WizardHeader`) ставит справа от `<h1>` — без отдельной верхней строки над заголовком.
 * `action` — `null`: в строке заголовка ничего нет. Клиентский компонент (контекст).
 */
export function TitleActionProvider({ action, children }: { action: ReactNode; children: ReactNode }) {
  return <TitleActionContext.Provider value={action}>{children}</TitleActionContext.Provider>;
}

/** Действие оболочки для строки заголовка (`TitleActionProvider`) в обёртке `className`; нет действия — ничего. */
export function TitleAction({ className }: { className: string }) {
  const action = useContext(TitleActionContext);
  if (action === null || action === undefined || action === false) return null;
  return <div className={className}>{action}</div>;
}
