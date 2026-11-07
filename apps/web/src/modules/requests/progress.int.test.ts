import { describe, expect, it } from "vitest";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeAccepted, makeMeasured, withFeature } from "../../../test/factories/requests";
import { agreeToContract, getFlowProgress } from "./index";

const code = (c: string) => expect.objectContaining({ code: c });

describe("шкала шагов заявки на экране сделки", () => {
  it("путь ТЗ: шкалы сценария нет — экран сделки её не рисует", async () => {
    const client = await makeClient();
    const { offerId, executor } = await makeAccepted(client);
    expect(await getFlowProgress(client, { offerId })).toMatchObject({ steps: [], current: null });
    expect(await getFlowProgress(executor, { offerId })).toMatchObject({ current: null });
    expect(await getFlowProgress(await makeOperator(), { offerId })).toMatchObject({ current: null });
  });

  it("сценарий до договора: шаги сценария, текущий — договор; при выключенном флаге шкалы нет", async () => {
    const client = await makeClient();
    const { offerId } = await withFeature("FEATURE_PRE_CONTRACT_FLOWS", true, async () => {
      const m = await makeMeasured(client);
      await agreeToContract(client, { requestId: m.requestId });
      expect(await getFlowProgress(client, { offerId: m.offerId })).toEqual({
        flow: "EXECUTOR_MEASURE",
        steps: ["request", "offers", "measure", "project", "contract", "work"],
        current: "contract",
      });
      return m;
    });
    expect(await getFlowProgress(client, { offerId })).toMatchObject({ steps: [], current: null });
  });

  it("чужим — не найдено (IDOR)", async () => {
    const { offerId } = await makeAccepted(await makeClient());
    await expect(getFlowProgress(await makeClient(), { offerId })).rejects.toThrow(code("NOT_FOUND"));
    await expect(getFlowProgress(await makeExecutor({ segment: "COMFORT" }), { offerId })).rejects.toThrow(code("NOT_FOUND"));
    await expect(getFlowProgress(await makeClient(), { offerId: "нет-такого" })).rejects.toThrow(code("NOT_FOUND"));
  });
});
