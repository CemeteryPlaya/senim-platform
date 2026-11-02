import { ru } from "@/i18n/ru";
import { getDealPortfolioPanel } from "@/modules/companies";
import type { CurrentUser } from "@/modules/identity";
import { ButtonLink, Card } from "@/ui";
import { ConsentForm } from "./ConsentForm";

const t = ru.companies.dealPortfolio.panel;

/**
 * Блок «Фото в портфолио» на экране завершённой сделки (встреча 31.10, п. 3).
 * Заказчику — галочка согласия (дать или отозвать), исполнителю — «Добавить в портфолио» или ссылка на работу.
 * Остальным и до завершения сделки — ничего.
 *
 * Использование: `<DealPortfolioPanel user={user} dealId={deal.id} />` на странице сделки.
 */
export async function DealPortfolioPanel({ user, dealId }: { user: CurrentUser; dealId: string }) {
  const panel = await getDealPortfolioPanel(user, dealId);
  if (!panel) return null;

  if (panel.viewer === "CLIENT") {
    return (
      <Card as="section" title={t.title} description={t.clientText}>
        <ConsentForm dealId={dealId} consent={panel.consent} />
      </Card>
    );
  }

  return (
    <Card as="section" title={t.title} description={panel.itemId ? undefined : t.executorText}>
      <div className="flex flex-col gap-4">
        <p className="text-base text-ink">{panel.consent ? t.consentOk : t.waitingConsent}</p>
        {panel.itemId ? (
          <ButtonLink href={`/executor/portfolio/${panel.itemId}`} variant="secondary" fullWidth>
            {t.executorOpen}
          </ButtonLink>
        ) : panel.photos > 0 ? (
          <ButtonLink href={`/executor/portfolio/from-deal/${dealId}`} variant="secondary" fullWidth>
            {t.executorAdd}
          </ButtonLink>
        ) : (
          <p className="text-base text-muted">{t.noPhotos}</p>
        )}
      </div>
    </Card>
  );
}
