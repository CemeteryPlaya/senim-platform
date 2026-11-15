import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

/**
 * «Капсула доверия» поверх фото (лендинг): стекло `glass-clear` — белый текст 600 и значок щита. Ставится только на
 * фото с затемнением под ней (`scrim-photo` или `scrim-hero`): без затемнения белый на светлом фото не читается.
 * Текст, а не кнопка: нажатия нет. Серверный компонент.
 */
export function TrustCapsule({ children }: { children: ReactNode }) {
  return (
    <p className="glass-clear inline-flex min-h-control w-fit max-w-full items-center gap-2 rounded-chip px-4 py-2 text-sub desktop:text-body">
      <ShieldCheck aria-hidden className="size-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
