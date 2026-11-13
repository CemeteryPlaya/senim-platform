import { describe, expect, it } from "vitest";
import { assertSafeDatabase } from "../e2e-v2/safe-database";

// Пересев набора flows (e2e-v2/reseed.setup.ts) стирает базу: годится только база нового интерфейса.
const HOST = "postgresql://postgres:postgres@localhost:5442";

describe("assertSafeDatabase: пересев только базы нового интерфейса", () => {
  it("пропускает senim_v2web_e2e", () => {
    expect(assertSafeDatabase(`${HOST}/senim_v2web_e2e`)).toBe("senim_v2web_e2e");
    expect(assertSafeDatabase(`${HOST}/senim_v2web_e2e?schema=public`)).toBe("senim_v2web_e2e");
  });

  it.each([
    ["база v1", `${HOST}/senim_e2e`],
    ["основная база", `${HOST}/senim`],
    ["обход через ..", `${HOST}/senim_v2web_x/../senim_e2e`],
    ["другой регистр", `${HOST}/SENIM_V2WEB_E2E`],
    ["процентный код подчёркивания", `${HOST}/senim%5Fv2web_e2e`],
    ["процентный код в хвосте", `${HOST}/senim_v2web_%65e2e`],
    ["подмена базы параметром", `${HOST}/senim_v2web_e2e?database=senim_e2e`],
    ["подмена базы параметром dbname", `${HOST}/senim_v2web_e2e?DbName=senim_e2e`],
    ["без имени", `${HOST}/`],
    ["не адрес", "senim_v2web_e2e"],
  ])("отказ: %s", (_, url) => {
    expect(() => assertSafeDatabase(url)).toThrow(/Пересев отказан|не разобрать/);
  });
});
