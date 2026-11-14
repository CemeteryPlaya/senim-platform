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

// Ворота экранов спора, отзыва и истории денег для оператора и мастера сделки: в v1 нет экранов `/deals/<id>/dispute` и
// `/deals/<id>/review` (404), поэтому они уходят на карточку сделки v1; история денег есть и в v1 — на тот же адрес.

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

const SCREENS: [string, Page, (id: string) => string][] = [
  ["спор", DisputePage as Page, (id) => `/deals/${id}`],
  ["отзыв", ReviewPage as Page, (id) => `/deals/${id}`],
  ["история денег", MoneyHistoryPage as Page, (id) => `/deals/${id}/money`],
];

describe.each(SCREENS)("ворота экрана «%s»: оператор и мастер сделки — в v1", (_name, page, v1) => {
  it("оператор", async () => {
    const f = await dealAt("SIGNED");
    await signInAs(await makeOperator());
    expect(await where(page, f.dealId)).toBe(v1(f.dealId));
  });

  it("мастер этой сделки (активная роль мастера)", async () => {
    const f = await dealAt("SIGNED");
    await db.user.update({ where: { id: f.executor.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(f.executor);
    expect(await where(page, f.dealId)).toBe(v1(f.dealId));
  });
});
