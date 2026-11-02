import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listFurnitureTypes } from "@/modules/companies";
import {
  activePreContractFlow,
  flowRules,
  getDraft,
  likeTarget,
  resumeIndex,
  segmentInputOf,
  segmentPriceHints,
  WIZARD_SCREENS,
  type Draft,
  type WizardScreen,
} from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { Alert, Container, formatDate, Stepper } from "@/ui";
import { SEGMENT_NAMES, suggestSegment } from "@/verticals/furniture";
import { VisualizationPanel, SegmentHint } from "@/app/_components/ai-assistant";
import { aiEnabled, listVisualizations } from "@/modules/ai";
import { NoAccess } from "@/app/_components/NoAccess";
import { orNotFound, pageUser } from "../_parts/guard";
import { detailRows, FactList, type FactRow } from "../_parts/RequestFacts";
import { AssistantApply } from "./AssistantApply";
import { SegmentStep, StyleStep, TypeStep } from "./ChoiceSteps";
import { PlaceStep, RoomStep, SizeStep } from "./DetailSteps";
import { styleExamples } from "./examples";
import { SendStep } from "./SendStep";

const w = ru.requests.wizard;

export const metadata: Metadata = { title: w.metaTitle };

type Search = Promise<{ draft?: string; step?: string; like?: string }>;

const hrefOf = (draftId: string, screen: WizardScreen) => `/requests/new?draft=${draftId}&step=${screen}`;

/**
 * Мастер заявки для человека, который не разбирается в мебели (встреча 31.10, п. 1): по экрану на вопрос,
 * картинки вместо терминов, размеры и фото по желанию. Черновик сохраняется на каждом экране
 * (`?draft=<id>&step=<экран>`); вперёд дальше сохранённого перейти нельзя. `?like=<работа>` — прямой запрос.
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

  const index = resumeIndex(draft, sp.step);
  const screen = WIZARD_SCREENS[index];
  const next = WIZARD_SCREENS[index + 1] ?? null;
  const back = index === 0 || !draft ? "/requests" : hrefOf(draft.id, WIZARD_SCREENS[index - 1]);
  const base = { draftId: draft?.id ?? null, like: like?.id ?? null, next };
  const directLabel = draft?.targetLabel ?? like?.executor.label ?? null;
  // Сценарий площадки для новой заявки: в онлайн-замере размеры и фото с рулеткой обязательны (ADR-005).
  const selfMeasure = flowRules(await activePreContractFlow()).selfMeasure;
  const types = await listFurnitureTypes();

  return (
    <Container size="form" className="flex flex-col gap-8 pt-4 pb-10">
      <Stepper steps={w.steps} current={index} back={{ href: back }} />
      {screen === "type" && (
        <TypeStep
          {...base}
          types={types}
          initial={{ furnitureTypeId: draft?.furnitureTypeId ?? like?.furnitureTypeId ?? null, customType: draft?.customType ?? null }}
          note={directLabel !== null ? <Alert tone="accent">{w.type.direct(directLabel)}</Alert> : undefined}
        />
      )}
      {screen === "style" && draft && (
        <StyleStep
          {...base}
          examples={await styleExamples(types.find((t) => t.id === draft.furnitureTypeId)?.slug ?? null)}
          initial={{ style: draft.style, styleNote: draft.details.styleNote ?? "" }}
        />
      )}
      {/* Помощник — своя форма, поэтому рядом с формой шага, а не внутри. */}
      {screen === "style" && draft && aiEnabled() && <AssistantApply draftId={draft.id} types={types} reviewScreen="style" />}
      {screen === "size" && draft && <SizeStep {...base} details={draft.details} selfMeasure={selfMeasure} />}
      {screen === "segment" && draft && (
        <SegmentStep
          {...base}
          initial={draft.segment ?? draft.segmentSuggested ?? draft.target?.segment ?? ""}
          prices={await segmentPriceHints(draft.furnitureTypeId, draft.details)}
          directLabel={directLabel}
          hint={suggestSegment(segmentInputOf(draft.details)).segment ? <SegmentHint details={segmentInputOf(draft.details)} /> : undefined}
        />
      )}
      {screen === "room" && draft && (
        <RoomStep
          {...base}
          photos={draft.photos}
          description={draft.details.description ?? ""}
          selfMeasure={selfMeasure}
          aiSlot={
            aiEnabled() && draft.photos.length > 0 ? (
              <VisualizationPanel requestId={draft.id} photos={draft.photos} initial={await listVisualizations(user, draft.id)} />
            ) : undefined
          }
        />
      )}
      {screen === "place" && draft && (
        <PlaceStep
          {...base}
          initial={{ city: draft.city, address: draft.address ?? "", desiredDate: draft.desiredDate ? draft.desiredDate.toISOString().slice(0, 10) : "" }}
        />
      )}
      {screen === "send" && draft && <SendScreen draft={draft} directLabel={directLabel} />}
    </Container>
  );
}

/** Строки сводки → экран, где их поменять. Материалы приносит помощник — экрана для них нет. */
const EDIT_SCREEN: Record<string, WizardScreen> = {
  [ru.requests.facts.type]: "type",
  [ru.requests.facts.style]: "style",
  [ru.requests.facts.styleNote]: "style",
  [ru.requests.facts.size]: "size",
  [ru.requests.facts.description]: "room",
};

function SendScreen({ draft, directLabel }: { draft: Draft; directLabel: string | null }) {
  const f = ru.requests.facts;
  const edit = (screen: WizardScreen | undefined, label: string) =>
    screen && (
      <Link
        href={hrefOf(draft.id, screen)}
        aria-label={ru.common.ui.actionFor(w.edit, label)}
        className="inline-flex min-h-control-sm items-center rounded-control px-2 font-semibold text-primary"
      >
        {w.edit}
      </Link>
    );
  const row = (label: string, value: FactRow["value"], screen: WizardScreen): FactRow => ({ label, value, edit: edit(screen, label) });
  const rows: FactRow[] = [
    ...detailRows({ title: draft.title, style: draft.style, details: draft.details, unknownText: w.unknown }).map((r) => ({
      ...r,
      // Размеры «не знаю» заказчик выбирал словами «уточнит замер» — так и показываем.
      value: r.label === f.size && r.value === w.unknown ? w.size.unknown : r.value,
      edit: edit(EDIT_SCREEN[r.label], r.label),
    })),
    ...(draft.segment ? [row(f.segment, SEGMENT_NAMES[draft.segment], "segment")] : []),
    row(f.photos, draft.photos.length > 0 ? <PhotoStrip photos={draft.photos} /> : f.notSet, "room"),
    row(f.address, [draft.city, draft.address].filter(Boolean).join(", "), "place"),
    row(f.desiredDate, draft.desiredDate ? formatDate(draft.desiredDate) : f.notSet, "place"),
  ];
  const footnote = directLabel !== null ? w.send.footnoteDirect(directLabel) : draft.segment ? w.send.footnote(SEGMENT_NAMES[draft.segment]) : "";

  return (
    <SendStep
      draftId={draft.id}
      directLabel={directLabel}
      footnote={footnote}
      summary={
        <section aria-labelledby="send-summary" className="flex flex-col gap-4 rounded-card bg-surface p-5 shadow-card sm:p-6">
          <h2 id="send-summary" className="text-xl font-bold text-ink">
            {w.send.summary}
          </h2>
          <FactList rows={rows} />
        </section>
      }
    />
  );
}

function PhotoStrip({ photos }: { photos: Draft["photos"] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {photos.map((p, i) => (
        <li key={p.id}>
          {/* Фото из хранилища по подписанной ссылке — оптимизатор next/image не нужен. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.src} alt={w.room.photoAlt(i + 1)} className="size-16 rounded-control border border-line object-cover" />
        </li>
      ))}
    </ul>
  );
}
