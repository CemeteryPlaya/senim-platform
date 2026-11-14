import { ru } from "@/i18n/ru";
import { MoneyPanel, Stack } from "@/kit";
import type { Device } from "@/platform/device";
import type { MoneyView } from "./request-view";

const t = ru.app.masterOffer.money;

/**
 * Смета мастера: «Вы получите» крупно, цена, «Гарантия оплаты и клиента (4%)» с пояснением, итог. Суммы приходят готовыми
 * (из модуля или из живого расчёта формы): здесь ничего не считается. Без обработчиков — годится и серверному экрану,
 * и клиентской форме.
 */
export function MasterMoney({ money, device }: { money: MoneyView; device: Device }) {
  const explain = {
    label: t.explain.label,
    title: t.explain.title,
    body: (
      <Stack>
        {t.explain.paragraphs.map((text) => (
          <p key={text} className="text-body text-ink">
            {text}
          </p>
        ))}
      </Stack>
    ),
  };
  return (
    <MoneyPanel
      tone="awaiting"
      title={money.title}
      amount={money.amountTiyn}
      rows={money.rows.map((row) => ({
        label: row.label,
        amount: row.amountTiyn,
        ...(row.total ? { total: true } : {}),
        ...(row.explain ? { explain } : {}),
      }))}
      note={t.note}
      device={device}
    />
  );
}
