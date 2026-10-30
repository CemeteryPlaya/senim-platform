import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDraft, likeTarget, listFurnitureTypes, segmentInputOf, WIZARD_SCREENS, type Draft, type WizardScreen } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { Alert, Container, EmptyState, Stepper } from "@/ui";
import { SEGMENT_NAMES, suggestSegment } from "@/verticals/furniture";
import { orNotFound, pageUser } from "../_parts/guard";
import { detailRows, FactList, type FactRow } from "../_parts/RequestFacts";
import { MaterialsStep, RoomStep, SendStep, SizeStep, StyleStep, TypeStep } from "./WizardSteps";

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
    return (
      <Container size="form" className="pt-6">
        <EmptyState title={ru.common.errors.forbidden} description={ru.requests.noAccess} />
      </Container>
    );
  }

  const draft = sp.draft ? await orNotFound(getDraft(user, sp.draft)) : null;
  if (draft && draft.status !== "DRAFT") redirect(`/requests/${draft.id}`);
  const like = !draft && sp.like ? await orNotFound(likeTarget(sp.like)) : null;

  const reached = draft ? Math.min(draft.wizardStep, WIZARD_SCREENS.length - 1) : 0;
  const asked = WIZARD_SCREENS.indexOf(sp.step as WizardScreen);
  const index = asked >= 0 && asked <= reached ? asked : reached;
  const screen = WIZARD_SCREENS[index];
  const next = WIZARD_SCREENS[index + 1] ?? null;
  const back = index === 0 || !draft ? "/requests" : hrefOf(draft.id, WIZARD_SCREENS[index - 1]);
  const base = { draftId: draft?.id ?? null, like: like?.id ?? null, next };
  const directNumber = draft?.target?.publicNumber ?? like?.executor.publicNumber ?? null;

  return (
    <Container size="form" className="flex flex-col gap-8 pt-4 pb-10">
      <Stepper steps={w.steps} current={STEPPER_INDEX[screen]} back={{ href: back }} />
      {screen === "type" && (
        <TypeStep
          {...base}
          types={await listFurnitureTypes()}
          initial={{ furnitureTypeId: draft?.furnitureTypeId ?? like?.furnitureTypeId ?? null, customType: draft?.customType ?? null }}
          note={directNumber !== null ? <Alert tone="accent">{w.type.direct(directNumber)}</Alert> : undefined}
        />
      )}
      {screen === "style" && draft && <StyleStep {...base} initial={{ style: draft.style, styleNote: draft.details.styleNote ?? "" }} />}
      {screen === "room" && draft && (
        <RoomStep
          {...base}
          photos={draft.photos}
          // INTEGRATOR: aiSlot={<AiAssistant requestId={draft.id} />} из _components/ai-assistant (только при aiEnabled());
          // предложение ИИ (RequestDraftSuggestion) переносится в черновик через saveStepAction по экранам.
        />
      )}
      {screen === "size" && draft && <SizeStep {...base} details={draft.details} />}
      {screen === "materials" && draft && <MaterialsStep {...base} details={draft.details} />}
      {screen === "send" && draft && <SendScreen draft={draft} directNumber={directNumber} />}
    </Container>
  );
}

function SendScreen({ draft, directNumber }: { draft: Draft; directNumber: number | null }) {
  const s = w.send;
  const suggestion = suggestSegment(segmentInputOf(draft.details));
  const edit = (screen: WizardScreen, label: string) => (
    <Link href={hrefOf(draft.id, screen)} className="inline-flex min-h-control-sm items-center rounded-control px-2 font-semibold text-primary">
      {w.edit}
      <span className="sr-only">: {label}</span>
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
      directNumber={directNumber}
      initial={{
        segment: draft.segment ?? draft.segmentSuggested ?? draft.target?.segment ?? "",
        city: draft.city,
        address: draft.address ?? "",
        desiredDate: draft.desiredDate ? draft.desiredDate.toISOString().slice(0, 10) : "",
        wishes: draft.wishes,
      }}
      suggestion={
        suggestion.segment && (
          <Alert tone="accent" title={s.suggestionTitle}>
            <p>{s.suggestion(SEGMENT_NAMES[suggestion.segment])}</p>
            <details className="mt-2">
              <summary className="inline-flex min-h-control-sm cursor-pointer items-center font-semibold text-primary">{ru.common.actions.why}</summary>
              <p className="mt-2 text-base text-ink">{s.whyLead}</p>
              <ul className="mt-2 list-disc pl-6 text-base text-ink">
                {suggestion.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </details>
          </Alert>
        )
      }
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
