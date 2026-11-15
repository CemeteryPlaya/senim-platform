"use client";

import { Check, LogOut, UserRound } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { useRef, useState, useTransition } from "react";
import { ru } from "@/i18n/ru";
import { Monogram, monogramOf, presence, toast } from "@/kit";
import type { Theme } from "@/kit/theme";
import { to } from "./paths";
import { logout } from "./session-actions";
import { chooseTheme } from "./theme-actions";

const t = ru.app.shell;

const THEMES: readonly { value: Theme; label: string }[] = [
  { value: "system", label: t.theme.system },
  { value: "light", label: t.theme.light },
  { value: "dark", label: t.theme.dark },
];

/** Инициалы для аватара: первые буквы двух первых слов имени («Айгерим Сапарова» → «АС»); без имени — null. */
export function initialsOf(fullName: string | null): string | null {
  return monogramOf(fullName);
}

/** Зазор между нижним краем шапки и меню. */
const GAP = 8;

/**
 * Отступ меню от аватара так, чтобы меню начиналось ниже стекла шапки (`data-top-bar`), а не наползало на него:
 * стекло на стекле не кладётся. Без шапки (витрина, тест) — обычный зазор.
 */
function offsetBelowBar(trigger: HTMLElement | null): number {
  const bar = trigger?.closest("[data-top-bar]");
  if (!trigger || !bar) return GAP;
  return Math.max(GAP, bar.getBoundingClientRect().bottom - trigger.getBoundingClientRect().bottom + GAP);
}

// Пункт меню: высота 48 px; подсветка — заливка fill-strong (ink на ней ≥ 4,5:1), кольцо фокуса с клавиатуры — общее
// (:focus-visible в app.css).
const itemClass =
  "flex min-h-control cursor-pointer select-none items-center gap-3 rounded-field px-3 text-body text-ink no-underline outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-fill-strong";

/**
 * Аватар-монограмма в шапке компьютера с меню «Профиль», «Оформление» (Авто / Светлая / Тёмная) и «Выйти» (Radix
 * DropdownMenu). Оформление — три пункта-переключателя (menuitemradio) в группе, а не `ThemeSwitch`: Radix не пускает
 * Tab внутрь меню, и кнопки формы были бы недоступны с клавиатуры, а пункты меню ходят стрелками. Действие то же
 * (`chooseTheme`: кука и перерисовка layout); после выбора меню закрывается. Меню немодальное, как поповер: прокрутка
 * не блокируется, нажатие вне закрывает. Ошибка выхода (identity недоступен) — тостом.
 *
 * Материал — толстое стекло `glass-thick` (разбор 3.4); подписи групп на нём — `glass-secondary`, а не muted. Меню
 * открывается ниже стекла шапки (`offsetBelowBar`), а не поверх него: никогда стекло на стекле. Появляется из
 * аватара (transform-origin — точка триггера) масштабом 0,96 → 1 и проявлением, пружина без отскока; закрывается тем
 * же путём; при `prefers-reduced-motion` — только проявление.
 */
export function AvatarMenu({ fullName, theme = "system" }: { fullName: string | null; theme?: Theme }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(GAP);
  const trigger = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion() ?? false;

  const signOut = () =>
    startTransition(async () => {
      const res = await logout({});
      if (!res.ok) toast.error(res.error);
    });

  const pick = (next: Theme) => startTransition(() => chooseTheme(next));

  return (
    <DropdownMenu.Root
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (next) setOffset(offsetBelowBar(trigger.current));
        setOpen(next);
      }}
    >
      <DropdownMenu.Trigger
        ref={trigger}
        aria-label={t.profileMenu}
        className="inline-flex size-control shrink-0 cursor-pointer items-center justify-center rounded-full pressable"
      >
        <Monogram name={fullName} />
      </DropdownMenu.Trigger>
      <AnimatePresence>
        {open && (
          <DropdownMenu.Portal forceMount>
            <DropdownMenu.Content forceMount asChild align="end" sideOffset={offset} collisionPadding={16}>
              <motion.div
                className="glass-thick z-50 min-w-56 origin-(--radix-dropdown-menu-content-transform-origin) rounded-card p-2 text-body text-ink outline-none"
                {...presence(reduced, { scale: 0.96 })}
              >
                {fullName && <DropdownMenu.Label className="px-3 py-2 text-sub text-glass-secondary">{fullName}</DropdownMenu.Label>}
                <DropdownMenu.Item asChild className={itemClass}>
                  <Link href={to("/profile")}>
                    <UserRound aria-hidden className="size-5 shrink-0" />
                    {t.profile}
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-fill-strong" />
                <DropdownMenu.Label className="px-3 py-2 text-sub text-glass-secondary">{t.theme.legend}</DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  aria-label={t.theme.legend}
                  value={theme}
                  onValueChange={(value) => {
                    const chosen = THEMES.find((option) => option.value === value);
                    if (chosen) pick(chosen.value);
                  }}
                >
                  {THEMES.map((option) => (
                    <DropdownMenu.RadioItem key={option.value} value={option.value} className={itemClass}>
                      <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center">
                        <DropdownMenu.ItemIndicator>
                          <Check className="size-5" />
                        </DropdownMenu.ItemIndicator>
                      </span>
                      {option.label}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
                <DropdownMenu.Separator className="my-1 h-px bg-fill-strong" />
                <DropdownMenu.Item className={itemClass} disabled={pending} onSelect={signOut}>
                  <LogOut aria-hidden className="size-5 shrink-0" />
                  {t.logout}
                </DropdownMenu.Item>
              </motion.div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </AnimatePresence>
    </DropdownMenu.Root>
  );
}
