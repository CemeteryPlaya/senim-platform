import { ru } from "@/i18n/ru";

/** Подвал: название и главный принцип денег — напрямую исполнителю. */
export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      {/* Снизу запас под нижнюю панель вкладок телефона. */}
      <div className="mx-auto flex max-w-page flex-col gap-2 px-4 pt-8 pb-32 sm:px-6 lg:pb-8">
        <p className="text-lg font-bold text-ink">{ru.common.brand}</p>
        <p className="max-w-prose text-sm text-muted">{ru.common.shell.footerNote}</p>
      </div>
    </footer>
  );
}
