import { ru } from "@/i18n/ru";
import { Card, List, ListItem, MoneyPanel, Narrow, PageTitle, Section, Stack, Timeline, type TimelineItem } from "@/kit";
import type { Device } from "@/platform/device";
import type { MoneyView } from "../_parts/deal-card";
import { ShareButton } from "./ShareButton";
import type { OperationRow } from "./money-view";

const t = ru.app.deal.money;
const card = ru.app.deal.card;

export type MoneyDocument = { id: string; name: string; status: string; href: string; shareable: boolean; statement: boolean };

export type MoneyHistoryModel = {
  dealTitle: string;
  backHref: string;
  number: number;
  money: MoneyView;
  operations: OperationRow[];
  documents: MoneyDocument[];
};

/** Документы-основания: подпись — какая операция и когда (ссылка без этого безымянна). */
function Basis({ rows }: { rows: OperationRow[] }) {
  const withBasis = rows.filter((row) => row.basis);
  if (withBasis.length === 0) return null;
  return (
    <Section title={t.basisSection}>
      <Card padded={false}>
        <List>
          {withBasis.map((row) => (
            <ListItem key={row.id}>
              <a
                href={row.basis?.href}
                target="_blank"
                rel="noopener"
                className="flex min-h-control w-full items-center justify-between gap-4 px-4 py-3 text-body text-ink no-underline hover:bg-canvas"
              >
                <span className="min-w-0 wrap-break-word">{t.basisLabel(row.title, row.time)}</span>
                <span className="shrink-0 font-medium">{t.basisOpen}</span>
              </a>
            </ListItem>
          ))}
        </List>
      </Card>
    </Section>
  );
}

/**
 * История денег: блок денег (тот же вид, что на карточке сделки, из журнала), операции журнала лентой — свежие сверху,
 * документы-основания, выписка и акт («Открыть» и «Поделиться»). Главного действия на экране нет: он справочный.
 */
export function MoneyHistoryView({ model, device }: { model: MoneyHistoryModel; device: Device }) {
  const m = model.money;
  const e = card.money.explain;
  const items: TimelineItem[] = model.operations.map((row) => ({
    title: row.title,
    time: row.time,
    amount: row.amount,
    ...(row.text ? { text: row.text } : {}),
  }));
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={{ href: model.backHref, label: model.dealTitle }} lead={t.lead(model.number)} />
        <MoneyPanel
          tone={m.tone}
          title={m.title}
          amount={m.amount}
          rows={m.rows.map(({ explain, ...row }) => (explain ? { ...row, explain: { label: e.label, title: e.title, body: <p>{e.body}</p> } } : row))}
          {...(m.note ? { note: m.note } : {})}
          device={device}
        />
        {m.proof && <p className="text-sub text-muted">{m.proof}</p>}
        <Section title={t.operations}>
          <Card>{items.length === 0 ? <p className="text-body text-muted">{t.empty}</p> : <Timeline label={t.operationsLabel} items={items} />}</Card>
        </Section>
        <Basis rows={model.operations} />
        <Section title={t.documentsSection}>
          {model.documents.length === 0 ? (
            <Card>
              <p className="text-body text-muted">{t.documentsEmpty}</p>
            </Card>
          ) : (
            <Card padded={false}>
              <List>
                {model.documents.map((doc) => (
                  <ListItem key={doc.id}>
                    <div className="flex flex-col gap-2 px-4 py-3">
                      <span className="flex flex-col gap-1">
                        <span className="text-body text-ink wrap-break-word">{doc.name}</span>
                        <span className="text-sub text-muted">{doc.status}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <a href={doc.href} target="_blank" rel="noopener" className="inline-flex min-h-control items-center text-body font-medium text-ink underline underline-offset-4">
                          {doc.statement ? t.openStatement : t.open}
                        </a>
                        {doc.shareable && <ShareButton documentId={doc.id} name={doc.name} device={device} />}
                      </span>
                    </div>
                  </ListItem>
                ))}
              </List>
            </Card>
          )}
        </Section>
      </Stack>
    </Narrow>
  );
}
