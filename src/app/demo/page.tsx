import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { listDemoPersonas, type DemoPersona } from "@/modules/identity";
import { env } from "@/platform/env";
import { Container, EmptyState, PageHeader, StatusBadge, type Tone } from "@/ui";
import { PersonaButton } from "./PersonaButton";

const t = ru.identity.demo;

export const metadata: Metadata = { title: t.metaTitle };

const ROLES: Role[] = ["OPERATOR", "CLIENT", "EXECUTOR"];
const STATUS_TONE: Record<NonNullable<DemoPersona["executor"]>["status"], Tone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

/** Демо-персоны: вход одним нажатием. Без DEMO_MODE страницы нет. */
export default async function DemoPage() {
  if (!env().DEMO_MODE) notFound();
  const personas = await listDemoPersonas();

  return (
    <Container size="form">
      <PageHeader title={t.title} description={t.lead} back={{ href: "/" }} />
      {personas.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <div className="flex flex-col gap-8">
          {ROLES.map((role) => {
            const group = personas.filter((p) => p.role === role);
            if (group.length === 0) return null;
            return (
              <section key={role} aria-labelledby={`demo-${role}`} className="flex flex-col gap-3">
                <h2 id={`demo-${role}`} className="text-xl font-bold text-ink">
                  {t.groups[role]}
                </h2>
                <ul className="flex flex-col gap-3">
                  {group.map((p) => (
                    <PersonaCard key={p.id} persona={p} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Container>
  );
}

function PersonaCard({ persona }: { persona: DemoPersona }) {
  const { executor } = persona;
  const name = executor ? executor.legalName : (persona.fullName ?? ru.common.roles[persona.role]);
  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-lg font-bold text-ink">{name}</p>
        {executor && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base text-muted">{ru.common.executorLabel(executor.publicNumber)}</span>
            <StatusBadge tone={STATUS_TONE[executor.status]}>{t.executorStatus[executor.status]}</StatusBadge>
          </div>
        )}
        {persona.roles
          .filter((r) => r !== persona.role)
          .map((r) => (
            <p key={r} className="text-base text-ink">
              {t.alsoRole(ru.common.roles[r])}
            </p>
          ))}
      </div>
      <div className="sm:w-40 sm:shrink-0">
        <PersonaButton userId={persona.id} name={name} />
      </div>
    </li>
  );
}
