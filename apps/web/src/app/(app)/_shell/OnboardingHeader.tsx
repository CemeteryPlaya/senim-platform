import { ru } from "@/i18n/ru";
import { Progress } from "@/kit";

const t = ru.app.onboarding;

type Props = {
  /** Место экрана в последовательности анкеты (onboardingPosition). */
  step: number;
  total: number;
  title: string;
};

/**
 * Шапка экрана анкеты после входа (согласие, ФИО и ИИН, почта): «Анкета: шаг N из 3», полоса и единственный `<h1>`.
 * Счётчик только здесь: на входе (роль, телефон, код) его нет. «Назад» на шагах анкеты нет, а на входе над заголовком
 * стоит строка «Назад»: чтобы при переходе от кода входа к анкете содержимое не прыгало вверх, на компьютере счётчик
 * стоит в строке той же высоты (36 px, как у «Назад»). Серверный компонент.
 */
export function OnboardingHeader({ step, total, title }: Props) {
  const current = Math.min(Math.max(Math.round(step) || 1, 1), total);
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center desktop:min-h-control-sm">
        <p className="text-sub text-muted">{t.step(current, total)}</p>
      </div>
      <Progress value={current} max={total} label={t.progressLabel} />
      <h1 className="mt-2 text-title text-ink">{title}</h1>
    </header>
  );
}
