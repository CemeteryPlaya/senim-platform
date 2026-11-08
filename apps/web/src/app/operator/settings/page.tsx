import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { platformSettings } from "@/modules/operator";
import { Card, Container, KeyValueList, PageHeader, StatusBadge } from "@/ui";
import { DataTable, TD, TH, TH_ROW } from "../_components/DataTable";
import { requireOperatorPage } from "../_lib/guard";

const o = ru.operator;
const t = o.settings;

export const metadata: Metadata = { title: t.title };

/** Флаги Фазы 1 и окружение — только чтение (ADR-009 раздел 8): значения задаёт env сервера. */
export default async function SettingsPage() {
  const user = await requireOperatorPage("/operator/settings");
  const s = platformSettings(user);

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: o.backToPanel }} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title={t.environment}>
          <KeyValueList
            rows={[
              { label: t.appEnv, value: `${s.appEnv}: ${t.appEnvValues[s.appEnv]}` },
              { label: t.demoMode, value: s.demoMode ? t.yes : t.no },
              {
                label: t.provider,
                value: (
                  <span className="flex flex-col gap-1">
                    <span>{t.providerNames[s.newDealProvider]}</span>
                    <span className="text-sm font-normal text-muted">{s.providerFromDefault ? t.providerDefault : t.providerEnv}</span>
                    <span className="text-sm font-normal text-muted">{t.providerNote}</span>
                  </span>
                ),
              },
            ]}
          />
        </Card>
        <div className="flex min-w-0 flex-col gap-3">
          <DataTable caption={t.flags}>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  {t.columns.flag}
                </th>
                <th scope="col" className={TH}>
                  {t.columns.envVar}
                </th>
                <th scope="col" className={TH}>
                  {t.columns.state}
                </th>
              </tr>
            </thead>
            <tbody>
              {s.flags.map((f) => (
                <tr key={f.key}>
                  <th scope="row" className={`${TH_ROW} min-w-52 font-semibold`}>
                    {t.flagNames[f.key]}
                  </th>
                  <td className={TD}>
                    <code className="text-sm break-all text-muted">{f.envVar}</code>
                  </td>
                  <td className={TD}>
                    <StatusBadge tone={f.enabled ? "success" : "neutral"}>{f.enabled ? t.on : t.off}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <p className="text-base text-ink-soft">{t.flagsHint}</p>
        </div>
      </div>
    </Container>
  );
}
