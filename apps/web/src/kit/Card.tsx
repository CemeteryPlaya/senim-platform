import type { ReactNode } from "react";
import { cn } from "./cn";

export type CardProps = {
  as?: "div" | "section" | "article" | "li";
  /** Внутренний отступ 16 px; `false` — когда внутри списки или фото во всю ширину. */
  padded?: boolean;
  className?: string;
  children?: ReactNode;
};

/** Белая карточка на сером фоне: без рамки и тени, радиус 18 px. */
export function Card({ as: Tag = "div", padded = true, className, children }: CardProps) {
  return <Tag className={cn("rounded-card bg-surface", padded && "p-4", className)}>{children}</Tag>;
}
