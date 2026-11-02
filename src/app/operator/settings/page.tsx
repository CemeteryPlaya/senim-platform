import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { platformSettings } from "@/modules/operator";
import { Card, Container, Fact, PageHeader, StatusBadge } from "@/ui";
import { requireOperatorPage } from "../_lib/guard";

const o = ru.operator;
const t = o.settings;

export const metadata: Metadata = { title: t.title };

/** Флаги Фазы 1 и окружение — только чтение (ADR-009 раздел 8): значения задаёт env сервера. */
export default async function SettingsPage() {
  const user = await requireOperatorPage("/operator/settings");
  const s = platformSettings(user);

  return (
    <Container size="form" className="pb-10">
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: o.backToPanel }} />
      <div className="flex flex-col gap-6">
        <Card title={t.environment}>
          <dl className="flex flex-col gap-4">
            <Fact label={t.appEnv}>{`${s.appEnv}: ${t.appEnvValues[s.appEnv]}`}</Fact>
            <Fact label={t.demoMode}>{s.demoMode ? t.yes : t.no}</Fact>
            <Fact label={t.provider}>
              <span className="flex flex-col gap-1">
                <span className="font-semibold">{t.providerNames[s.newDealProvider]}</span>
                <span className="text-sm text-muted">{s.providerFromDefault ? t.providerDefault : t.providerEnv}</span>
                <span className="text-sm text-muted">{t.providerNote}</span>
              </span>
            </Fact>
          </dl>
        </Card>
        <Card title={t.flags} description={t.flagsHint}>
          <ul className="flex flex-col">
            {s.flags.map((f) => (
              <li key={f.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-3 last:border-b-0">
                <span className="flex min-w-0 flex-col">
                  <span className="text-base font-semibold text-ink">{t.flagNames[f.key]}</span>
                  <code className="text-sm break-all text-muted">{f.envVar}</code>
                </span>
                <StatusBadge tone={f.enabled ? "success" : "neutral"}>{f.enabled ? t.on : t.off}</StatusBadge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Container>
  );
}
