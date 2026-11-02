import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listFurnitureTypes } from "@/modules/companies";
import { activePreContractFlow, flowRules, getDraft, likeTarget, segmentInputOf, WIZARD_SCREENS, type Draft, type WizardScreen } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { Alert, Container, Stepper } from "@/ui";
import { orNotFound, pageUser } from "../_parts/guard";
import { detailRows, FactList, type FactRow } from "../_parts/RequestFacts";
import { VisualizationPanel, SegmentHint } from "@/app/_components/ai-assistant";
import { aiEnabled, listVisualizations } from "@/modules/ai";
import { AssistantApply } from "./AssistantApply";
import { MaterialsStep, RoomStep, SendStep, SizeStep, StyleStep, TypeStep } from "./WizardSteps";
import { NoAccess } from "@/app/_components/NoAccess";

const w = ru.requests.wizard;

export const metadata: Metadata = { title: w.metaTitle };

/** Экран мастера → кружок степпера: «Детали» — два экрана под одним шагом. */
const STEPPER_INDEX: Record<WizardScreen, number> = { type: 0, style: 1, room: 2, size: 3, materials: 3, send: 4 };

type Search = Promise<{ draft?: string; step?: string; like?: string }>;

const hrefOf = (draftId: string, screen: WizardScreen) => `/requests/new?draft=${draftId}&step=${screen}`;

/**
 * Мастер заявки. Черновик сохраняется на каждом шаге (`?draft=<id>&step=<экран>`);
 * вперёд дальше сохранённого прогресса перейти нельзя. `?like=<работа>` — прямой запрос.
 */
export default async function NewRequestPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const query = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
  const user = await pageUser("CLIENT", `/requests/new${query ? `?${query}` : ""}`);
  if (!user) {
    return <NoAccess description={ru.requests.noAccess} size="form" />;
  }

  const draft = sp.draft ? await orNotFound(getDraft(user, sp.draft)) : null;
  if (draft && draft.status !== "DRAFT") redirect(`/requests/${draft.id}`);
  const like = !draft && sp.like ? await orNotFound(likeTarget(sp.like, user)) : null;

  const reached = draft ? Math.min(draft.wizardStep, WIZARD_SCREENS.length - 1) : 0;
  const asked = WIZARD_SCREENS.indexOf(sp.step as WizardScreen);
  const index = asked >= 0 && asked <= reached ? asked : reached;
  const screen = WIZARD_SCREENS[index];
  const next = WIZARD_SCREENS[index + 1] ?? null;
  const back = index === 0 || !draft ? "/requests" : hrefOf(draft.id, WIZARD_SCREENS[index - 1]);
  const base = { draftId: draft?.id ?? null, like: like?.id ?? null, next };
  const directLabel = draft?.targetLabel ?? like?.executor.label ?? null;
  // Сценарий площадки для новой заявки: в онлайн-замере размеры и фото с рулеткой обязательны (ADR-005).
  const selfMeasure = flowRules(await activePreContractFlow()).selfMeasure;

  return (
    <Container size="form" className="flex flex-col gap-8 pt-4 pb-10">
      <Stepper steps={w.steps} current={STEPPER_INDEX[screen]} back={{ href: back }} />
      {screen === "type" && (
        <TypeStep
          {...base}
          types={await listFurnitureTypes()}
          initial={{ furnitureTypeId: draft?.furnitureTypeId ?? like?.furnitureTypeId ?? null, customType: draft?.customType ?? null }}
          note={directLabel !== null ? <Alert tone="accent">{w.type.direct(directLabel)}</Alert> : undefined}
        />
      )}
      {screen === "style" && draft && <StyleStep {...base} initial={{ style: draft.style, styleNote: draft.details.styleNote ?? "" }} />}
      {screen === "style" && draft && aiEnabled() && <AssistantApply draftId={draft.id} types={await listFurnitureTypes()} reviewScreen="style" />}
      {screen === "room" && draft && (
        <RoomStep
          {...base}
          photos={draft.photos}
          selfMeasure={selfMeasure}
          aiSlot={
            aiEnabled() && draft.photos.length > 0 ? (
              <VisualizationPanel requestId={draft.id} photos={draft.photos} initial={await listVisualizations(user, draft.id)} />
            ) : undefined
          }
        />
      )}
      {screen === "size" && draft && <SizeStep {...base} details={draft.details} selfMeasure={selfMeasure} />}
      {screen === "materials" && draft && <MaterialsStep {...base} details={draft.details} />}
      {screen === "send" && draft && <SendScreen draft={draft} directLabel={directLabel} />}
    </Container>
  );
}

function SendScreen({ draft, directLabel }: { draft: Draft; directLabel: string | null }) {
  const s = w.send;
  const edit = (screen: WizardScreen, label: string) => (
    <Link href={hrefOf(draft.id, screen)} aria-label={ru.common.ui.actionFor(w.edit, label)} className="inline-flex min-h-control-sm items-center rounded-control px-2 font-semibold text-primary">
      {w.edit}
    </Link>
  );
  const EDIT_SCREEN: Record<string, WizardScreen> = {
    [ru.requests.facts.type]: "type",
    [ru.requests.facts.style]: "style",
    [ru.requests.facts.styleNote]: "style",
    [ru.requests.facts.size]: "size",
  };
  const rows: FactRow[] = detailRows({ title: draft.title, style: draft.style, details: draft.details }).map((r) => ({
    ...r,
    edit: edit(EDIT_SCREEN[r.label] ?? "materials", r.label),
  }));

  return (
    <SendStep
      draftId={draft.id}
      directLabel={directLabel}
      initial={{
        segment: draft.segment ?? draft.segmentSuggested ?? draft.target?.segment ?? "",
        city: draft.city,
        address: draft.address ?? "",
        desiredDate: draft.desiredDate ? draft.desiredDate.toISOString().slice(0, 10) : "",
        wishes: draft.wishes,
      }}
      suggestion={<SegmentHint details={segmentInputOf(draft.details)} />}
      summary={
        <section aria-labelledby="send-summary" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
          <h2 id="send-summary" className="text-xl font-bold text-ink">
            {s.summary}
          </h2>
          <FactList rows={rows} />
        </section>
      }
    />
  );
}
