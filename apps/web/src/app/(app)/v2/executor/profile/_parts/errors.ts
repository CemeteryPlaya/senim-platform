import { ru } from "@/i18n/ru";
import { AppError } from "@/platform/errors";

// Отказы модулей мастера → тексты и поля v2. Модули говорят словами v1 («исполнитель», «заказчик», «выплата»), экран
// мастера — своими (`ru.app.masterCompany`); ошибки о данных — у поля. Неизвестное идёт как есть.

const t = ru.app.masterCompany;

const atField = (e: AppError, field: string, message: string) => new AppError(e.code, message, { fieldErrors: { [field]: [message] } });

/** Отказ модуля companies при сохранении компании. */
export function companyFailure(e: unknown): unknown {
  if (!(e instanceof AppError)) return e;
  if (e.message === ru.companies.errors.unknownFurnitureType) return atField(e, "specializationIds", t.company.form.errors.unknownType);
  if (e.message === ru.companies.errors.executorOnly) return new AppError(e.code, t.shared.saveFailed);
  return e;
}

/** Отказ модуля identity при отправке документов. */
export function kycFailure(e: unknown): unknown {
  if (!(e instanceof AppError)) return e;
  const k = ru.identity.kyc.errors;
  const m = t.kyc.form.errors;
  switch (e.message) {
    // Файл чужой, не того назначения или уже прикреплён (повтор отправки): модули files и identity говорят разными словами.
    case ru.files.errors.notOwn:
    case ru.files.errors.alreadyAttached:
    case k.notOwn:
      return new AppError(e.code, m.alreadySent);
    case k.alreadyVerified:
      return new AppError(e.code, m.alreadyVerified);
    case k.partyMissing:
      return new AppError(e.code, m.noProfile);
    case k.reupload:
      return new AppError(e.code, m.reupload);
    default:
      return e;
  }
}

/** Отказ при сохранении счёта: оплата в обработке — у поля, нет профиля — общей ошибкой. */
export function payoutFailure(e: unknown): unknown {
  if (!(e instanceof AppError)) return e;
  const m = t.payout.form.errors;
  if (e.message === ru.payments.errors.payoutPending) return atField(e, "iban", m.locked);
  if (e.message === ru.identity.payout.errors.partyMissing) return new AppError(e.code, m.noProfile);
  return e;
}
