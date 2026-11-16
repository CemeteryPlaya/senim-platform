import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/platform/db";
import { makeOperator } from "../../../../../../test/factories";
import { dealAt } from "../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../test/factories/session";
import DisputePage from "./dispute/page";
import MoneyHistoryPage from "./money/page";
import ReviewPage from "./review/page";

vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

// Ворота экранов спора, отзыва и истории денег: оператор уходит в v1 — там нет экранов `/deals/<id>/dispute` и
// `/deals/<id>/review` (404), поэтому на карточку сделки v1; история денег есть и в v1 — на тот же адрес. Отзыв — экран только
// покупателя: мастер сделки уходит на карточку сделки v2. Спор и история денег общие для сторон — мастер видит свой экран v2.

beforeEach(() => freshBrowser({ "user-agent": "vitest" }));

type Page = (props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) => Promise<unknown>;

async function where(page: Page, id: string): Promise<string> {
  try {
    renderToStaticMarkup((await page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })) as never);
    return "page";
  } catch (e) {
    const digest = typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "";
    return digest.startsWith("NEXT_REDIRECT") ? (digest.split(";")[2] ?? "") : digest || "error";
  }
}

const SCREENS: [string, Page][] = [
  ["спор", DisputePage as Page],
  ["отзыв", ReviewPage as Page],
  ["история денег", MoneyHistoryPage as Page],
];

// Этап 5: у оператора своя карточка сделки в v2 (журнал денег и споры — на ней), экраны сторон ему не нужны.
describe.each(SCREENS)("ворота экрана «%s»: оператор — на свою карточку сделки v2", (_name, page) => {
  it("оператор", async () => {
    const f = await dealAt("SIGNED");
    await signInAs(await makeOperator());
    expect(await where(page, f.dealId)).toBe(`/v2/operator/deals/${f.dealId}`);
  });
});

async function masterOf(f: Awaited<ReturnType<typeof dealAt>>) {
  await db.user.update({ where: { id: f.executor.id }, data: { emailVerifiedAt: new Date() } });
  await signInAs(f.executor);
}

describe("мастер сделки (активная роль мастера)", () => {
  it("отзыв — экран покупателя: на карточку сделки v2", async () => {
    const f = await dealAt("SIGNED");
    await masterOf(f);
    expect(await where(ReviewPage as Page, f.dealId)).toBe(`/v2/deals/${f.dealId}`);
  });

  it("история денег — свой экран v2", async () => {
    const f = await dealAt("SIGNED");
    await masterOf(f);
    expect(await where(MoneyHistoryPage as Page, f.dealId)).toBe("page");
  });

  it("спор: до оплаты открыть нельзя — карточка сделки v2; после оплаты — форма", async () => {
    const early = await dealAt("SIGNED");
    await masterOf(early);
    expect(await where(DisputePage as Page, early.dealId)).toBe(`/v2/deals/${early.dealId}`);
    const paid = await dealAt("PAID_HOLD");
    await masterOf(paid);
    expect(await where(DisputePage as Page, paid.dealId)).toBe("page");
  });
});
