import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient } from "../../../test/factories";
import { makeExecutorWithTerms, makeMeasuring, makeOpenRequest, offerInput, withFeature } from "../../../test/factories/requests";
import { completeMeasurement, sendOffer } from "./index";

/** Анонимность до договора: тексты исполнителя, которые видит заказчик, — без контактов и без наименования. */
describe("тексты исполнителя для заказчика", () => {
  it("комментарий отклика: телефон, мессенджер и наименование скрыты", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
    const executor = await makeExecutorWithTerms("COMFORT");
    const { legalName } = await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } });

    const { offerId } = await sendOffer(executor, {
      ...offerInput(requestId),
      comment: `Звоните +7 701 123 45 67 или wa.me/77011234567, ${legalName}. Срок 30 дней.`,
    });

    const { comment } = await db.offer.findUniqueOrThrow({ where: { id: offerId } });
    expect(comment).not.toMatch(/701|wa\.me/);
    expect(comment).not.toContain(legalName.replace(/^ИП\s+/, ""));
    expect(comment).toContain("Срок 30 дней");
  });

  it("итог замера: контакты скрыты, полноширинные цифры не обходят маску", async () => {
    let measurementId = "";
    // Замер до договора — сценарий под флагом preContractFlows.
    await withFeature("FEATURE_PRE_CONTRACT_FLOWS", true, async () => {
      const m = await makeMeasuring(await makeClient());
      await completeMeasurement(m.executor, { measurementId: m.measurementId, finalPrice: 600_000, result: "Ниша 3 м, мой номер ７０１ １２３ ４５ ６７" });
      measurementId = m.measurementId;
    });

    const { result } = await db.measurement.findUniqueOrThrow({ where: { id: measurementId } });
    expect(result).toContain("Ниша 3 м");
    expect(result).not.toMatch(/701|７０１/);
  });
});
