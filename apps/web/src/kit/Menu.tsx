"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState, type RefObject } from "react";
import type { Device } from "@/platform/device";
import { Button } from "./Button";
import { cn } from "./cn";
import { presence } from "./motion";
import { Sheet } from "./Sheet";

export type MenuItem = {
  label: string;
  /** Переход на другой экран (ссылка). */
  href?: string;
  /** Действие на экране. Если задан и `href`, срабатывает ссылка. */
  onSelect?: () => void;
  /** `danger` — необратимое или рискованное действие (цвет `danger`); подтверждайте его через `ConfirmDialog`. */
  tone?: "danger";
};

export type MenuProps = {
  /** Имя кнопки-триггера для диктора и заголовок шторки («Действия со сделкой»). */
  label: string;
  items: readonly MenuItem[];
  device: Device;
  /**
   * Ссылка на кнопку «три точки». Окно, открытое пунктом меню (`ConfirmDialog` без `trigger`), возвращает фокус
   * сюда: `returnFocusTo={triggerRef}`.
   */
  triggerRef?: RefObject<HTMLButtonElement | null>;
};

const ITEM_BASE = "flex w-full items-center text-left text-body no-underline";

const toneClass = (tone: MenuItem["tone"]): string => (tone === "danger" ? "text-danger" : "text-ink");

/**
 * Второстепенные действия экрана за кнопкой «три точки» (вид `quiet`). Телефон — шторка со списком, компьютер —
 * выпадающее меню Radix (стрелки, Enter, Home/End, поиск по первой букве, Esc, фокус возвращается на кнопку).
 * Не для главного действия экрана.
 */
export function Menu({ label, items, device, triggerRef }: MenuProps) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const trigger = (
    <Button ref={triggerRef} variant="quiet" flush aria-label={label} className="min-w-control">
      <Ellipsis aria-hidden className="size-6" />
    </Button>
  );

  if (device === "mobile") {
    return (
      <Sheet trigger={trigger} title={label} open={open} onOpenChange={setOpen}>
        <ul className="flex flex-col">
          {items.map((item, index) => {
            const className = cn(ITEM_BASE, "min-h-control rounded-field py-3 active:bg-line", toneClass(item.tone));
            return (
              <li key={`${index}-${item.label}`}>
                {item.href ? (
                  <Link href={item.href} className={className} onClick={() => setOpen(false)}>
                    {item.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={className}
                    onClick={() => {
                      setOpen(false);
                      item.onSelect?.();
                    }}
                  >
                    {item.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </Sheet>
    );
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <AnimatePresence>
        {open && (
          <DropdownMenu.Portal forceMount>
            <DropdownMenu.Content forceMount asChild align="end" side="bottom" sideOffset={8} collisionPadding={16} aria-label={label}>
              <motion.div
                className="z-50 min-w-56 origin-(--radix-dropdown-menu-content-transform-origin) rounded-card bg-raised p-2 text-body text-ink shadow-float outline-none"
                {...presence(reduced, { scale: 0.9 })}
              >
                {items.map((item, index) => {
                  const className = cn(ITEM_BASE, "min-h-control-sm cursor-pointer rounded-field px-4 py-2 outline-none data-highlighted:bg-line", toneClass(item.tone));
                  return (
                    <DropdownMenu.Item
                      key={`${index}-${item.label}`}
                      asChild
                      onSelect={() => {
                        if (!item.href) item.onSelect?.();
                      }}
                    >
                      {item.href ? (
                        <Link href={item.href} className={className}>
                          {item.label}
                        </Link>
                      ) : (
                        <button type="button" className={className}>
                          {item.label}
                        </button>
                      )}
                    </DropdownMenu.Item>
                  );
                })}
              </motion.div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </AnimatePresence>
    </DropdownMenu.Root>
  );
}
