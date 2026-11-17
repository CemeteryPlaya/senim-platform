"use server";

import { setHighlights } from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { ru } from "@/i18n/ru";
import { AppError } from "@/platform/errors";
import { bestSchema } from "./_parts/best-schema";

// «Лучшие работы» мастера: схема → `requireUser("EXECUTOR")` первой строкой → модуль companies (замена набора целиком,
// аудит, проверка владения и показа — в модуле). Отказы модуля — тексты экрана мастера.

const t = ru.app.masterPortfolio.best.errors;
const m = ru.companies.highlights.errors;

function failure(e: unknown): unknown {
  if (!(e instanceof AppError)) return e;
  switch (e.message) {
    case m.approvedOnly:
      return new AppError(e.code, t.approvedOnly);
    case m.notFound:
    case m.workNotPublished:
    case m.workFromDeal:
    case m.dealNotShowable:
      return new AppError(e.code, t.changed);
    default:
      return e;
  }
}

export const saveBestAction = action("app.executor.saveBest", bestSchema, async ({ items }) => {
  const user = await requireUser("EXECUTOR");
  try {
    await setHighlights(user, { items });
  } catch (e) {
    throw failure(e);
  }
});
