import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { listFurnitureTypes } from "@/modules/companies";
import {
  executorTarget,
  getDraft,
  likeTarget,
  resumeIndex,
  segmentPriceHints,
  WIZARD_SCREENS,
} from "@/modules/requests";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { pageHref, requireBuyer } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { choicePhotos } from "./choice-photos";
import { WizardPlace } from "./WizardPlace";
import { WizardRoom } from "./WizardRoom";
import { WizardSegment } from "./WizardSegment";
import { WizardSend } from "./WizardSend";
import { WizardStart } from "./WizardStart";
import type { WizardBase } from "./WizardFrame";
import { advancedFrom, parseExecutorNumber, segmentOptions, segmentPriceNote, sendFootnote, summaryRows, typeChoice, wizardBack } from "./steps";

export const metadata: Metadata = { title: ru.app.requests.wizard.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/** Чужое и несуществующее модуль отдаёт как NOT_FOUND — для страницы это 404; прочие ошибки идут дальше. */
async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

/**
 * Мастер заявки покупателя: пять шагов одного адреса (`?draft=<id>&step=<экран>`, как в v1) — что и стиль → уровень → фото
 * → адрес → проверка. Черновик сохраняется на каждом шаге; открыть можно сохранённый шаг или любой до него (resumeIndex
 * модуля), «Мои заявки» без шага открывают первый незаполненный. До черновика адрес может нести кому адресована заявка:
 * `like=<работа>` («Хочу похожее») или `executor=<номер>` (профиль мастера) — чужой, несуществующий или свой — 404.
 * Отправленная заявка — на свою карточку. Путь ТЗ: шагов и полей за флагами (`ai`, `materialsCalculator`,
 * `preContractFlows`) здесь нет.
 */
export default async function NewRequestPage({ searchParams }: Props) {
  const params = await searchParams;
  const user = await requireBuyer(pageHref("/requests/new", params));
  const draftId = one(params.draft);
  const draft = draftId ? await orNotFound(getDraft(user, draftId)) : null;
  if (draft && draft.status !== "DRAFT") redirect(to(`/requests/${encodeURIComponent(draft.id)}`));

  const likeId = draft ? undefined : one(params.like);
  const like = likeId ? await orNotFound(likeTarget(likeId, user)) : null;
  const executorRaw = draft || like ? undefined : one(params.executor);
  const executorNumber = parseExecutorNumber(executorRaw);
  if (executorRaw !== undefined && executorNumber === null) notFound();
  const direct = executorNumber !== null ? await orNotFound(executorTarget(executorNumber, user)) : null;

  const index = resumeIndex(draft, one(params.step));
  const screen = WIZARD_SCREENS[index];
  // Мастер прямой заявки: номер для профиля и подпись модуля (режим показа имени — тот же, что в профиле мастера).
  const profile =
    draft?.target && draft.targetLabel !== null
      ? { publicNumber: draft.target.publicNumber, label: draft.targetLabel }
      : like
        ? { publicNumber: like.executor.publicNumber, label: like.executor.label }
        : direct;
  const base: WizardBase = {
    draftId: draft?.id ?? null,
    like: like?.id ?? null,
    executor: direct?.publicNumber ?? null,
    index,
    back: wizardBack(index, draft?.id ?? null, profile),
    direct: profile?.label ?? null,
  };
  // Компонент шага пересоздаётся на каждом шаге и черновике: начальные значения берутся из сохранённого заново.
  const key = `${draft?.id ?? "new"}:${screen}`;

  if (screen === "start" || !draft) {
    const types = await listFurnitureTypes();
    return (
      <WizardStart
        key={key}
        base={base}
        types={types}
        photos={choicePhotos()}
        initial={{
          type: typeChoice(types, { furnitureTypeId: draft?.furnitureTypeId ?? like?.furnitureTypeId ?? null, customType: draft?.customType ?? null }),
          style: draft?.style ?? like?.style ?? null,
          advanced: advancedFrom(draft?.details ?? {}),
        }}
      />
    );
  }
  const device = await getDevice();
  switch (screen) {
    case "segment": {
      const prices = await segmentPriceHints(draft.furnitureTypeId, draft.details);
      return (
        <WizardSegment
          key={key}
          base={base}
          device={device}
          initial={draft.segment ?? draft.segmentSuggested ?? draft.target?.segment ?? direct?.segment ?? null}
          options={segmentOptions(prices)}
          priceNote={segmentPriceNote(prices)}
        />
      );
    }
    case "room":
      return <WizardRoom key={key} base={base} photos={draft.photos} description={draft.details.description ?? ""} />;
    case "place":
      return (
        <WizardPlace
          key={key}
          base={base}
          device={device}
          initial={{
            city: draft.city,
            district: draft.district ?? "",
            complex: draft.complex ?? "",
            address: draft.address ?? "",
            desiredDate: draft.desiredDate ? draft.desiredDate.toISOString().slice(0, 10) : "",
            location: draft.location,
          }}
        />
      );
    case "send":
      return (
        <WizardSend
          key={key}
          base={{ ...base, draftId: draft.id }}
          rows={summaryRows(draft)}
          photos={draft.photos}
          footnote={sendFootnote(draft.segment, base.direct)}
        />
      );
  }
}
