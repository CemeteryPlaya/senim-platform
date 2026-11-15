"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState, type RefObject } from "react";
import type { Device } from "@/platform/device";
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
 * Кнопка «три точки» — круг 48 px. Телефон: круглая кнопка на стекле `glass-regular` (разбор 3.4, п. 4: плавает в
 * верхней строке экрана над содержимым; не кладите её на другое стекло — например, в шапку переписки). Компьютер: без
 * материала, при наведении — заливка fill.
 */
const TRIGGER: Record<Device, string> = {
  mobile: "glass-regular",
  desktop: "hover:bg-fill",
};

/**
 * Второстепенные действия экрана за кнопкой «три точки». Телефон — шторка со списком, компьютер — выпадающее меню
 * Radix (стрелки, Enter, Home/End, поиск по первой букве, Esc, фокус возвращается на кнопку) на толстом стекле
 * `glass-thick`: появляется из кнопки (transform-origin — точка триггера) масштабом 0,96 → 1 и проявлением, пружина без
 * отскока, закрывается тем же путём; при `prefers-reduced-motion` — только проявление. Не для главного действия экрана.
 */
export function Menu({ label, items, device, triggerRef }: MenuProps) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      aria-label={label}
      className={cn("inline-flex size-control min-h-control shrink-0 cursor-pointer items-center justify-center rounded-full text-ink pressable", TRIGGER[device])}
    >
      <Ellipsis aria-hidden className="size-6" strokeWidth={1.75} />
    </button>
  );

  if (device === "mobile") {
    return (
      <Sheet trigger={trigger} title={label} open={open} onOpenChange={setOpen}>
        <ul className="flex flex-col">
          {items.map((item, index) => {
            const className = cn(ITEM_BASE, "min-h-control rounded-field px-3 py-3 active:bg-fill-strong", toneClass(item.tone));
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
                className="glass-thick z-50 min-w-56 origin-(--radix-dropdown-menu-content-transform-origin) rounded-card p-2 text-body text-ink outline-none"
                {...presence(reduced, { scale: 0.96 })}
              >
                {items.map((item, index) => {
                  const className = cn(ITEM_BASE, "min-h-control-sm cursor-pointer rounded-field px-4 py-2 outline-none data-highlighted:bg-fill-strong", toneClass(item.tone));
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
