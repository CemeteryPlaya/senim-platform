import { describe, expect, it } from "vitest";
import { partyEstimate } from "./estimate";

describe("смета стороны (ТЗ п. 5)", () => {
  it("покупатель: цена + защита 2% вверх = итого; мастер: цена − гарантия 4% = к выплате (вниз)", () => {
    expect(partyEstimate("CLIENT", 12_345n)).toEqual({ party: "CLIENT", priceTiyn: 12_345n, extraTiyn: 247n, totalTiyn: 12_592n });
    expect(partyEstimate("EXECUTOR", 12_345n)).toEqual({ party: "EXECUTOR", priceTiyn: 12_345n, extraTiyn: 494n, totalTiyn: 11_851n });
  });
});
