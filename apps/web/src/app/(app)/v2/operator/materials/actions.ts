"use server";

import { z } from "zod";
import { requireUser } from "@/modules/identity";
import {
  addMaterialPrice,
  addMaterialPriceSchema,
  changeMaterialPrice,
  changeMaterialPriceSchema,
  setMaterialPriceActive,
  setMaterialPriceActiveSchema,
} from "@/modules/operator";
import { action } from "@/platform/action";

// Справочник цен материалов (ADR-007): вход — неизвестные данные, схема модуля разбирает их целиком (флажки уровней
// `segment_<УРОВЕНЬ>` — тоже), затем роль — первой строкой. Выключенный флаг «Калькулятор материалов» — FORBIDDEN в модуле.

export const addMaterialPriceAction = action("app.operator.addMaterialPrice", z.unknown().pipe(addMaterialPriceSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await addMaterialPrice(user, input);
});

/** `from` — цена, которую видел оператор: если её уже изменили, модуль не перезапишет чужое. */
export const changeMaterialPriceAction = action("app.operator.changeMaterialPrice", z.unknown().pipe(changeMaterialPriceSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await changeMaterialPrice(user, input);
});

export const setMaterialPriceActiveAction = action("app.operator.setMaterialPriceActive", z.unknown().pipe(setMaterialPriceActiveSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await setMaterialPriceActive(user, input);
});
