import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { listDealDocuments, shareDocument } from "@/modules/documents";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../../test/factories";
import { dealAt } from "../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../test/factories/identity";
import SharedPage from "./page";
import { GET as pdfRoute } from "./pdf/route";
import { GET as legacyPdfRoute } from "../../../../(legacy)/d/[token]/pdf/route";

vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.deal.shared;

beforeEach(() => freshBrowser({ "user-agent": "vitest" }));
afterEach(() => vi.useRealTimers());

const page = async (token: string) => renderToStaticMarkup(await SharedPage({ params: Promise.resolve({ token }) }));
const plain = (out: string) => out.replace(/<[^>]*>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "page";
  } catch (e) {
    return typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "error";
  }
}

/** Ссылка на выписку оплаченной сделки; токен — путь после `/d/`. */
async function statementLink() {
  const client = await makeClient("Сапаров Ерлан Ержанович");
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  const f = await dealAt("PAID_HOLD", { client });
  const statement = (await listDealDocuments(client, f.dealId)).find((d) => d.kind === "MONEY_STATEMENT");
  const link = await shareDocument(client, statement?.id ?? "");
  const token = decodeURIComponent(new URL(link.url).pathname.slice("/d/".length));
  return { token, statement };
}

describe("документ по ссылке (гостю)", () => {
  it("показывает вид, номер, версию, статус и срок; ссылка на PDF по той же ссылке; одно главное действие", async () => {
    const { token, statement } = await statementLink();
    const out = await page(token);
    expect(plain(out)).toContain(t.title(ru.app.deal.card.documents.kinds.MONEY_STATEMENT, statement?.number ?? "?").replaceAll(" ", " "));
    expect(plain(out)).toContain(t.rows.expires);
    expect(out).toContain(`href="/v2/d/${encodeURIComponent(token)}/pdf"`);
    expect([...out.matchAll(/data-primary-action/g)]).toHaveLength(1);
    expect([...out.matchAll(/<h1/g)]).toHaveLength(1);
    expect(plain(out)).not.toMatch(/комисси|эскроу|тестов|демо|платформ/i);
  });

  it("открытие пишется в аудит документа", async () => {
    const { token, statement } = await statementLink();
    await page(token);
    expect(await db.auditEvent.count({ where: { action: "document.link.opened", entityId: statement?.id } })).toBe(1);
  });

  it("неизвестный, испорченный и просроченный токен — 404", async () => {
    const { token } = await statementLink();
    expect(await outcome(() => page("net-takogo"))).toContain("404");
    expect(await outcome(() => page(`${token}x`))).toContain("404");
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 73 * 3600 * 1000 });
    expect(await outcome(() => page(token))).toContain("404");
  });
});

describe("PDF по ссылке: общий ответ у v1 и v2", () => {
  const call = (route: typeof pdfRoute, token: string, query = "") =>
    route(new Request(`http://localhost/d/${token}/pdf${query}`), { params: Promise.resolve({ token }) });

  it("v1 и v2 отдают один и тот же файл; недействительная ссылка — 404 у обоих", async () => {
    const { token } = await statementLink();
    const [a, b] = await Promise.all([call(legacyPdfRoute, token), call(pdfRoute, token)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.headers.get("content-type")).toBe("application/pdf");
    expect(a.headers.get("x-document-sha256")).toBe(b.headers.get("x-document-sha256"));
    expect(Buffer.from(await a.arrayBuffer()).equals(Buffer.from(await b.arrayBuffer()))).toBe(true);
    expect((await call(legacyPdfRoute, "net-takogo")).status).toBe(404);
    expect((await call(pdfRoute, "net-takogo")).status).toBe(404);
  });

  it("?download=1 — вложением", async () => {
    const { token } = await statementLink();
    expect((await call(pdfRoute, token, "?download=1")).headers.get("content-disposition")).toMatch(/^attachment/);
  });
});
