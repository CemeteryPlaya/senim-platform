import { describe, expect, it } from "vitest";
import { DEALS, DUAL_ROLE_REQUESTS, REQUESTS, REVIEWS, SHOWCASE_REQUESTS, type RequestSpec, type When } from "./data";
import { monthStartAstana, resolveWhen } from "./timeline";

/**
 * План времени сделок сида (повторный разбор вида, 0.2): действия по дням, а не одной минутой засева. Проверяется на
 * разных «сейчас»: середина месяца, первые часы месяца и второй день — `thisMonth` не выпадает в прошлый месяц.
 */

const ALL: RequestSpec[] = [...REQUESTS, ...DUAL_ROLE_REQUESTS, ...SHOWCASE_REQUESTS];
const request = (key: string) => ALL.find((r) => r.key === key)!;

/** Последнее событие заявки до акцепта: отклик, встречные цены. */
function lastBeforeAccept(r: RequestSpec): number {
  const o = r.offers[0]!;
  return Math.min(o.sentDaysAgo, ...(o.rounds ?? []).map((x) => x.daysAgo));
}

const NOWS = {
  "середина месяца": Date.UTC(2026, 10, 16, 7, 0),
  "1-е число, 01:00 Астаны": Date.UTC(2026, 10, 30, 20, 0),
  "2-е число": Date.UTC(2026, 11, 2, 6, 0),
};

const isThisMonth = (w: When) => typeof w === "object";

describe("время сделок сида", () => {
  it("у каждой сделки — заявка, акцепт после отклика и торга, время на каждый шаг", () => {
    for (const plan of DEALS) {
      const r = request(plan.request);
      expect(r, plan.request).toBeDefined();
      expect(plan.at.steps, plan.request).toHaveLength(plan.steps.length);
      expect(typeof plan.at.accepted === "number" ? plan.at.accepted : Infinity, plan.request).toBeLessThan(lastBeforeAccept(r));
    }
  });

  for (const [name, now] of Object.entries(NOWS)) {
    it(`${name}: шаги идут по порядку и в прошлом, «в этом месяце» — в текущем месяце`, () => {
      for (const plan of DEALS) {
        const times = [plan.at.accepted, ...plan.at.steps].map((w) => resolveWhen(w, now));
        for (let i = 1; i < times.length; i++) expect(times[i]!, `${plan.request}, шаг ${i}`).toBeGreaterThan(times[i - 1]!);
        expect(times.at(-1)!, plan.request).toBeLessThan(now);
        for (const w of plan.at.steps.filter(isThisMonth)) expect(resolveWhen(w, now), plan.request).toBeGreaterThanOrEqual(monthStartAstana(now));
      }
      for (const review of REVIEWS) {
        const plan = DEALS.find((d) => d.request === review.request)!;
        const at = resolveWhen(review.at, now);
        expect(at, review.request).toBeGreaterThan(resolveWhen(plan.at.steps.at(-1)!, now));
        expect(at, review.request).toBeLessThan(now);
      }
    });
  }

  it("выплаты Исп. №6 (сделки №12 и №17) и витринная выплата Ерлана — в текущем месяце", () => {
    for (const key of ["deal-done-manual-wardrobe", "deal-dual-role-wardrobe", "showcase-erlan-hallway"]) {
      expect(isThisMonth(DEALS.find((d) => d.request === key)!.at.steps.at(-1)!), key).toBe(true);
    }
  });

  it("отзывы — по одной на сделку, только по завершённым (последний шаг — подпись акта или выплата оператора)", () => {
    expect(new Set(REVIEWS.map((r) => r.request)).size).toBe(REVIEWS.length);
    for (const review of REVIEWS) {
      const plan = DEALS.find((d) => d.request === review.request)!;
      expect(["signAct", "bank"], review.request).toContain(plan.steps.at(-1));
      expect(plan.steps.some((s) => typeof s === "object" && ("cancel" in s || "dispute" in s)), review.request).toBe(false);
    }
  });
});
