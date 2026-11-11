import { beforeEach, describe, expect, it, vi } from "vitest";
import { testBin, testIin } from "@/demo/kz-id";
import { registerExecutor, type CurrentUser, type ExecutorRegistrationInput } from "@/modules/identity";
import { encryptPii, hashPii, last4 } from "@/platform/crypto";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeFurnitureType } from "../../../test/factories/companies";
import { freshBrowser } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { getOwnProfile, MASK, updateProfile, type ProfileInput } from "./index";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

/**
 * Исполнитель после анкеты: в аккаунте нет ФИО, подписанта знает только профиль. ИП и самозанятый работают по ИИН
 * личности (он в identity), у ТОО ИИН аккаунта нет вовсе.
 */
async function registeredExecutor(input: Omit<ExecutorRegistrationInput, "city" | "yearsExperience">): Promise<CurrentUser> {
  const user = await makeClient();
  const iin = input.legalForm === "TOO" ? null : input.binIin;
  const iinData = iin ? { iinEnc: encryptPii(iin), iinHash: hashPii(iin), iinLast4: last4(iin) } : { iinEnc: null, iinHash: null, iinLast4: null };
  await db.user.update({ where: { id: user.id }, data: { fullName: null, ...iinData } });
  await signInAs(user);
  const { profileId } = await registerExecutor(user, { ...input, city: "Астана", yearsExperience: 3 });
  const profile = await db.executorProfile.findUniqueOrThrow({ where: { id: profileId } });
  return { ...user, fullName: null, role: "EXECUTOR", executor: { id: profileId, publicNumber: profile.publicNumber, status: profile.status } };
}

const base: ProfileInput = {
  about: "Делаю кухни и шкафы",
  yearsExperience: 5,
  specializationIds: [],
  measurementTerms: "FREE",
  measurementFee: null,
  city: "Астана",
  district: "",
  streetAddress: "",
};

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

  it("адрес мастерской или офиса (№6): город, район, улица; в журнале — до и после", async () => {
    const executor = await makeExecutor();

    await updateProfile(executor, { ...base, city: " Алматы ", district: " Бостандыкский район ", streetAddress: " ул. Тимирязева, 42 " });

    expect(await getOwnProfile(executor)).toMatchObject({ city: "Алматы", district: "Бостандыкский район", streetAddress: "ул. Тимирязева, 42" });
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "executor.profile.updated" } });
    expect(audit.before).toMatchObject({ city: "Астана", district: "", streetAddress: "" });
    expect(audit.after).toMatchObject({ city: "Алматы", district: "Бостандыкский район", streetAddress: "ул. Тимирязева, 42" });

    await expect(updateProfile(executor, { ...base, city: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateProfile(executor, { ...base, streetAddress: "у".repeat(201) })).rejects.toMatchObject({ code: "VALIDATION" });
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

  it("имя и фамилия владельца аккаунта в «о себе» скрываются, даже через невидимые символы", async () => {
    const executor = await makeExecutor({ legalName: "ТОО «Ағаш Шебер»" });
    await db.user.update({ where: { id: executor.id }, data: { fullName: "Ерлан Жумабаев" } });
    const result = await updateProfile(executor, { ...base, about: "Директор — Ерлан Жума​баев, спросите Ерлана" });
    expect(result).toEqual({ aboutMasked: true, about: `Директор — ${MASK}, спросите ${MASK}` });
  });

  it("ИП, зарегистрированный через анкету: слова ФИО владельца скрываются по отдельности и в падежах", async () => {
    const executor = await registeredExecutor({ legalForm: "IP", legalName: "ИП «Дала»", binIin: testIin("910803", 3, 81), signer: { fullName: "Жумабаев Ерлан", iin: null } });
    const result = await updateProfile(executor, { ...base, about: "Спросите Жумабаева Ерлана или просто Ерлана" });
    expect(result).toEqual({ aboutMasked: true, about: `Спросите ${MASK} или просто ${MASK}` });
  });

  it("ТОО, зарегистрированное через анкету: слова ФИО директора скрываются", async () => {
    const signer = { fullName: "Тулегенов Бауыржан", iin: testIin("800215", 3, 81) };
    const executor = await registeredExecutor({ legalForm: "TOO", legalName: "ТОО «Ағаш Шебер»", binIin: testBin("2101", 81), signer });
    const result = await updateProfile(executor, { ...base, about: "Работы принимает Бауыржан Тулегенов лично" });
    expect(result).toEqual({ aboutMasked: true, about: `Работы принимает ${MASK} лично` });
  });

  it("ИП без подписанта в профиле (до ADR-003): ФИО берётся из наименования без «ИП» и кавычек", async () => {
    const executor = await makeExecutor({ legalName: "ИП «Жумабаев Ерлан»" });
    await db.executorProfile.update({ where: { id: executor.executor.id }, data: { signerFullName: null } });
    await db.user.update({ where: { id: executor.id }, data: { fullName: null } });
    const result = await updateProfile(executor, { ...base, about: "Звоните Ерлану" });
    expect(result).toEqual({ aboutMasked: true, about: `Звоните ${MASK}` });
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
