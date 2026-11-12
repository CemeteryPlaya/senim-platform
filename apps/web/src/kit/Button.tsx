import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonClasses, primaryMark, type StyleOptions } from "./button-styles";
import { cn } from "./cn";

export { Button } from "./ButtonBase";
export type { ButtonProps } from "./ButtonBase";
export { buttonClasses } from "./button-styles";
export type { ButtonSize, ButtonVariant } from "./button-styles";

export type ButtonLinkProps = ComponentProps<typeof Link> & StyleOptions;

/** Ссылка, которая выглядит как кнопка (переход на другой экран). Серверный компонент. */
export function ButtonLink({ variant, size, full, className, ...rest }: ButtonLinkProps) {
  return (
    <Link
      className={cn(buttonClasses({ variant, size, full }), className)}
      data-primary-action={primaryMark(variant)}
      {...rest}
    />
  );
}
