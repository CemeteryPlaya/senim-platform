import Link from "next/link";
import { ru } from "@/i18n/ru";

/** Подвал в одну строку: название и ссылка «Как работает Сенім» (шаги и принцип денег — на /about). */
export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      {/* Снизу запас под нижнюю панель вкладок телефона (--tabbar-h; на широком экране 0). */}
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 pt-4 pb-[calc(var(--tabbar-h)+1rem)] sm:px-6">
        <p className="text-base font-bold text-ink">{ru.common.brand}</p>
        <Link href="/about" className="inline-flex min-h-control-sm items-center text-base font-semibold text-primary underline underline-offset-4">
          {ru.common.shell.about}
        </Link>
      </div>
    </footer>
  );
}
