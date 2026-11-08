import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

/** Мятная плашка «деньги под защитой» (макет b-plus-a): значок щита и короткий текст. Текст — от вызывающего. */
export function TrustNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="note" className={cn("flex items-start gap-3 rounded-card bg-accent-soft p-4 text-base text-ink", className)}>
      <ShieldCheck aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
