import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getPaymentRailSetting, isDemoMode } from "@/modules/operator";
import { Alert, ButtonLink, Card, Container, PageHeader } from "@/ui";
import { requireOperatorPage } from "../_lib/guard";
import { RailForm, ResetDemo } from "./DemoControls";

const t = ru.operator.demo;

export const metadata: Metadata = { title: t.title };

/** Демо-настройки: только при DEMO_MODE (иначе страницы нет). */
export default async function DemoSettingsPage() {
  await requireOperatorPage();
  if (!isDemoMode()) notFound();
  const rail = await getPaymentRailSetting();
  // В env может стоять bank — его оператор не переключает, форма начинает с «напрямую».
  const current = rail.mode === "escrow-simulator" ? "escrow-simulator" : "manual";

  return (
    <Container size="form">
      <PageHeader
        title={t.title}
        description={t.description}
        back={{ href: "/operator", label: ru.operator.backToPanel }}
        actions={
          <ButtonLink href="/bank-demo" variant="secondary">
            {t.bankDemo}
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-6">
        <Card>
          {rail.source === "env" && <Alert tone="info">{t.railFromEnv(ru.bankDemo.railModes[rail.mode] ?? rail.mode)}</Alert>}
          <RailForm current={current} />
        </Card>
        <Card title={t.resetTitle} description={t.resetHint}>
          <ResetDemo />
        </Card>
      </div>
    </Container>
  );
}
