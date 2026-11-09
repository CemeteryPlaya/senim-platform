import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Мятная плашка «деньги под защитой» (макет b-plus-a): значок щита и короткий текст. Текст — от вызывающего.
 * Узкая плашка (уже 14em — например, 320 px или 390 px при шрифте 200 %): значок над текстом, чтобы колонка значка
 * не сжимала текст до переносов посреди слова.
 */
export function TrustNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="note" className={cn("@container/trust rounded-card bg-accent-soft p-4 text-base text-ink", className)}>
      <div className="flex flex-col items-start gap-2 @[14em]/trust:flex-row @[14em]/trust:gap-3">
        <ShieldCheck aria-hidden className="size-6 shrink-0 text-primary @[14em]/trust:mt-0.5" />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
