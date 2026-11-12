import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ru } from "@/i18n/ru";
import { Progress } from "./Progress";

export type WizardHeaderProps = {
  step: number;
  total: number;
  title: string;
  back?: { href: string; label: string };
};

/** Шапка шага мастера: «Шаг N из M», полоса и единственный `<h1>` экрана (PageTitle рядом не нужен). */
export function WizardHeader({ step, total, title, back }: WizardHeaderProps) {
  const t = ru.app.kit.wizard;
  return (
    <header className="flex flex-col gap-2">
      {back && (
        <Link
          href={back.href}
          className="-ml-1 inline-flex min-h-control w-fit items-center gap-1 text-body font-medium text-accent no-underline"
        >
          <ChevronLeft aria-hidden className="size-5" />
          {back.label}
        </Link>
      )}
      <p className="text-sub text-muted">{t.step(step, total)}</p>
      <Progress value={step} max={total} label={t.progressLabel} />
      <h1 className="mt-2 text-title text-ink">{title}</h1>
    </header>
  );
}
