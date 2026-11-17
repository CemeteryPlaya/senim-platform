import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { HIGHLIGHTS_MAX } from "@/modules/companies";
import { bestSchema } from "./best-schema";
import { initialSelected, isFull, moveRef, refKey, toggleRef, type BestRef } from "./best-view";

const w = (id: string): BestRef => ({ kind: "work", id });
const d = (id: string): BestRef => ({ kind: "deal", id });
const ids = (list: BestRef[]) => list.map(refKey);

describe("лучшие работы: порядок и отметки", () => {
  it("начальный набор — выбранные по позиции, остальные не входят", () => {
    const sel = initialSelected([
      { kind: "work", id: "a", selected: false, position: null },
      { kind: "deal", id: "b", selected: true, position: 1 },
      { kind: "work", id: "c", selected: true, position: 0 },
    ]);
    expect(ids(sel)).toEqual(["work:c", "deal:b"]);
  });

  it("отметка добавляет в конец, повторная — снимает; седьмая не добавляется", () => {
    let sel = toggleRef([w("a")], d("b"), HIGHLIGHTS_MAX);
    expect(ids(sel)).toEqual(["work:a", "deal:b"]);
    expect(ids(toggleRef(sel, w("a"), HIGHLIGHTS_MAX))).toEqual(["deal:b"]);
    sel = ["1", "2", "3", "4", "5", "6"].map(w);
    expect(isFull(sel, HIGHLIGHTS_MAX)).toBe(true);
    expect(toggleRef(sel, w("7"), HIGHLIGHTS_MAX)).toBe(sel);
    expect(ids(toggleRef(sel, w("3"), HIGHLIGHTS_MAX))).toEqual(["work:1", "work:2", "work:4", "work:5", "work:6"]);
  });

  it("стрелки меняют соседей; на краю ничего не происходит", () => {
    const sel = [w("a"), w("b"), d("c")];
    expect(ids(moveRef(sel, 1, "up"))).toEqual(["work:b", "work:a", "deal:c"]);
    expect(ids(moveRef(sel, 1, "down"))).toEqual(["work:a", "deal:c", "work:b"]);
    expect(moveRef(sel, 0, "up")).toBe(sel);
    expect(moveRef(sel, 2, "down")).toBe(sel);
  });

  it("схема действия: до 6, без дублей, ключ повтора необязателен; тексты — из ru", () => {
    expect(bestSchema.safeParse({ items: [w("a"), d("b")], clientKey: crypto.randomUUID() }).success).toBe(true);
    const many = bestSchema.safeParse({ items: ["1", "2", "3", "4", "5", "6", "7"].map(w) });
    expect(many.success).toBe(false);
    if (!many.success) expect(many.error.issues[0]?.message).toBe(ru.app.masterPortfolio.best.errors.tooMany(HIGHLIGHTS_MAX));
    expect(bestSchema.safeParse({ items: [w("a"), w("a")] }).success).toBe(false);
  });

  it("тексты: склонение подсказки о скрытых сделках", () => {
    const t = ru.app.masterPortfolio.best;
    expect(t.hiddenDeals(1)).toBe("1 сделка не показана: покупатель не разрешил показывать фото");
    expect(t.hiddenDeals(3)).toBe("3 сделки не показаны: покупатель не разрешил показывать фото");
    expect(t.hiddenDeals(5)).toBe("5 сделок не показаны: покупатель не разрешил показывать фото");
  });
});
