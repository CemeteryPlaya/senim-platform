import { describe, expect, it } from "vitest";
import { negotiationState, type Round } from "./negotiation-state";

const round = (id: string, party: Round["party"], kzt: number, status: Round["status"]): Round => ({ id, party, amountTiyn: BigInt(kzt) * 100n, status });
const OFFER = 500_000_00n;

describe("состояние торга для экрана", () => {
  it("чужая открытая цена: принять или перебить; своя — только отозвать", () => {
    const rounds = [round("a", "EXECUTOR", 500_000, "SUPERSEDED"), round("b", "CLIENT", 420_000, "PROPOSED")];
    expect(negotiationState(rounds, "EXECUTOR", true, OFFER)).toEqual({
      open: { id: "b", party: "CLIENT", mine: false, amountTiyn: 420_000_00n },
      accepted: false,
      can: { propose: true, accept: true, withdraw: false },
      priceTiyn: 420_000_00n,
    });
    expect(negotiationState(rounds, "CLIENT", true, OFFER)).toMatchObject({ open: { mine: true }, can: { propose: false, accept: false, withdraw: true } });
  });

  it("открытой нет: обе стороны предлагают; цена — последняя названная, без раундов — цена отклика", () => {
    const withdrawn = [round("a", "EXECUTOR", 480_000, "WITHDRAWN")];
    expect(negotiationState(withdrawn, "CLIENT", true, OFFER)).toMatchObject({ open: null, can: { propose: true, accept: false, withdraw: false }, priceTiyn: 480_000_00n });
    expect(negotiationState([], "CLIENT", true, OFFER).priceTiyn).toBe(OFFER);
  });

  it("принятая цена — текущая; закрытый торг ничего не разрешает", () => {
    const rounds = [round("a", "EXECUTOR", 500_000, "SUPERSEDED"), round("b", "CLIENT", 450_000, "ACCEPTED")];
    expect(negotiationState(rounds, "CLIENT", false, OFFER)).toEqual({
      open: null,
      accepted: true,
      can: { propose: false, accept: false, withdraw: false },
      priceTiyn: 450_000_00n,
    });
    expect(negotiationState([round("c", "EXECUTOR", 1, "PROPOSED")], "CLIENT", false, OFFER).can).toEqual({ propose: false, accept: false, withdraw: false });
  });
});
