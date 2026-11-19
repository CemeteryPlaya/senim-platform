import { ru } from "@/i18n/ru";
import { Card, Section } from "@/kit";

const t = ru.app.masterRequests.howTo;

/**
 * «Как взять заказ»: четыре шага от новой заявки до начала работы, нумерованным списком. Главного действия у блока нет.
 * `beforeApproval` — экран статуса проверки: над шагами строка о том, что заявки откроются после проверки.
 */
export function HowToTakeOrder({ beforeApproval }: { beforeApproval: boolean }) {
  return (
    <Section title={t.title}>
      <Card>
        {beforeApproval && <p className="mb-4 text-body text-muted">{t.beforeApproval}</p>}
        <ol className="flex list-decimal flex-col gap-3 pl-6 text-body text-ink">
          {t.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Card>
    </Section>
  );
}
