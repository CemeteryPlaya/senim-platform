import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeClient, makeExecutor } from "../../../test/factories";
import { searchAudit } from "./audit-log";
import { resetDemoData, setPaymentRail } from "./demo";
import { getDisputeCard, listDisputes, resolveDispute } from "./disputes";
import { addExecutor, changeSegment, getExecutorCard, listExecutors, listRegistrationQueue, reviewRegistration } from "./executors";
import { addFurnitureType, listFurnitureTypes, moveFurnitureType, renameFurnitureType, setFurnitureTypeActive } from "./furniture-types";
import { buildCsv, buildReport } from "./report";
import { listStaleRequests } from "./requests";
import { addExecutorSchema } from "./schemas";

// Каждое действие панели — только оператору. Сервис проверяет роль сам, не полагаясь на экран.
const ACTIONS: Record<string, (u: CurrentUser) => Promise<unknown>> = {
  listRegistrationQueue: (u) => listRegistrationQueue(u),
  listExecutors: (u) => listExecutors(u),
  getExecutorCard: (u) => getExecutorCard(u, "x"),
  reviewRegistration: (u) => reviewRegistration(u, { profileId: "x", decision: { approve: true, segment: "ECONOMY" } }),
  addExecutor: (u) => addExecutor(u, addExecutorSchema.parse({ phone: "+77009998877", legalForm: "IP", legalName: "ИП Тест", binIin: "900101300017", segment: "ECONOMY" })),
  changeSegment: (u) => changeSegment(u, { profileId: "x", from: "ECONOMY", to: "COMFORT", reason: "причина" }),
  listFurnitureTypes: (u) => listFurnitureTypes(u),
  addFurnitureType: (u) => addFurnitureType(u, { name: "Тип" }),
  renameFurnitureType: (u) => renameFurnitureType(u, { id: "x", name: "Тип" }),
  setFurnitureTypeActive: (u) => setFurnitureTypeActive(u, { id: "x", active: false }),
  moveFurnitureType: (u) => moveFurnitureType(u, { id: "x", direction: "up" }),
  listStaleRequests: (u) => listStaleRequests(u, { hours: 24 }),
  listDisputes: (u) => listDisputes(u),
  getDisputeCard: (u) => getDisputeCard(u, "x"),
  resolveDispute: (u) => resolveDispute(u, { disputeId: "x", decision: "FAVOR_CLIENT", rationale: "обоснование решения" }),
  searchAudit: (u) => searchAudit(u, {}),
  buildReport: (u) => buildReport(u, { staleDays: 3 }),
  buildCsv: (u) => buildCsv(u, { kind: "deals", staleDays: 3 }),
  resetDemoData: (u) => resetDemoData(u),
  setPaymentRail: (u) => setPaymentRail(u, { mode: "escrow-simulator" }),
};

describe("доступ к панели оператора", () => {
  beforeEach(() => {
    process.env.DEMO_MODE = "true";
    resetEnvCache();
  });
  afterEach(() => {
    delete process.env.DEMO_MODE;
    resetEnvCache();
  });

  for (const [name, call] of Object.entries(ACTIONS)) {
    it(`${name}: заказчику и исполнителю запрещено, данные не меняются`, async () => {
      const client = await makeClient();
      const executor = await makeExecutor();
      const counts = async () => ({ users: await db.user.count(), audit: await db.auditEvent.count(), types: await db.furnitureType.count() });
      const before = await counts();

      await expect(call(client)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(call(executor)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await counts()).toEqual(before);
    });
  }
});
