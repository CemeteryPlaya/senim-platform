import { ru } from "@/i18n/ru";
import { BackLink, type BackLinkProps } from "./BackLink";
import { Progress } from "./Progress";

export type WizardHeaderProps = {
  step: number;
  total: number;
  title: string;
  back?: BackLinkProps;
  /** Уровень заголовка: 1 по умолчанию; 2 — когда на странице `<h1>` уже есть (образец в витрине). */
  headingLevel?: 1 | 2;
};

/** Шапка шага мастера: «Шаг N из M», полоса и единственный `<h1>` экрана (PageTitle рядом не нужен). */
export function WizardHeader({ step, total, title, back, headingLevel = 1 }: WizardHeaderProps) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  const t = ru.app.kit.wizard;
  const hasSteps = Number.isFinite(total) && total > 0;
  const current = hasSteps ? Math.min(Math.max(Math.round(step) || 1, 1), total) : 0;
  return (
    <header className="flex flex-col gap-2">
      {back && <BackLink {...back} />}
      {hasSteps && (
        <>
          <p className="text-sub text-muted">{t.step(current, total)}</p>
          <Progress value={current} max={total} label={t.progressLabel} />
        </>
      )}
      <Heading className="mt-2 text-title text-ink">{title}</Heading>
    </header>
  );
}
