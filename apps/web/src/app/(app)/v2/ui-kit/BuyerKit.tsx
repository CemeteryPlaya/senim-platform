import { Bell } from "lucide-react";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { Badge, Card, MoneyPanel, Narrow, Section, Stack, Steps, Timeline, type MoneyTone } from "@/kit";
import type { Device } from "@/platform/device";
import { to } from "../../_shell/paths";
import { ChatSample, MenuSample, SignatureSample, UploaderSample } from "./BuyerLive";

const s = ru.app.kit.showcase;
const t = s.buyer;

/** Образец с подписью над ним. */
function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small text-muted">{label}</p>
      {children}
    </div>
  );
}

/** Сделка на 200 000 ₸ + защита 2% = 4 000 ₸; суммы в тиынах. */
const PRICE = 20_000_000n;
const PROTECTION = 400_000n;
const TOTAL = PRICE + PROTECTION;

const MONEY_TITLES: Record<MoneyTone, string> = {
  awaiting: t.moneyTitleAwaiting,
  protected: t.moneyTitleProtected,
  frozen: t.moneyTitleFrozen,
  completed: t.moneyTitleCompleted,
  refunded: t.moneyTitleRefunded,
};

const TONES = ["protected", "awaiting", "frozen", "completed", "refunded"] as const satisfies readonly MoneyTone[];

const STEP_STATES = ["done", "done", "current", "todo", "todo"] as const;
const STEP_ITEMS = t.steps.map((label, index) => ({ label, state: STEP_STATES[index] ?? "todo" }));

const ROWS = [
  { label: t.moneyPrice, amount: PRICE },
  {
    label: t.moneyProtection,
    amount: PROTECTION,
    explain: { label: t.moneyExplainLabel, title: t.moneyExplainTitle, body: t.moneyExplainBody },
  },
  { label: t.moneyTotal, amount: TOTAL, total: true },
];

/** События сделки; сумма события — тиыны (в ru лежит только текст). */
const EVENTS = t.timeline.map((event) => ({
  title: event.title,
  time: event.time,
  text: "text" in event ? event.text : undefined,
  amount: "amountTiyn" in event ? event.amountTiyn : undefined,
}));

/** Образцы компонентов для экранов покупателя: ход сделки, история, счётчик, меню, деньги, фото, переписка, подпись. */
export function BuyerKit({ device }: { device: Device }) {
  return (
    <>
      <Section title={s.sections.steps}>
        <Stack>
            <Specimen label={t.stepsLabel}>
              <Card>
                <Steps items={STEP_ITEMS} note={t.stepNote} label={t.stepsLabel} />
              </Card>
            </Specimen>
            <Specimen label={t.stopped}>
              <Card>
                <Steps items={STEP_ITEMS} stopped={{ label: t.stopped }} />
              </Card>
            </Specimen>
            <Specimen label={t.stoppedCancelled}>
              <Card>
                <Steps items={STEP_ITEMS} stopped={{ label: t.stoppedCancelled }} />
              </Card>
            </Specimen>
          </Stack>
      </Section>

      <Section title={s.sections.timeline}>
        <Narrow>
          <Card>
            <Timeline label={t.timelineLabel} items={EVENTS} />
          </Card>
        </Narrow>
      </Section>

      <Section title={s.sections.badge}>
        <Narrow>
          <Card className="flex flex-wrap items-center gap-6">
            {[0, 5, 120].map((count) => (
              <Specimen key={count} label={count === 0 ? t.badgeNone : count === 5 ? t.badgeSample : t.badgeMax}>
                <span className="relative inline-flex size-12 items-center justify-center text-ink">
                  <Bell aria-label={`${t.badgeLabel}, ${ru.app.kit.badge.unread(count)}`} role="img" className="size-6" />
                  <Badge count={count} className="absolute -top-1 -right-1" />
                </span>
              </Specimen>
            ))}
          </Card>
        </Narrow>
      </Section>

      <Section title={s.sections.menu}>
        <Narrow>
          <Card className="flex items-center justify-between gap-4">
            <p className="text-body text-ink">{t.menuLabel}</p>
            <MenuSample device={device} />
          </Card>
        </Narrow>
      </Section>

      <Section title={s.sections.moneyPanel}>
        <Narrow>
          <Stack>
            {TONES.map((tone) => (
              <Specimen key={tone} label={t.moneyTone[tone]}>
                <MoneyPanel
                  tone={tone}
                  title={MONEY_TITLES[tone]}
                  amount={tone === "protected" || tone === "awaiting" ? TOTAL : PRICE}
                  rows={tone === "protected" || tone === "awaiting" ? ROWS : undefined}
                  note={tone === "protected" ? t.moneyNote : tone === "frozen" ? t.moneyFrozenNote : undefined}
                  action={tone === "protected" ? { label: t.moneyAction, href: to("/v2/ui-kit") } : undefined}
                  device={device}
                />
              </Specimen>
            ))}
          </Stack>
        </Narrow>
      </Section>

      <Section title={s.sections.uploader}>
        <Narrow>
          <Stack>
            <p className="text-sub text-muted">{t.uploaderCaption}</p>
            <Card>
              <UploaderSample />
            </Card>
          </Stack>
        </Narrow>
      </Section>

      <Section title={s.sections.chat}>
        <Narrow>
          {/* Без карточки: чужие сообщения на surface, им нужен серый фон страницы. */}
          <ChatSample device={device} />
        </Narrow>
      </Section>

      <Section title={s.sections.signature}>
        <Narrow>
          <Stack>
            <p className="text-sub text-muted">{t.signatureCaption}</p>
            <SignatureSample />
          </Stack>
        </Narrow>
      </Section>
    </>
  );
}
