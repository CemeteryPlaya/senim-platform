"use server";

import {
  attachPortfolioPhotos,
  createPortfolioItem,
  deletePortfolioItem,
  getOwnPortfolioItem,
  removePortfolioPhoto,
  setPortfolioPublished,
  updatePortfolioItem,
} from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { logger } from "@/platform/logger";
import { actionFailure, workFailure } from "./_parts/errors";
import { createWorkSchema, deleteWorkSchema, setPublishedSchema, updateWorkSchema } from "./_parts/work-schema";

// Действия портфолио мастера (v2): схема → `requireUser("EXECUTOR")` первой строкой → модуль companies. Владение работой
// проверяет модуль: чужая работа — NOT_FOUND, как будто её нет. Названия и описание проходят маску имени и контактов в
// модуле; ответ несёт признак «что-то убрано» и сохранённые тексты.

/**
 * Новая работа и её фото. Работа с фото создаётся скрытой, фото прикрепляются следом отдельным шагом модуля, и только
 * после успеха работа публикуется (если мастер так выбрал): в каталоге не появится работа без фото. Если прикрепить не
 * вышло, работа остаётся скрытой, а ответ говорит об этом (`photosAttached: false`) — форма ведёт в правку работы, не
 * создавая вторую. Без фото работа создаётся сразу с выбором мастера. Повтор с тем же ключом (`clientKey`, обрыв связи
 * после записи) отдаёт ту же работу и прикрепляет только те фото, которых у неё ещё нет.
 */
export const createWorkAction = action("app.executor.createWork", createWorkSchema, async ({ fileIds, ...fields }) => {
  const user = await requireUser("EXECUTOR");
  try {
    if (fileIds.length === 0) {
      const { id, masked } = await createPortfolioItem(user, fields);
      return { id, masked, photosAttached: true };
    }
    const { id, masked, replayed } = await createPortfolioItem(user, { ...fields, published: false });
    const have = replayed ? new Set((await getOwnPortfolioItem(user, id)).photos.map((p) => p.id)) : new Set<string>();
    const missing = fileIds.filter((fileId) => !have.has(fileId));
    try {
      if (missing.length > 0) await attachPortfolioPhotos(user, id, missing);
    } catch (e) {
      logger.warn("app.executor.createWork: photos not attached", { error: e });
      return { id, masked, photosAttached: false };
    }
    if (fields.published) await setPortfolioPublished(user, id, true);
    return { id, masked, photosAttached: true };
  } catch (e) {
    throw workFailure(e);
  }
});

/**
 * Правка работы: поля, затем фото по разнице с сохранёнными (убранные открепляются, новые прикрепляются). Повтор
 * безопасен: поля те же, разница пересчитывается по базе. В ответе — сохранённые тексты (после маски) и признак маски.
 */
export const updateWorkAction = action("app.executor.updateWork", updateWorkSchema, async ({ id, fileIds, ...fields }) => {
  const user = await requireUser("EXECUTOR");
  try {
    const current = await getOwnPortfolioItem(user, id);
    const { masked } = await updatePortfolioItem(user, id, fields);
    const have = new Set(current.photos.map((p) => p.id));
    const want = new Set(fileIds);
    for (const fileId of have) if (!want.has(fileId)) await removePortfolioPhoto(user, id, fileId);
    const added = fileIds.filter((fileId) => !have.has(fileId));
    if (added.length > 0) await attachPortfolioPhotos(user, id, added);
    const saved = await getOwnPortfolioItem(user, id);
    return { masked, title: saved.title, description: saved.description };
  } catch (e) {
    throw workFailure(e);
  }
});

/** Опубликовать или скрыть из каталога. Повтор с тем же значением ничего не меняет. */
export const setWorkPublishedAction = action("app.executor.setWorkPublished", setPublishedSchema, async ({ id, published }) => {
  const user = await requireUser("EXECUTOR");
  try {
    await setPortfolioPublished(user, id, published);
    return { published };
  } catch (e) {
    throw actionFailure(e);
  }
});

/** Удалить работу. Есть заявки «Хочу похожее» по этой работе — модуль отказывает: её можно только скрыть. */
export const deleteWorkAction = action("app.executor.deleteWork", deleteWorkSchema, async ({ id }) => {
  const user = await requireUser("EXECUTOR");
  try {
    await deletePortfolioItem(user, id);
    return { id };
  } catch (e) {
    throw actionFailure(e);
  }
});
