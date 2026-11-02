import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { actingAs, makeClient, makeExecutor } from "../../../test/factories";
import { makeChosen, makeOpenRequest, offerInput } from "../../../test/factories/requests";
import { listIncomingRequests, listMyOffers, sendOffer, withdrawOffer } from "./index";

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));

async function photo(client: { id: string }, n: number) {
  return db.storedFile.create({
    data: { storageKey: `test/room-${client.id}-${n}`, provider: "local", purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 1, sha256: "x", uploadedById: client.id },
  });
}

describe("входящие заявки исполнителя: обложка карточки", () => {
  it("первое фото помещения; без фото — null", async () => {
    const client = await makeClient();
    const withPhotos = await makeOpenRequest(client, { segment: "COMFORT" });
    const without = await makeOpenRequest(client, { segment: "COMFORT" });
    const [a, b] = [await photo(client, 1), await photo(client, 2)];
    // Фото помещения прикрепляются к заявке мастером; после отправки — тем же полем заявки.
    await db.storedFile.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { requestId: withPhotos } });
    await db.storedFile.update({ where: { id: b.id }, data: { sortOrder: 1 } });

    const list = await listIncomingRequests(await makeExecutor({ segment: "COMFORT" }));
    const cover = (id: string) => list.find((r) => r.id === id)?.cover;

    expect(cover(withPhotos)).toMatchObject({ id: a.id, src: expect.any(String) });
    expect(cover(without)).toBeNull();
  });
});

describe("мои отклики исполнителя", () => {
  it("свои отклики по любым заявкам, новые сверху; чужие не видны", async () => {
    const client = await makeClient();
    const me = await makeExecutor({ segment: "COMFORT" });
    const other = await makeExecutor({ segment: "COMFORT" });
    const first = await makeOpenRequest(client, { segment: "COMFORT" });
    const second = await makeOpenRequest(client, { segment: "COMFORT" });
    await sendOffer(me, offerInput(first, 400_000));
    const { offerId } = await sendOffer(me, offerInput(second, 450_000));
    await sendOffer(other, offerInput(second, 999_000));
    await withdrawOffer(me, { offerId });

    const mine = await listMyOffers(me);

    expect(mine.map((o) => ({ requestId: o.requestId, price: o.price, status: o.status }))).toEqual([
      { requestId: second, price: 450_000, status: "WITHDRAWN" },
      { requestId: first, price: 400_000, status: "SENT" },
    ]);
    expect(mine[0]).toMatchObject({ number: expect.any(Number), title: "Кухня", city: "Астана", requestStatus: "OPEN", cover: null, measurement: null });
  });

  it("выбранный отклик остаётся в списке после того, как заявка закрылась для других", async () => {
    const client = await makeClient();
    const { requestId, executor } = await makeChosen(client);

    expect(await listMyOffers(executor)).toEqual([expect.objectContaining({ requestId, status: "ACCEPTED", requestStatus: "OFFER_CHOSEN" })]);
  });

  it("заказчику и исполнителю в роли заказчика — отказ", async () => {
    const both = await makeExecutor({ segment: "COMFORT", roles: ["EXECUTOR", "CLIENT"] });
    expect(await code(listMyOffers(await makeClient()))).toBe("FORBIDDEN");
    expect(await code(listMyOffers(actingAs(both, "CLIENT")))).toBe("FORBIDDEN");
  });
});
