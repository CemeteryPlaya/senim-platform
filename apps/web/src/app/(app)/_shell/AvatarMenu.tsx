"use client";

import { Check, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { useTransition } from "react";
import { ru } from "@/i18n/ru";
import { toast } from "@/kit";
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
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .slice(0, 2)
    .map((w) => w[0].toLocaleUpperCase("ru"))
    .join("");
}

// Пункт меню: высота 48 px; подсветка — фон line, кольцо фокуса с клавиатуры — общее (:focus-visible в app.css).
const itemClass =
  "flex min-h-control cursor-pointer select-none items-center gap-3 rounded-field px-3 text-body text-ink no-underline data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-line";

/**
 * Аватар в шапке компьютера с меню «Профиль», «Оформление» (Авто / Светлая / Тёмная) и «Выйти» (Radix DropdownMenu).
 * Оформление — три пункта-переключателя (menuitemradio) в группе, а не `ThemeSwitch`: Radix не пускает Tab внутрь меню,
 * и кнопки формы были бы недоступны с клавиатуры, а пункты меню ходят стрелками. Действие то же (`chooseTheme`: кука и
 * перерисовка layout); после выбора меню закрывается. Меню немодальное, как поповер: прокрутка
 * не блокируется, нажатие вне закрывает. Фон меню сплошной `raised` с тенью float — поверх полупрозрачной шапки
 * второй слой полупрозрачности не кладётся. Ошибка выхода (identity недоступен) — тостом.
 */
export function AvatarMenu({ fullName, theme = "system" }: { fullName: string | null; theme?: Theme }) {
  const [pending, startTransition] = useTransition();
  const initials = initialsOf(fullName);

  const signOut = () =>
    startTransition(async () => {
      const res = await logout({});
      if (!res.ok) toast.error(res.error);
    });

  const pick = (next: Theme) => startTransition(() => chooseTheme(next));

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label={t.profileMenu}
        className="inline-flex size-control shrink-0 cursor-pointer items-center justify-center rounded-full pressable"
      >
        <span aria-hidden className="inline-flex size-avatar items-center justify-center rounded-full bg-line text-small font-semibold text-ink">
          {initials ?? <UserRound className="size-5" />}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 min-w-56 rounded-card bg-raised p-2 text-body text-ink shadow-float outline-none"
        >
          {fullName && <DropdownMenu.Label className="px-3 py-2 text-sub text-muted">{fullName}</DropdownMenu.Label>}
          <DropdownMenu.Item asChild className={itemClass}>
            <Link href={to("/profile")}>
              <UserRound aria-hidden className="size-5 shrink-0" />
              {t.profile}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Label className="px-3 py-2 text-sub text-muted">{t.theme.legend}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup aria-label={t.theme.legend} value={theme} onValueChange={(value) => {
              const chosen = THEMES.find((option) => option.value === value);
              if (chosen) pick(chosen.value);
            }}>
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
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={itemClass} disabled={pending} onSelect={signOut}>
            <LogOut aria-hidden className="size-5 shrink-0" />
            {t.logout}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
