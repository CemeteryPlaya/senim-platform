import { describe, expect, it } from "vitest";
import { partyEstimate } from "./estimate";

describe("смета стороны (ТЗ п. 5)", () => {
  it("покупатель: цена без доплат = итого (ADR-015); мастер: цена − гарантия 6% = к выплате (вниз)", () => {
    expect(partyEstimate("CLIENT", 12_345n)).toEqual({ party: "CLIENT", priceTiyn: 12_345n, extraTiyn: 0n, totalTiyn: 12_345n });
    expect(partyEstimate("EXECUTOR", 12_345n)).toEqual({ party: "EXECUTOR", priceTiyn: 12_345n, extraTiyn: 741n, totalTiyn: 11_604n });
  });
});
