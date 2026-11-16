"use client";

import { ru } from "@/i18n/ru";
import { Card, List, ListRow, PhotoSlot, Section } from "@/kit";
import { useActionForm } from "../../../_shell/form";
import { submitRequestAction } from "./actions";
import { WizardFrame, type WizardBase, type WizardForm } from "./WizardFrame";
import { forgetDraft } from "./wizard-memory";
import type { SummaryRow } from "./steps";

const t = ru.app.requests.wizard;
/** Полей у последнего шага нет — и проверять в браузере нечего. */
const NO_ERRORS: Record<string, string> = {};

type Props = {
  base: WizardBase & { draftId: string };
  rows: SummaryRow[];
  photos: readonly { id: string; src: string }[];
  footnote: string;
};

/**
 * Шаг 5 «Проверьте заявку»: сводка (что, стиль и размеры, уровень, фото, адрес, срок) — каждая строка ведёт на свой шаг;
 * главное действие «Отправить мастерам» (прямой заявке — «Отправить мастеру»). После отправки — карточка заявки с
 * отметкой «отправлена». Повторное нажатие гасит форма, повтор запроса — действие (та же заявка).
 */
export function WizardSend({ base, rows, photos, footnote }: Props) {
  const action = useActionForm(submitRequestAction, {
    toInput: () => {
      // Заявка уходит целиком: несохранённый ввод её шагов больше не нужен.
      forgetDraft(base.draftId);
      return { requestId: base.draftId };
    },
  });
  const form: WizardForm = { pending: action.pending, error: action.error, errors: NO_ERRORS, onSubmit: action.onSubmit };
  const direct = base.direct !== null;
  return (
    <WizardFrame
      base={base}
      title={t.send.title}
      lead={direct ? t.send.leadDirect : t.send.lead}
      form={form}
      submitLabel={direct ? t.submitDirect : t.submit}
      footer={footnote ? <p className="text-sub text-muted">{footnote}</p> : undefined}
    >
      <Section title={t.send.summaryTitle}>
        <Card padded={false}>
          <List>
            {rows.map((row) => (
              <ListRow
                key={row.label}
                stacked
                href={row.href}
                label={row.label}
                value={
                  row.label === t.send.photos && photos.length > 0 ? (
                    <span className="flex flex-col gap-2">
                      <span>{row.value}</span>
                      <span className="grid grid-cols-4 gap-2">
                        {photos.map((photo, i) => (
                          <PhotoSlot key={photo.id} src={photo.src} alt={ru.requests.wizard.room.photoAlt(i + 1)} ratio="1/1" />
                        ))}
                      </span>
                    </span>
                  ) : (
                    row.value
                  )
                }
              />
            ))}
          </List>
        </Card>
      </Section>
    </WizardFrame>
  );
}
