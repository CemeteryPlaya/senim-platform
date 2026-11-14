import { ru } from "@/i18n/ru";
import { AppError } from "@/platform/errors";
import { PHOTOS_MAX } from "./work-schema";

// Отказы модулей companies и files → тексты и поля v2. Модули говорят словами v1, экран мастера — своими
// (`ru.app.masterPortfolio`); ошибки о данных — у поля. Неизвестное идёт как есть.

const t = ru.app.masterPortfolio;

const atField = (e: AppError, field: string, message: string) => new AppError(e.code, message, { fieldErrors: { [field]: [message] } });

/** Отказ модуля при создании и правке работы. */
export function workFailure(e: unknown): unknown {
  if (!(e instanceof AppError)) return e;
  const m = t.form.errors;
  switch (e.message) {
    case ru.companies.errors.unknownFurnitureType:
      return atField(e, "furnitureTypeId", m.unknownType);
    case ru.companies.dealPortfolio.errors.place:
      return atField(e, "place", m.place);
    case ru.companies.portfolio.errors.tooManyPhotos(PHOTOS_MAX):
      return atField(e, "fileIds", m.photos(PHOTOS_MAX));
    case ru.companies.portfolio.errors.notFound:
      return new AppError(e.code, m.notFound);
    case ru.companies.errors.executorOnly:
      return new AppError(e.code, m.failed);
    // Файл чужой, не того назначения или уже прикреплён: модули files и companies говорят разными словами.
    case ru.files.errors.notOwn:
    case ru.files.errors.alreadyAttached:
      return atField(e, "fileIds", m.photoAttach);
    default:
      return e;
  }
}

/** Отказ модуля при публикации и удалении. */
export function actionFailure(e: unknown): unknown {
  if (!(e instanceof AppError)) return e;
  switch (e.message) {
    case ru.companies.portfolio.errors.notFound:
      return new AppError(e.code, t.form.errors.notFound);
    case ru.companies.portfolio.errors.hasRequests:
      return new AppError(e.code, t.actions.hasRequests);
    case ru.companies.errors.executorOnly:
      return new AppError(e.code, t.form.errors.failed);
    default:
      return e;
  }
}
