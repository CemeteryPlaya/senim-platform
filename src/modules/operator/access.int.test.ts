import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeClient, makeExecutor } from "../../../test/factories";
import { searchAudit } from "./audit-log";
import { getOperatorDeal, listOperatorDeals } from "./deals";
import { resetDemoData } from "./demo";
import { getDisputeCard, listDisputes, previewDisputeSplit, resolveDispute } from "./disputes";
import { addExecutor, changeSegment, getExecutorCard, listExecutors, listRegistrationQueue, reviewRegistration } from "./executors";
import { addFurnitureType, listFurnitureTypes, moveFurnitureType, renameFurnitureType, setFurnitureTypeActive } from "./furniture-types";
import { kycQueue, reviewKyc } from "./kyc";
import { confirmBankOperation, failBankOperation, listMoneyQueue, saveBankDocument } from "./money";
import { buildCsv, buildIncomeCsv, buildReport, incomeReport } from "./report";
import { listStaleRequests } from "./requests";
import { addExecutorSchema } from "./schemas";
import { platformSettings } from "./settings";

const PERIOD = { from: new Date("2026-11-01"), to: new Date("2026-12-01") };

// Каждое действие панели — только оператору. Сервис проверяет роль сам, не полагаясь на экран.
const ACTIONS: Record<string, (u: CurrentUser) => Promise<unknown>> = {
  listRegistrationQueue: (u) => listRegistrationQueue(u),
  listExecutors: (u) => listExecutors(u),
  getExecutorCard: (u) => getExecutorCard(u, "x"),
  reviewRegistration: (u) => reviewRegistration(u, { profileId: "x", decision: { approve: true, segment: "ECONOMY" } }),
  addExecutor: (u) => addExecutor(u, addExecutorSchema.parse({ phone: "+77009998877", legalForm: "IP", legalName: "ИП Тест", ownerName: "Тестов Тест", binIin: "900101300017", segment: "ECONOMY" })),
  changeSegment: (u) => changeSegment(u, { profileId: "x", from: "ECONOMY", to: "COMFORT", reason: "причина" }),
  listFurnitureTypes: (u) => listFurnitureTypes(u),
  addFurnitureType: (u) => addFurnitureType(u, { name: "Тип" }),
  renameFurnitureType: (u) => renameFurnitureType(u, { id: "x", name: "Тип" }),
  setFurnitureTypeActive: (u) => setFurnitureTypeActive(u, { id: "x", active: false }),
  moveFurnitureType: (u) => moveFurnitureType(u, { id: "x", direction: "up" }),
  listStaleRequests: (u) => listStaleRequests(u, { hours: 24 }),
  listDisputes: (u) => listDisputes(u),
  getDisputeCard: (u) => getDisputeCard(u, "x"),
  resolveDispute: (u) => resolveDispute(u, { disputeId: "x", outcome: "CONTINUE", rationale: "обоснование решения" }),
  previewDisputeSplit: (u) => previewDisputeSplit(u, { disputeId: "x", masterShareKzt: 1 }),
  searchAudit: (u) => searchAudit(u, {}),
  buildReport: (u) => buildReport(u, { staleDays: 3 }),
  buildCsv: (u) => buildCsv(u, { kind: "deals", staleDays: 3 }),
  incomeReport: (u) => incomeReport(u, PERIOD),
  buildIncomeCsv: (u) => buildIncomeCsv(u, PERIOD),
  resetDemoData: (u) => resetDemoData(u),
  listMoneyQueue: (u) => listMoneyQueue(u),
  confirmBankOperation: (u) => confirmBankOperation(u, { transactionId: "x", bankDocNumber: "1", bankDocDate: new Date(), bankDocFileId: "f" }),
  failBankOperation: (u) => failBankOperation(u, { transactionId: "x", reason: "банк отказал" }),
  saveBankDocument: (u) => saveBankDocument(u, new TextEncoder().encode("%PDF-1.4")),
  listOperatorDeals: (u) => listOperatorDeals(u),
  getOperatorDeal: (u) => getOperatorDeal(u, "x"),
  kycQueue: (u) => kycQueue(u),
  reviewKyc: (u) => reviewKyc(u, { profileId: "x", decision: "VERIFIED" }),
  platformSettings: async (u) => platformSettings(u),
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
      const counts = async () => ({
        users: await db.user.count(),
        audit: await db.auditEvent.count(),
        types: await db.furnitureType.count(),
        files: await db.storedFile.count(),
      });
      const before = await counts();

      await expect(call(client)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(call(executor)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await counts()).toEqual(before);
    });
  }
});
