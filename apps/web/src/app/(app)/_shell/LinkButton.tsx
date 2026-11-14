"use client";

import { ChevronRight } from "lucide-react";
import { Button, type ButtonProps } from "@/kit";

/**
 * Второстепенное действие под карточкой «Сейчас»: тихая кнопка по левой линии с шевроном — видно, что нажимается, и не
 * спорит с главной кнопкой. Сама кнопка — открыватель окна (шторка / диалог), поэтому не ссылка `TextLink`.
 */
export function LinkButton({ label, ...rest }: { label: string } & Omit<ButtonProps, "children" | "variant" | "flush">) {
  return (
    <Button variant="quiet" flush {...rest}>
      {/* Подпись кнопки kit — строчный span, а svg блочный: без строчного flex шеврон уехал бы на вторую строку. */}
      <span className="inline-flex items-center gap-1">
        {label}
        <ChevronRight aria-hidden className="size-4 shrink-0" />
      </span>
    </Button>
  );
}
