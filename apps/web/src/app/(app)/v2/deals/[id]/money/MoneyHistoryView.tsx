import { ru } from "@/i18n/ru";
import { Card, List, ListItem, MoneyPanel, PageTitle, Section, Split, Stack, TextLink, Timeline, type TimelineItem } from "@/kit";
import type { Device } from "@/platform/device";
import type { MoneyView } from "../_parts/deal-card";
import { ShareButton } from "./ShareButton";
import type { OperationRow } from "./money-view";

const t = ru.app.deal.money;
const card = ru.app.deal.card;

export type MoneyDocument = { id: string; name: string; status: string; href: string; open: string; shareable: boolean };

export type MoneyHistoryModel = {
  dealTitle: string;
  backHref: string;
  number: number;
  money: MoneyView;
  operations: OperationRow[];
  documents: MoneyDocument[];
};

/**
 * История денег: блок денег (тот же вид, что на карточке сделки, из журнала), операции журнала лентой — свежие сверху
 * (номер операции банка — только здесь), выписка и акт («Открыть …» и «Поделиться»). Главного действия на экране нет: он
 * справочный. Телефон — одна колонка; компьютер — `Split`: слева деньги и операции, справа «Выписка и акт».
 */
export function MoneyHistoryView({ model, device }: { model: MoneyHistoryModel; device: Device }) {
  const m = model.money;
  const e = card.money.explain;
  const items: TimelineItem[] = model.operations.map((row) => ({
    title: row.title,
    time: row.time,
    ...(row.amount !== undefined ? { amount: row.amount } : {}),
    ...(row.text ? { text: row.text } : {}),
    // Документ-основание оплаты (PDF) — ссылка внутри строки операции, подпись по виду документа («Открыть оферту»).
    ...(row.kind === "hold" && row.basis ? { link: { label: row.basis.label, href: row.basis.href, external: true } } : {}),
  }));
  const title = <PageTitle title={t.title} back={{ href: model.backHref, label: model.dealTitle }} lead={t.lead(model.number)} />;
  const money = (
    <Stack gap="section">
      <Stack gap="tight">
        <MoneyPanel
          tone={m.tone}
          title={m.title}
          amount={m.amount}
          rows={m.rows.map(({ explain, ...row }) => (explain ? { ...row, explain: { label: e.label, title: e.title, body: <p>{e.body}</p> } } : row))}
          {...(m.note ? { note: m.note } : {})}
          device={device}
        />
        {m.proof && <p className="text-sub text-muted">{m.proof}</p>}
      </Stack>
      <Section title={t.operations}>
        <Card>{items.length === 0 ? <p className="text-body text-muted">{t.empty}</p> : <Timeline label={t.operationsLabel} items={items} />}</Card>
      </Section>
    </Stack>
  );
  const documents = (
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
                    <TextLink href={doc.href} external>
                      {doc.open}
                    </TextLink>
                    {doc.shareable && <ShareButton documentId={doc.id} name={doc.name} device={device} />}
                  </span>
                </div>
              </ListItem>
            ))}
          </List>
        </Card>
      )}
    </Section>
  );
  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <Split main={money} aside={documents} />
      </Stack>
    );
  }
  return (
    <Stack gap="section">
      {title}
      {money}
      {documents}
    </Stack>
  );
}
