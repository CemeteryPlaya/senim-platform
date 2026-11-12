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

export const addFurnitureTypeAction = action("operator.addFurnitureType", z.unknown().pipe(addFurnitureTypeSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await addFurnitureType(user, input);
});

export const renameFurnitureTypeAction = action("operator.renameFurnitureType", z.unknown().pipe(renameFurnitureTypeSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await renameFurnitureType(user, input);
});

export const setFurnitureTypeActiveAction = action("operator.setFurnitureTypeActive", z.unknown().pipe(setFurnitureTypeActiveSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await setFurnitureTypeActive(user, input);
});

export const moveFurnitureTypeAction = action("operator.moveFurnitureType", z.unknown().pipe(moveFurnitureTypeSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await moveFurnitureType(user, input);
});
