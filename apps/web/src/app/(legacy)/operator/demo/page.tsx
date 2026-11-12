import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { isDemoMode } from "@/modules/operator";
import { ButtonLink, Card, Container, PageHeader } from "@/ui";
import { isEnabled } from "@/platform/features";
import { requireOperatorPage } from "../_lib/guard";
import { ResetDemo } from "./DemoControls";
import { ExecutorIdentitySection } from "./ExecutorIdentitySection";
import { PreContractFlowSection } from "./PreContractFlowSection";

const t = ru.operator.demo;

export const metadata: Metadata = { title: t.title };

/** Демо-настройки: только при DEMO_MODE (иначе страницы нет). Провайдер оплаты задаёт env (ADR-009), не оператор. */
export default async function DemoSettingsPage() {
  await requireOperatorPage("/operator/demo");
  if (!isDemoMode()) notFound();

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
        <ExecutorIdentitySection />
        {isEnabled("preContractFlows") && <PreContractFlowSection />}
        <Card title={t.resetTitle} description={t.resetHint}>
          <ResetDemo />
        </Card>
      </div>
    </Container>
  );
}
