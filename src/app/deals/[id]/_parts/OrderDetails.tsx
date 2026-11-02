import type { DealView } from "@/modules/deal-core";
import { requestDetailsSchema } from "@/modules/requests/client";
import { ru } from "@/i18n/ru";
import { Card } from "@/ui";
import { detailRows, FactList } from "@/app/requests/_parts/RequestFacts";

const t = ru.deal;

/**
 * «Детали заказа» (макет 10, экран 3): что делаем, стиль, размеры, материалы — из заявки, теми же строками,
 * что на экранах заявки. Разбирает их модуль requests; если данных нет — короткая отсылка к договору.
 */
export function OrderDetails({ deal }: { deal: DealView }) {
  const parsed = requestDetailsSchema.safeParse(deal.subject.details);
  const rows = parsed.success ? detailRows({ title: deal.title, style: deal.subject.style, details: parsed.data }) : [];
  return (
    <Card as="section" title={t.sections.details}>
      {rows.length > 0 ? <FactList rows={rows} /> : <p className="text-base text-muted">{t.view.noDetails}</p>}
    </Card>
  );
}
