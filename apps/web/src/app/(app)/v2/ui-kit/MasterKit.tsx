import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { Bars, Card, Money, Narrow, Section, Stack, Stat, StatRow } from "@/kit";
import { DocsUploaderSample } from "./MasterLive";

const s = ru.app.kit.showcase;
const t = s.master;

/** Образец с подписью над ним. */
function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small text-muted">{label}</p>
      {children}
    </div>
  );
}

const MONTHS = t.months.map((m, index, all) => ({ label: m.label, name: m.name, value: m.tiyn, current: index === all.length - 1 }));
const EMPTY = t.months.map((m, index, all) => ({ label: m.label, name: m.name, value: 0n, current: index === all.length - 1 }));
const EARNED = t.months[t.months.length - 1]?.tiyn ?? 0n;

/** Образцы компонентов для экранов мастера: число с подписью, столбики по месяцам, загрузка с камерой и PDF. */
export function MasterKit() {
  return (
    <>
      <Section title={s.sections.stat}>
        <Narrow>
          <Stack>
            <StatRow label={t.statRowLabel}>
              <Stat label={t.statNew} value="3" />
              <Stat label={t.statInWork} value="1" />
            </StatRow>
            <Specimen label={t.statCompactCaption}>
              <StatRow label={t.statRowLabel}>
                <Stat label={t.statNew} value="12" />
                <Stat label={t.statInWork} value="4" />
                <Stat label={t.statMonth} value={<Money tiyn={EARNED} />} compact />
              </StatRow>
            </Specimen>
            <Specimen label={t.statSingleCaption}>
              <Card>
                <Stat label={t.statMonth} value={<Money tiyn={EARNED} />} />
              </Card>
            </Specimen>
          </Stack>
        </Narrow>
      </Section>

      <Section title={s.sections.bars}>
        <Narrow>
          <Stack>
            <Specimen label={t.barsCaption}>
              <Card>
                <Bars label={t.barsLabel} items={MONTHS} />
              </Card>
            </Specimen>
            <Specimen label={t.barsEmptyCaption}>
              <Card>
                <Bars label={t.barsLabel} items={EMPTY} />
              </Card>
            </Specimen>
          </Stack>
        </Narrow>
        <Specimen label={t.barsColumnsCaption}>
          <Card>
            <Bars label={t.barsLabel} items={MONTHS} layout="columns" />
          </Card>
        </Specimen>
      </Section>

      <Section title={s.sections.uploaderDocs}>
        <Narrow>
          <Stack>
            <p className="text-sub text-muted">{t.uploaderCaption}</p>
            <Card>
              <DocsUploaderSample />
            </Card>
          </Stack>
        </Narrow>
      </Section>
    </>
  );
}
