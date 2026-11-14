import { ru } from "@/i18n/ru";
import { AppError } from "@/platform/errors";
import type { AnswerField, LegalForm } from "./schema";

// Отказы регистрации (модуль identity и сервис identity) → тексты и поля анкеты v2. Модуль говорит словами v1
// («исполнитель», «заказчик»), экран мастера — своими (`ru.app.masterRegister.errors`); ошибки о данных — у полей.

const t = ru.app.masterRegister.errors;
const registration = ru.identity.registration.errors;
const person = ru.identity.clientIdentity;

/** «Анкета уже подана» (профиль на проверке или одобрен): повтор отправки — тот же итог, экран статуса. */
export function isAlreadyRegistered(e: unknown): boolean {
  return e instanceof AppError && e.code === "CONFLICT" && e.message === registration.alreadyRegistered;
}

/** Поле подписанта: у самозанятого это наименование (его ФИО), у ИП — владелец, у ТОО — директор. */
function signerName(legalForm: LegalForm): { field: AnswerField; message: string } {
  switch (legalForm) {
    case "SELF_EMPLOYED":
      return { field: "legalName", message: t.selfEmployedName };
    case "IP":
      return { field: "ownerName", message: t.ownerName };
    case "TOO":
      return { field: "directorName", message: t.directorName };
  }
}

/**
 * Отказ → отказ с текстом v2: ошибки данных — у поля (`fieldErrors`), прочие — общей ошибкой формы. Неизвестное (сбой,
 * недоступность — тексты `ru.common`) идёт как есть. ИИН/БИН человека в тексты не попадает.
 */
export function v2Failure(e: unknown, legalForm: LegalForm): unknown {
  if (!(e instanceof AppError)) return e;
  const atField = (field: AnswerField, message: string) => new AppError(e.code, message, { fieldErrors: { [field]: [message] } });
  const general = (message: string) => new AppError(e.code, message);
  switch (e.message) {
    case registration.binIinTaken:
      return atField("binIin", t.binIinTaken);
    case registration.binIinInvalid:
    case registration.personMissing:
      // У ТОО — его БИН; у ИП и самозанятого номер берётся из знакомства, исправить его в анкете нельзя.
      return atField("binIin", legalForm === "TOO" ? t.bin : t.ownIinInvalid);
    case person.fullNameInvalid: {
      const signer = signerName(legalForm);
      return atField(signer.field, signer.message);
    }
    case person.iinInvalid:
      return atField("directorIin", t.directorIin);
    case registration.signerRequired:
      return general(t.signerRequired);
    case registration.partyExists:
      return general(t.partyExists);
    case registration.tooMany:
      return general(t.tooMany);
    default:
      return e;
  }
}
