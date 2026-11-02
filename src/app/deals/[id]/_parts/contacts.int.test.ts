import { describe, expect, it } from "vitest";
import { dealAt, makeDeal } from "../../../../../test/factories/deal";
import { makeOperator } from "../../../../../test/factories";
import { getDealView } from "@/modules/deal-core";
import { formatPhone } from "@/modules/identity";
import { db } from "@/platform/db";
import { otherPartyContacts } from "./contacts";

/** ТЗ п. 3, ADR-009 раздел 7: контакты сторон скрыты до заключения оферты, после — видны обеим сторонам. */
describe("контакты другой стороны на карточке сделки", () => {
  it("до заключения оферты — ничего ни покупателю, ни мастеру", async () => {
    const f = await makeDeal();
    expect(await otherPartyContacts(await getDealView(f.client, f.dealId))).toBeNull();
    expect(await otherPartyContacts(await getDealView(f.executor, f.dealId))).toBeNull();
  });

  it("после оферты покупатель видит телефон и Instagram мастера, мастер — покупателя", async () => {
    const f = await dealAt("SIGNED");
    await db.user.update({ where: { id: f.executor.id }, data: { instagram: "master_mebel" } });
    const [client, executor] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: f.client.id } }),
      db.user.findUniqueOrThrow({ where: { id: f.executor.id } }),
    ]);

    expect(await otherPartyContacts(await getDealView(f.client, f.dealId))).toEqual({ phone: formatPhone(executor.phone), instagram: "master_mebel" });
    expect(await otherPartyContacts(await getDealView(f.executor, f.dealId))).toEqual({ phone: formatPhone(client.phone), instagram: client.instagram });
  });

  it("оператору блок контактов не нужен — null", async () => {
    const f = await dealAt("SIGNED");
    expect(await otherPartyContacts(await getDealView(await makeOperator(), f.dealId))).toBeNull();
  });
});
