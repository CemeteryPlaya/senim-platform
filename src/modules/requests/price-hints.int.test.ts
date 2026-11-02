import { describe, expect, it } from "vitest";
import { makeClient } from "../../../test/factories";
import { makeExecutorWithTerms, makeFurnitureType, makeOpenRequest, offerInput } from "../../../test/factories/requests";
import { segmentPriceHints, sendOffer, withdrawOffer } from "./index";

describe("вилка цены на экране «Уровень»", () => {
  it("считается по откликам на заявки того же типа и уровня; отозванные и чужие типы не входят", async () => {
    const client = await makeClient();
    const kitchen = await makeFurnitureType("Кухня");
    const hallway = await makeFurnitureType("Прихожая");
    const comfort = await makeOpenRequest(client, { typeId: kitchen.id, segment: "COMFORT" });
    const premium = await makeOpenRequest(client, { typeId: kitchen.id, segment: "PREMIUM" });
    const otherType = await makeOpenRequest(client, { typeId: hallway.id, segment: "COMFORT" });

    for (const price of [600_000, 700_000, 800_000, 900_000]) {
      await sendOffer(await makeExecutorWithTerms("COMFORT"), offerInput(comfort, price));
    }
    const withdrawn = await makeExecutorWithTerms("COMFORT");
    const { offerId } = await sendOffer(withdrawn, offerInput(comfort, 5_000_000));
    await withdrawOffer(withdrawn, { offerId });
    await sendOffer(await makeExecutorWithTerms("COMFORT"), offerInput(otherType, 10_000));
    await sendOffer(await makeExecutorWithTerms("PREMIUM"), offerInput(premium, 2_000_000));

    expect(await segmentPriceHints(kitchen.id)).toEqual({
      ECONOMY: null,
      COMFORT: { from: 600_000, to: 800_000, count: 4 },
      // Один отклик — это цена конкретного исполнителя, вилку не показываем.
      PREMIUM: null,
    });
  });

  it("свой тип мебели — вилок нет", async () => {
    expect(await segmentPriceHints(null)).toEqual({ ECONOMY: null, COMFORT: null, PREMIUM: null });
  });
});
