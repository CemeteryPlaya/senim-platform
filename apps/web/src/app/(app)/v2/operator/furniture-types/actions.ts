"use server";

import { z } from "zod";
import { requireUser } from "@/modules/identity";
import {
  addFurnitureType,
  addFurnitureTypeSchema,
  moveFurnitureType,
  moveFurnitureTypeSchema,
  renameFurnitureType,
  renameFurnitureTypeSchema,
  setFurnitureTypeActive,
  setFurnitureTypeActiveSchema,
} from "@/modules/operator";
import { action } from "@/platform/action";

// Справочник типов мебели: вход — неизвестные данные, схема модуля разбирает их целиком, затем роль — первой строкой.

/** Новый тип в конец списка; название уникально без учёта регистра (повтор — CONFLICT). */
export const addFurnitureTypeAction = action("app.operator.addFurnitureType", z.unknown().pipe(addFurnitureTypeSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await addFurnitureType(user, input);
});

export const renameFurnitureTypeAction = action("app.operator.renameFurnitureType", z.unknown().pipe(renameFurnitureTypeSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await renameFurnitureType(user, input);
});

/** Скрыть или вернуть тип; повтор с тем же значением ничего не меняет. */
export const setFurnitureTypeActiveAction = action("app.operator.setFurnitureTypeActive", z.unknown().pipe(setFurnitureTypeActiveSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await setFurnitureTypeActive(user, input);
});

/** Сдвинуть на одну позицию; у края списка — без изменений. */
export const moveFurnitureTypeAction = action("app.operator.moveFurnitureType", z.unknown().pipe(moveFurnitureTypeSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await moveFurnitureType(user, input);
});
