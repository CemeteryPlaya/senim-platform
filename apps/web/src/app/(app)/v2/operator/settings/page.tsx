import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Card, KeyValueList, Narrow, PageTitle, Section, Stack, StatusChip } from "@/kit";
import { getExecutorIdentityMode } from "@/modules/companies";
import { platformSettings } from "@/modules/operator";
import { activePreContractFlow } from "@/modules/requests";
import { isEnabled } from "@/platform/features";
import { requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { ExecutorIdentityForm, PreContractFlowForm } from "./SettingsForms";

const t = ru.app.operatorSettings.settings;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * Флаги Фазы 1 и окружение — только чтение (ADR-009, раздел 8): значения задают переменные окружения сервера. Ниже —
 * настройки площадки, которые меняет оператор со свежим кодом из приложения (R7): режим показа имени исполнителя
 * (ADR-006) и сценарий до договора (ADR-005, только при флаге `preContractFlows`). Раздел из меню: «Назад» не нужно.
 */
export default async function SettingsPage() {
  const user = await requireOperator(to("/operator/settings"));
  const s = platformSettings(user);
  const preContract = isEnabled("preContractFlows");
  const [mode, flow] = await Promise.all([getExecutorIdentityMode(), preContract ? activePreContractFlow() : Promise.resolve(null)]);
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} lead={t.lead} />
        <Section title={t.environment} id="settings-environment">
          <Card padded={false}>
            <KeyValueList
              items={[
                { label: t.appEnv, value: `${s.appEnv}: ${t.appEnvValues[s.appEnv]}` },
                {
                  label: t.provider,
                  value: (
                    <span className="flex flex-col gap-1">
                      <span>{t.providerNames[s.newDealProvider]}</span>
                      <span className="text-sub text-muted">{s.providerFromDefault ? t.providerDefault : t.providerEnv}</span>
                      <span className="text-sub text-muted">{t.providerNote}</span>
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </Section>
        <Section title={t.flags} id="settings-flags">
          <Stack>
            <Card padded={false}>
              <KeyValueList
                items={s.flags.map((flag) => ({
                  label: t.flagNames[flag.key],
                  value: (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <StatusChip tone={flag.enabled ? "accent" : "neutral"}>{flag.enabled ? t.on : t.off}</StatusChip>
                      <code className="text-sub break-all text-muted">{flag.envVar}</code>
                    </span>
                  ),
                }))}
              />
            </Card>
            <p className="text-body text-muted">{t.flagsHint}</p>
          </Stack>
        </Section>
        <Section title={t.platform} id="settings-platform">
          <Stack>
            <p className="text-body text-muted">{t.platformLead}</p>
            <ExecutorIdentityForm current={mode} />
            {flow !== null && <PreContractFlowForm current={flow} />}
          </Stack>
        </Section>
      </Stack>
    </Narrow>
  );
}
