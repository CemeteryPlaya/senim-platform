import { describe, expect, it } from "vitest";
import { INIT_PAYMENT_OK, PAYOUT_NOTIFY_XML, STATUS_NOT_FOUND } from "./fixtures.test-data";
import { fieldText, parseXmlFields } from "./xml";

describe("разбор XML-ответа Freedom Pay", () => {
  it("корень и поля по порядку; сущности раскрываются", () => {
    const doc = parseXmlFields(INIT_PAYMENT_OK);
    expect(doc?.root).toBe("response");
    expect(doc?.fields.map(([k]) => k)).toEqual(["pg_status", "pg_payment_id", "pg_redirect_url", "pg_redirect_url_type", "pg_salt", "pg_sig"]);
    expect(fieldText(doc!.fields, "pg_redirect_url")).toBe("https://customer.freedompay.kz/pay.html?customer=abc&lang=ru");
    expect(fieldText(doc!.fields, "pg_redirect_url_type")).toBe("need data");
  });

  it("кириллица и ошибка без подписи", () => {
    const doc = parseXmlFields(STATUS_NOT_FOUND)!;
    expect(fieldText(doc.fields, "pg_error_description")).toBe("Платёж не найден.");
    expect(fieldText(doc.fields, "pg_sig")).toBeUndefined();
  });

  it("корень response у Payout notify", () => {
    expect(parseXmlFields(PAYOUT_NOTIFY_XML)?.root).toBe("response");
  });

  it("вложенные элементы — вложенные поля в порядке документа, повторы сохраняются", () => {
    const doc = parseXmlFields(
      "<response><pg_status>ok</pg_status><pg_refund_payments><pg_refund_payment><pg_payment_id>1</pg_payment_id></pg_refund_payment>" +
        "<pg_refund_payment><pg_payment_id>2</pg_payment_id></pg_refund_payment></pg_refund_payments></response>",
    )!;
    expect(doc.fields).toEqual([
      ["pg_status", "ok"],
      ["pg_refund_payments", [["pg_refund_payment", [["pg_payment_id", "1"]]], ["pg_refund_payment", [["pg_payment_id", "2"]]]]],
    ]);
  });

  it("пустой и самозакрывающийся элемент — пустая строка; CDATA и числовые сущности", () => {
    const doc = parseXmlFields("<response><a></a><b/><c><![CDATA[x<y]]></c><d>&#1058;&#x0435;</d></response>")!;
    expect(doc.fields).toEqual([["a", ""], ["b", ""], ["c", "x<y"], ["d", "Те"]]);
  });

  it.each([
    ["пусто", ""],
    ["HTML-страница ошибки", "<html><body>502 Bad Gateway</body></html><p>"],
    ["незакрытый тег", "<response><pg_status>ok</response>"],
    ["мусор после корня", "<response></response><x/>"],
    ["JSON", '{"pg_status":"ok"}'],
  ])("не XML или битый XML (%s) — null", (_, text) => {
    expect(parseXmlFields(text)).toBeNull();
  });
});
