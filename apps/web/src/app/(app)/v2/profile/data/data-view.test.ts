import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { MyData } from "@/modules/identity";
import { dataView, maskedIin } from "./data-view";

const t = ru.app.profile.data;

const data = (over: Partial<MyData> = {}): MyData => ({
  phone: "+77001234567",
  fullName: "Сапаров Ерлан",
  iinLast4: "1234",
  instagram: null,
  email: "e@mail.kz",
  consents: [{ id: "c1", kind: "PD_PROCESSING", version: "2026-11-11-d1", grantedAt: new Date("2026-11-12T10:00:00Z"), dealId: null }],
  revocation: null,
  ...over,
});

describe("maskedIin", () => {
  it("только последние четыре символа, даже если пришло больше; нет — «Не указано»", () => {
    expect(maskedIin("1234")).toBe("•••• 1234");
    expect(maskedIin("870304300612")).toBe("•••• 0612");
    expect(maskedIin(null)).toBe(t.notSet);
  });
});

describe("dataView", () => {
  it("согласие на банк по сделкам: номера в тексте, фраза мягкая и не называет сделки незавершёнными", () => {
    const view = dataView(
      data({
        consents: [
          ...data().consents,
          { id: "c2", kind: "BANK_TRANSFER", version: "v1", grantedAt: new Date("2026-11-13T10:00:00Z"), dealId: "d3" },
          { id: "c3", kind: "BANK_TRANSFER", version: "v1", grantedAt: new Date("2026-11-13T11:00:00Z"), dealId: "d5" },
        ],
      }),
      new Map([["d3", { number: 3, title: "Кухня" }], ["d5", { number: 5, title: "Шкаф-купе" }]]),
    );
    expect(view.bankDeals).toBe("№3, №5");
    // Одинаковые согласия (вид и редакция) — одной карточкой со строками сделок; сделка — с названием заказа: по одному
    // номеру её не узнать. Даты разные — у строки каждой сделки, а не у карточки.
    expect(view.consents).toHaveLength(2);
    const bank = view.consents.find((c) => c.id === "c2");
    expect(bank?.granted).toBeNull();
    expect(bank?.deals.map((d) => [d.label, d.href])).toEqual([
      ["Сделка №3: Кухня", "/v2/deals/d3"],
      ["Сделка №5: Шкаф-купе", "/v2/deals/d5"],
    ]);
    expect(bank?.deals.every((d) => d.granted !== null)).toBe(true);
    const text = t.revoke.bankDeals(view.bankDeals!);
    expect(text).toBe("Согласие на передачу данных банку по сделкам №3, №5 этим отзывом не затрагивается.");
    expect(text).not.toContain("исполнил");
  });

  it("одна дата на всех — у карточки; разные редакции — разные карточки; согласие без сделки — без строк", () => {
    const at = new Date("2026-11-13T10:00:00Z");
    const same = dataView(
      data({
        consents: [
          { id: "b1", kind: "BANK_TRANSFER", version: "v1", grantedAt: at, dealId: "d3" },
          { id: "b2", kind: "BANK_TRANSFER", version: "v1", grantedAt: at, dealId: "d5" },
          { id: "b3", kind: "BANK_TRANSFER", version: "v2", grantedAt: at, dealId: "d7" },
        ],
      }),
      new Map(),
    );
    expect(same.consents.map((c) => [c.id, c.deals.length])).toEqual([
      ["b1", 2],
      ["b3", 1],
    ]);
    expect(same.consents[0]?.granted).not.toBeNull();
    expect(same.consents[0]?.deals.every((d) => d.granted === null)).toBe(true);
    expect(dataView(data(), new Map()).consents[0]?.deals).toEqual([]);
  });

  it("без согласий банку номеров нет; отзыв возможен, пока нет открытой заявки", () => {
    expect(dataView(data(), new Map()).bankDeals).toBeNull();
    expect(dataView(data(), new Map()).canRevoke).toBe(true);
    const open = { id: "r", status: "REQUESTED" as const, requestedAt: new Date(), dueAt: new Date(), decidedAt: null, reason: null };
    expect(dataView(data({ revocation: open }), new Map()).canRevoke).toBe(false);
  });
});
