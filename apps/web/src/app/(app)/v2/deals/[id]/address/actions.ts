"use server";

import { requireUser } from "@/modules/identity";
import { dealAddressSchema, geocodeAddress, geocodeSchema, setDealAddress } from "@/modules/requests";
import { action } from "@/platform/action";

// Адрес сделки (ADR-016): схема модуля, затем `requireUser("CLIENT")` первой строкой. «Ваша сделка», «не окончена» и запись
// с аудитом в одной транзакции проверяет и делает модуль requests. Повтор с тем же адресом ничего не пишет.

/** «Сохранить адрес»: строка адреса и необязательная точка на карте. */
export const saveDealAddressAction = action("app.deal.address", dealAddressSchema, async ({ dealId, ...address }) => {
  const user = await requireUser("CLIENT");
  await setDealAddress(user, dealId, address);
});

/** «Найти по адресу»: точка от геокодера (сейчас мок — только центр города) или `null`. */
export const locateDealAddressAction = action("app.deal.address.locate", geocodeSchema, async (input) => {
  const user = await requireUser("CLIENT");
  return geocodeAddress(user, input);
});
