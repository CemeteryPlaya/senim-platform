import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeFurnitureType } from "../../../test/factories/companies";
import { getOwnProfile, MASK, updateProfile, type ProfileInput } from "./index";

const base: ProfileInput = { about: "Делаю кухни и шкафы", yearsExperience: 5, specializationIds: [], measurementTerms: "FREE", measurementFee: null };

describe("профиль исполнителя", () => {
  it("исполнитель меняет «о себе», опыт, специализации и условия замера", async () => {
    const executor = await makeExecutor({ segment: "COMFORT" });
    const kitchen = await makeFurnitureType({ name: "Кухня" });
    const wardrobe = await makeFurnitureType({ name: "Шкаф" });

    const result = await updateProfile(executor, {
      ...base,
      yearsExperience: 8,
      specializationIds: [kitchen.id, wardrobe.id],
      measurementTerms: "FEE_IF_NO_DEAL",
      measurementFee: 10_000,
    });

    expect(result).toEqual({ aboutMasked: false, about: "Делаю кухни и шкафы" });
    const profile = await getOwnProfile(executor);
    expect(profile).toMatchObject({
      publicNumber: executor.executor.publicNumber,
      segment: "COMFORT",
      about: "Делаю кухни и шкафы",
      yearsExperience: 8,
      measurementTerms: "FEE_IF_NO_DEAL",
      measurementFee: 10_000,
    });
    expect(profile.specializationIds.sort()).toEqual([kitchen.id, wardrobe.id].sort());

    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "executor.profile.updated" } });
    expect(audit).toMatchObject({ actorId: executor.id, entityId: executor.executor.id, scope: `executor:${executor.executor.id}` });
  });

  it("плата за выезд только при FEE_IF_NO_DEAL: без суммы — ошибка, при другом условии сумма стирается", async () => {
    const executor = await makeExecutor();
    await expect(updateProfile(executor, { ...base, measurementTerms: "FEE_IF_NO_DEAL", measurementFee: null })).rejects.toMatchObject({
      code: "VALIDATION",
    });

    await updateProfile(executor, { ...base, measurementTerms: "INCLUDED", measurementFee: 5_000 });
    expect(await getOwnProfile(executor)).toMatchObject({ measurementTerms: "INCLUDED", measurementFee: null });
  });

  it("контакты и наименование в «о себе» скрываются", async () => {
    const executor = await makeExecutor({ legalName: "ТОО «Ағаш Шебер»" });
    const result = await updateProfile(executor, { ...base, about: "Мы Ағаш Шебер. Звоните 87001234567" });
    expect(result).toEqual({ aboutMasked: true, about: `Мы ${MASK}. Звоните ${MASK}` });
    expect((await getOwnProfile(executor)).about).toBe(`Мы ${MASK}. Звоните ${MASK}`);
  });

  it("сегмент не меняется из профиля — его ставит оператор", async () => {
    const executor = await makeExecutor({ segment: "ECONOMY" });
    await updateProfile(executor, { ...base, segment: "PREMIUM" } as ProfileInput);
    expect(await getOwnProfile(executor)).toMatchObject({ segment: "ECONOMY" });
  });

  it("неизвестный или выключенный тип мебели в специализациях — ошибка", async () => {
    const executor = await makeExecutor();
    const off = await makeFurnitureType({ active: false });
    await expect(updateProfile(executor, { ...base, specializationIds: [off.id] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateProfile(executor, { ...base, specializationIds: ["nope"] })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("заказчик и оператор не могут менять профиль исполнителя", async () => {
    for (const user of [await makeClient(), await makeOperator()]) {
      await expect(updateProfile(user, base)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getOwnProfile(user)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
