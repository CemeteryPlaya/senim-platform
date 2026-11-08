import { BadgeCheck } from "lucide-react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";
import { formatDate } from "./format";

const t = ru.common.ui.signed;

export type SignedBadgeProps = { signedAt: Date; documentNumber: string; className?: string };

/** «Договор подписан ЭЦП обеими сторонами», дата и номер документа (eGov). */
export function SignedBadge({ signedAt, documentNumber, className }: SignedBadgeProps) {
  return (
    <div className={cn("flex items-start gap-3 rounded-card bg-success-soft p-4 text-ink", className)}>
      <BadgeCheck aria-hidden className="mt-0.5 size-6 shrink-0 text-success" />
      <div className="min-w-0">
        <p className="text-base font-bold break-words text-success">{t.title}</p>
        <p className="text-sm text-ink-soft">{t.meta(formatDate(signedAt), documentNumber)}</p>
      </div>
    </div>
  );
}
