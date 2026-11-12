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

export const addMaterialPriceAction = action("operator.addMaterialPrice", z.unknown().pipe(addMaterialPriceSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await addMaterialPrice(user, input);
});

export const changeMaterialPriceAction = action("operator.changeMaterialPrice", z.unknown().pipe(changeMaterialPriceSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await changeMaterialPrice(user, input);
});

export const setMaterialPriceActiveAction = action("operator.setMaterialPriceActive", z.unknown().pipe(setMaterialPriceActiveSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await setMaterialPriceActive(user, input);
});
