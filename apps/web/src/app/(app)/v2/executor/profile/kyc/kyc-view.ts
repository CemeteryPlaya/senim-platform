import { z } from "zod";
import { ru } from "@/i18n/ru";
import type { UploaderItem } from "@/kit";

// Документы проверки: что показывает экран и как проверяется вход действия (без React и сервера).

const t = ru.app.masterCompany.kyc;

/** Пределы — те же, что у `KYC_MAX_FILES` модуля identity (сверяет `profile.int.test.ts`). */
export const KYC_MAX = 4;

/** Состояние проверки так, как его отдаёт `getOwnKyc` модуля identity. */
export type KycState = "NOT_SUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";

export type KycNow = { title: string; body: string; next: string | null; uploaded: string | null };

/** Что ещё влияет на карточку: режим «отправить заново» и указан ли счёт для оплаты (у проверенных). */
export type KycNowOptions = { again?: boolean; payoutSet?: boolean };

/**
 * Карточка «Сейчас / Дальше» по состоянию проверки; число файлов — только у «на проверке». В режиме «заново» вместо «от вас
 * ничего не требуется» — предупреждение, что новая отправка заменит документы на проверке. Проверенным «Дальше» — про счёт,
 * только пока он не указан.
 */
export function kycNow(state: KycState, rejectReason: string | null, uploadedCount: number, options: KycNowOptions = {}): KycNow {
  switch (state) {
    case "NOT_SUBMITTED":
      return { ...t.now.NOT_SUBMITTED, uploaded: null };
    case "PENDING":
      if (options.again) return { title: t.now.PENDING.title, body: t.now.PENDING.again, next: t.now.PENDING.againNext, uploaded: null };
      return { title: t.now.PENDING.title, body: t.now.PENDING.body, next: t.now.PENDING.next, uploaded: uploadedCount > 0 ? t.now.PENDING.uploaded(uploadedCount) : null };
    case "VERIFIED":
      return { title: t.now.VERIFIED.title, body: t.now.VERIFIED.body, next: options.payoutSet ? null : t.now.VERIFIED.next, uploaded: null };
    case "REJECTED":
      return {
        title: t.now.REJECTED.title,
        body: rejectReason ? t.now.REJECTED.reason(rejectReason) : t.now.REJECTED.noReason,
        next: t.now.REJECTED.next,
        uploaded: null,
      };
  }
}

/**
 * Показывать ли форму загрузки: пока документы не поданы или отклонены — да; «на проверке» — только если мастер сам нажал
 * «Отправить документы заново» (`?again=1`); проверенные заменять нельзя.
 */
export function showForm(state: KycState, canSubmit: boolean, again: boolean): boolean {
  if (!canSubmit || state === "VERIFIED") return false;
  return state === "PENDING" ? again : true;
}

/** Ссылка «Отправить документы заново» нужна только на экране «на проверке», пока форма скрыта. */
export function showAgainLink(state: KycState, canSubmit: boolean, again: boolean): boolean {
  return state === "PENDING" && canSubmit && !again;
}

/** PDF по имени выбранного файла: для него в сетке значок документа вместо превью (окончательно тип проверяет сервер по байтам). */
export const isPdfName = (name: string): boolean => name.toLowerCase().endsWith(".pdf");

/** Файлы загрузчика → строки `Uploader`: PDF — документ (значок и имя), фото — превью. */
export function documentItems(items: readonly UploaderItem[]): UploaderItem[] {
  return items.map((item) => {
    if (!isPdfName(item.name)) return item;
    // У документа превью нет: значок и имя файла.
    return {
      id: item.id,
      name: item.name,
      kind: "document",
      state: item.state,
      ...(item.progress !== undefined ? { progress: item.progress } : {}),
      ...(item.error !== undefined ? { error: item.error } : {}),
    };
  });
}

const fileId = z.guid(ru.app.masterCompany.kyc.form.errors.reupload);
const m = t.form.errors;

/** Вход действия: id загруженных файлов; хотя бы один в каждом разделе, не больше `KYC_MAX` (как схема модуля). */
export const kycSchema = z.strictObject({
  idFileIds: z.array(fileId).min(1, m.needId).max(KYC_MAX, m.limit(KYC_MAX)),
  registrationFileIds: z.array(fileId).min(1, m.needRegistration).max(KYC_MAX, m.limit(KYC_MAX)),
});

export type KycInput = z.input<typeof kycSchema>;
