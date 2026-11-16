"use client";

import { Menu as MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, cn, Sheet } from "@/kit";
import { activeHref, operatorItems, type NavItem, type OperatorNav } from "./nav";
import { NAV_ICONS } from "./nav-icons";

const t = ru.app.operator;

/**
 * Пункт меню оператора: значок 20 px и подпись 17 px; на компьютере строка 36 px (второстепенный элемент компьютера), на
 * телефоне — 48 px. Открытый раздел — заливка `fill-strong`, вес 600 и `aria-current="page"` (не одним цветом).
 */
function Item({ item, current, onNavigate }: { item: NavItem; current: string | undefined; onNavigate?: () => void }) {
  const Icon = NAV_ICONS[item.icon];
  const active = item.href === current;
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-control items-center gap-3 rounded-field px-3 text-body text-ink no-underline desktop:min-h-control-sm",
          active ? "bg-fill-strong font-semibold" : "hover:bg-fill",
        )}
      >
        <Icon aria-hidden className={cn("size-5 shrink-0", active ? "text-ink" : "text-muted")} strokeWidth={1.75} />
        <span className="min-w-0 wrap-break-word">{item.label}</span>
      </Link>
    </li>
  );
}

/**
 * Список разделов оператора: главная, три группы с подписями («Очереди», «Сделки и отчёты», «Справочники и настройки»),
 * профиль. Подпись группы — текст, связанный со списком (`aria-labelledby`), а не заголовок: меню стоит перед `<h1>` экрана.
 * Открытый раздел — самый точный по адресу; главная подсвечена только на самой главной (разделы лежат под её адресом).
 * `onNavigate` — выбран пункт (шторка телефона закрывается).
 */
export function OperatorNavList({ nav, onNavigate }: { nav: OperatorNav; onNavigate?: () => void }) {
  const current = activeHref(operatorItems(nav), usePathname(), [nav.home.href]);
  const ids = useId();
  return (
    <nav aria-label={t.navLabel} className="flex flex-col gap-4">
      <ul>
        <Item item={nav.home} current={current} onNavigate={onNavigate} />
      </ul>
      {nav.groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          <p id={`${ids}-${group.key}`} className="px-3 text-sub font-medium text-muted">
            {group.label}
          </p>
          <ul aria-labelledby={`${ids}-${group.key}`}>
            {group.items.map((item) => (
              <Item key={item.href} item={item} current={current} onNavigate={onNavigate} />
            ))}
          </ul>
        </div>
      ))}
      <ul>
        <Item item={nav.profile} current={current} onNavigate={onNavigate} />
      </ul>
    </nav>
  );
}

/**
 * «Меню» оператора на телефоне (спека, раздел 5): тихая кнопка в шапке открывает шторку со всеми разделами по группам;
 * выбор раздела закрывает шторку. Фокус при закрытии возвращается на кнопку (Sheet).
 */
export function OperatorMenu({ nav }: { nav: OperatorNav }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t.menu}
      trigger={
        <Button variant="quiet" size="sm">
          {/* Значок и подпись в одну строку: подпись кнопки kit — внутри span, а svg по умолчанию блочный. */}
          <span className="inline-flex items-center gap-2">
            <MenuIcon aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
            {t.menu}
          </span>
        </Button>
      }
    >
      <OperatorNavList nav={nav} onNavigate={() => setOpen(false)} />
    </Sheet>
  );
}
