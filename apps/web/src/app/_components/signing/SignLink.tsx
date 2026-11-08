"use client";

import type { ReactNode } from "react";
import { buttonClasses, type ButtonVariant } from "@/ui";
import { signingAnchorId, signingTitleId } from "./anchors";

export type SignLinkProps = {
  documentId: string;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  icon?: ReactNode;
  children: ReactNode;
};

/**
 * «Подписать оферту / акт»: переход к панели подписи на этом же экране. Браузер прокручивает к якорю,
 * но фокус не переводит — ставим его на заголовок панели, иначе Tab продолжит от кнопки, а диктор промолчит.
 */
export function SignLink({ documentId, variant = "primary", fullWidth = false, icon, children }: SignLinkProps) {
  return (
    <a
      href={`#${signingAnchorId(documentId)}`}
      className={buttonClasses({ variant, fullWidth })}
      // Как у Button: заливная главная кнопка помечена для проверки «одно главное действие на экране».
      data-primary-action={variant === "primary" ? true : undefined}
      onClick={() => requestAnimationFrame(() => document.getElementById(signingTitleId(documentId))?.focus({ preventScroll: true }))}
    >
      {icon && (
        <span aria-hidden className="inline-flex shrink-0 [&_svg]:size-5">
          {icon}
        </span>
      )}
      <span>{children}</span>
    </a>
  );
}
