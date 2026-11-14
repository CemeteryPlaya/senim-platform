import { describe, expect, it } from "vitest";
import type { IncomingListItem } from "@/modules/requests";
import { incomingCounts, incomingTypes, inWorkCount, isFreshIncoming, offerGroupCounts, offerGroupOf, offerGroupParam, offersIn, selectedIncoming } from "./incoming";

const req = (title: string, myOfferStatus: IncomingListItem["myOfferStatus"], mode: IncomingListItem["mode"]) => ({ title, myOfferStatus, mode }) as IncomingListItem;
const list = [req("Кухня", null, "TENDER"), req("Шкаф", "SENT", "DIRECT"), req("Кухня", "SENT", "TENDER")];

describe("входящие мастера", () => {
  it("фильтр из адреса: раздел, тип, неизвестное — все", () => {
    expect(list.filter(selectedIncoming({ f: "new" }, list).keep)).toHaveLength(1);
    expect(list.filter(selectedIncoming({ f: "direct" }, list).keep)).toHaveLength(1);
    const kitchen = selectedIncoming({ type: "Кухня" }, list);
    expect(kitchen.key).toBe("type:Кухня");
    expect(list.filter(kitchen.keep)).toHaveLength(2);
    expect(selectedIncoming({ type: "Лодка" }, list).key).toBe("all");
    expect(selectedIncoming({ f: "что-то" }, list).key).toBe("all");
  });

  it("тип из адреса сильнее раздела", () => {
    expect(selectedIncoming({ f: "new", type: "Шкаф" }, list).key).toBe("type:Шкаф");
  });

  it("числа чипов и новые заявки", () => {
    expect(isFreshIncoming(list[0]!)).toBe(true);
    expect(incomingTypes(list)).toEqual(["Кухня", "Шкаф"]);
    expect(incomingCounts(list)).toEqual({ all: 3, fresh: 1, direct: 1, byType: [{ type: "Кухня", count: 2 }, { type: "Шкаф", count: 1 }] });
  });

  it("в работе — только идущие сделки, где он исполнитель", () => {
    expect(
      inWorkCount([
        { myRole: "EXECUTOR", status: "IN_PROGRESS" },
        { myRole: "EXECUTOR", status: "ACCEPTED" },
        { myRole: "EXECUTOR", status: "SPLIT_PAYOUT" },
        { myRole: "CLIENT", status: "IN_PROGRESS" },
      ]),
    ).toBe(2);
  });
});

describe("мои предложения", () => {
  const offers = [{ status: "SENT" }, { status: "ACCEPTED" }, { status: "DECLINED" }, { status: "WITHDRAWN" }] as const;
  it("разделы", () => {
    expect(offers.map(offerGroupOf)).toEqual(["waiting", "chosen", "closed", "closed"]);
    expect(offerGroupCounts(offers)).toEqual({ all: 4, waiting: 1, chosen: 1, closed: 2 });
    expect(offersIn(offers, "all")).toHaveLength(4);
    expect(offersIn(offers, "closed")).toHaveLength(2);
  });
  it("раздел из адреса", () => {
    expect(offerGroupParam("chosen")).toBe("chosen");
    expect(offerGroupParam("x")).toBe("all");
    expect(offerGroupParam(undefined)).toBe("all");
  });
});
