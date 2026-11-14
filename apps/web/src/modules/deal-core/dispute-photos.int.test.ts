import { describe, expect, it } from "vitest";
import { makeClient, makeOperator } from "../../../test/factories";
import { dealAt, makePhoto } from "../../../test/factories/deal";
import { disputePhotos, openDispute } from "./index";

const open = async (f: Awaited<ReturnType<typeof dealAt>>, photos: number) =>
  openDispute(f.client, {
    dealId: f.dealId,
    reason: "QUALITY",
    description: "Фасады не совпадают с договором",
    photoIds: await Promise.all(Array.from({ length: photos }, () => makePhoto(f.client, "DISPUTE"))),
  });

describe("disputePhotos: фото последнего спора", () => {
  it("сторона сделки видит фото спора адресами; спора нет — пусто", async () => {
    const f = await dealAt("PAID_HOLD");
    expect(await disputePhotos(f.client, f.dealId)).toEqual([]);
    await open(f, 2);
    const mine = await disputePhotos(f.client, f.dealId);
    expect(mine).toHaveLength(2);
    for (const photo of mine) expect(photo.src).toMatch(/^(\/|https?:)/);
    expect((await disputePhotos(f.executor, f.dealId)).map((p) => p.id).sort()).toEqual(mine.map((p) => p.id).sort());
  });

  it("оператор видит фото спора; мастер другой сделки — «не найдено»", async () => {
    const f = await dealAt("PAID_HOLD");
    await open(f, 1);
    expect(await disputePhotos(await makeOperator(), f.dealId)).toHaveLength(1);
    const other = await dealAt("PAID_HOLD");
    await expect(disputePhotos(other.executor, f.dealId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("чужой — «не найдено», несуществующая сделка — тоже", async () => {
    const f = await dealAt("PAID_HOLD");
    await open(f, 1);
    await expect(disputePhotos(await makeClient("Нурланов Айдос Ержанович"), f.dealId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(disputePhotos(f.client, "net-takoj")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
