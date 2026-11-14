import { describe, expect, it } from "vitest";
import { legacy, makePaths, makeV2Href, safeLocalPath, to, v2Href } from "./paths";

// Один набор случаев для префикса "/v2" (сейчас) и "" (после переключения на этапе 6): [вход, при "/v2", при ""].
const TO: [string, string, string][] = [
  ["/", "/v2", "/"],
  ["", "/v2", "/"],
  ["/deals/42", "/v2/deals/42", "/deals/42"],
  ["deals", "/v2/deals", "/deals"],
  ["/?a=1", "/v2?a=1", "/?a=1"],
  ["?a=1", "/v2?a=1", "/?a=1"],
  ["/#x", "/v2#x", "/#x"],
  // Адрес уже под префиксом не получает его второй раз.
  ["/v2/deals", "/v2/deals", "/v2/deals"],
  ["/v2", "/v2", "/v2"],
  ["/v2?a=1", "/v2?a=1", "/v2?a=1"],
  ["/v2#x", "/v2#x", "/v2#x"],
  // Путь, который только начинается с тех же букв, — обычный путь.
  ["/v2x", "/v2/v2x", "/v2x"],
];

const LEGACY: [string, string, string][] = [
  ["/v2/deals/42", "/deals/42", "/v2/deals/42"],
  ["/v2", "/", "/v2"],
  ["/v2/", "/", "/v2/"],
  ["/v2?tab=1", "/?tab=1", "/v2?tab=1"],
  ["/v2#x", "/#x", "/v2#x"],
  ["/v2/deals?tab=1", "/deals?tab=1", "/v2/deals?tab=1"],
  ["/v2x", "/v2x", "/v2x"],
  ["/deals", "/deals", "/deals"],
  ["/", "/", "/"],
];

describe.each([
  ["/v2", 1],
  ["", 2],
] as const)("makePaths(%j)", (base, col) => {
  const paths = makePaths(base);

  it.each(TO)("to(%j)", (input, ...expected) => {
    expect(paths.to(input)).toBe(expected[col - 1]);
  });

  it.each(LEGACY)("legacy(%j)", (input, ...expected) => {
    expect(paths.legacy(input)).toBe(expected[col - 1]);
  });

  it("legacy(to(x)) возвращает путь v1", () => {
    for (const path of ["/", "/deals/42", "/?a=1", "/requests/new"]) expect(paths.legacy(paths.to(path))).toBe(path);
  });
});

describe("to и legacy приложения — префикс /v2", () => {
  it("совпадают с makePaths(\"/v2\")", () => {
    expect(to("/deals")).toBe("/v2/deals");
    expect(legacy("/v2/deals")).toBe("/deals");
  });
});

describe("safeLocalPath: только путь этого сайта", () => {
  it.each([
    "/",
    "/deals/1",
    "/deals/1?tab=money&f=a",
    "/example.com",
    "/requests/%D0%B0",
    "/%2F%2Fexample.com",
    "/%5Cexample.com",
    "/a//b",
  ])("%j — как есть", (path) => {
    expect(safeLocalPath(path)).toBe(path);
  });

  it.each([
    "//example.com",
    "///example.com",
    "/\\example.com",
    "/\\\\example.com",
    "\\example.com",
    "\\\\example.com",
    "/ //example.com",
    " //example.com",
    " /deals",
    "/\t/example.com",
    "/\n/example.com",
    "\t//example.com",
    "/deals\u0000",
    "/deals\u007f",
    "https://example.com",
    "javascript:alert(1)",
    "example.com",
    "",
  ])("%j → «/»", (path) => {
    expect(safeLocalPath(path)).toBe("/");
  });
});

// Путь v1 → адрес v2: [вход, при "/v2", при ""]. Прочие пути (которых в v2 ещё нет) уходят под префикс как есть.
const V2_HREF: [string, string, string][] = [
  ["/", "/v2", "/"],
  ["/requests", "/v2/requests", "/requests"],
  ["/requests/new", "/v2/requests/new", "/requests/new"],
  ["/requests/new/step-2", "/v2/requests/new/step-2", "/requests/new/step-2"],
  ["/requests/r1", "/v2/requests/r1", "/requests/r1"],
  ["/requests/r1/offers/o9", "/v2/requests/r1/offers/o9", "/requests/r1/offers/o9"],
  ["/requests/r1/offers/o9#chat", "/v2/chats/o9", "/chats/o9"],
  ["/requests/r1/offers/o9/#chat", "/v2/chats/o9", "/chats/o9"],
  ["/requests/r1/offers/o9?from=list#chat", "/v2/chats/o9?from=list", "/chats/o9?from=list"],
  // Другой якорь у предложения диалогом не становится.
  ["/requests/r1/offers/o9#price", "/v2/requests/r1/offers/o9#price", "/requests/r1/offers/o9#price"],
  ["/requests/r1#chat", "/v2/requests/r1#chat", "/requests/r1#chat"],
  ["/deals", "/v2/deals", "/deals"],
  ["/deals/d1", "/v2/deals/d1", "/deals/d1"],
  ["/deals/d1/money", "/v2/deals/d1/money", "/deals/d1/money"],
  // id отклика из пути сделки не узнать: якорь остаётся, диалог покажет сам экран сделки.
  ["/deals/d1#chat", "/v2/deals/d1#chat", "/deals/d1#chat"],
  ["/chats", "/v2/chats", "/chats"],
  ["/chats/o9", "/v2/chats/o9", "/chats/o9"],
  ["/notifications", "/v2/notifications", "/notifications"],
  ["/profile", "/v2/profile", "/profile"],
  ["/profile/data", "/v2/profile/data", "/profile/data"],
  ["/switch-role?to=EXECUTOR&returnTo=%2Fdeals%2Fd1", "/v2/switch-role?to=EXECUTOR&returnTo=%2Fdeals%2Fd1", "/switch-role?to=EXECUTOR&returnTo=%2Fdeals%2Fd1"],
  ["/d/abc123", "/v2/d/abc123", "/d/abc123"],
  // Параметры запроса и якорь сохраняются; конечный «/» отбрасывается.
  ["/requests?tab=2&sort=new", "/v2/requests?tab=2&sort=new", "/requests?tab=2&sort=new"],
  ["/?a=1", "/v2?a=1", "/?a=1"],
  ["/deals/d1/", "/v2/deals/d1", "/deals/d1"],
  ["/deals/d1?x=1#money", "/v2/deals/d1?x=1#money", "/deals/d1?x=1#money"],
  // Пути мастера v1: в v2 те же пути под префиксом.
  ["/executor/requests", "/v2/executor/requests", "/executor/requests"],
  ["/executor/requests?type=kitchen", "/v2/executor/requests?type=kitchen", "/executor/requests?type=kitchen"],
  ["/executor/requests/r1", "/v2/executor/requests/r1", "/executor/requests/r1"],
  // Диалог мастера по заявке: id своего предложения из пути не узнать — адрес, который его находит.
  ["/executor/requests/r1#chat", "/v2/executor/requests/r1/chat", "/executor/requests/r1/chat"],
  ["/executor/requests/r1/#chat", "/v2/executor/requests/r1/chat", "/executor/requests/r1/chat"],
  ["/executor/requests/r1?from=n#chat", "/v2/executor/requests/r1/chat?from=n", "/executor/requests/r1/chat?from=n"],
  // Другой якорь и список заявок диалогом не становятся.
  ["/executor/requests/r1#offer", "/v2/executor/requests/r1#offer", "/executor/requests/r1#offer"],
  ["/executor/requests#chat", "/v2/executor/requests#chat", "/executor/requests#chat"],
  ["/executor/offers", "/v2/executor/offers", "/executor/offers"],
  ["/executor/finance", "/v2/executor/finance", "/executor/finance"],
  ["/executor/finance?month=2026-10", "/v2/executor/finance?month=2026-10", "/executor/finance?month=2026-10"],
  ["/executor/profile", "/v2/executor/profile", "/executor/profile"],
  ["/executor/profile/kyc", "/v2/executor/profile/kyc", "/executor/profile/kyc"],
  ["/executor/profile/payout", "/v2/executor/profile/payout", "/executor/profile/payout"],
  ["/executor/portfolio", "/v2/executor/portfolio", "/executor/portfolio"],
  ["/executor/portfolio/new", "/v2/executor/portfolio/new", "/executor/portfolio/new"],
  ["/executor/portfolio/w1", "/v2/executor/portfolio/w1", "/executor/portfolio/w1"],
  ["/register/executor", "/v2/register/executor", "/register/executor"],
  // Неизвестный путь — под префиксом, как есть (попадёт в заглушку).
  ["/something/else", "/v2/something/else", "/something/else"],
  // Уже под префиксом — без второго префикса.
  ["/v2", "/v2", "/v2"],
  ["/v2/deals/d1", "/v2/deals/d1", "/v2/deals/d1"],
  ["/v2/deals/d1?x=1#chat", "/v2/deals/d1?x=1#chat", "/v2/deals/d1?x=1#chat"],
  // Не путь этого сайта — главная.
  ["//evil.example/deals", "/v2", "/"],
  ["/\\evil.example", "/v2", "/"],
  ["https://evil.example/deals/1", "/v2", "/"],
  ["javascript:alert(1)", "/v2", "/"],
  ["deals", "/v2", "/"],
  ["", "/v2", "/"],
  ["/deals/../../admin", "/v2", "/"],
  ["/deals/%2e%2e/admin", "/v2", "/"],
  ["/deals\\..\\admin", "/v2", "/"],
  ["/deals\\x", "/v2", "/"],
  // Дважды закодированные точки — не переход вверх (браузер их не раскрывает): обычный путь.
  ["/deals/%252e%252e/x", "/v2/deals/%252e%252e/x", "/deals/%252e%252e/x"],
  ["/deals\n/x", "/v2", "/"],
];

describe.each([
  ["/v2", 1],
  ["", 2],
] as const)("makeV2Href(%j)", (base, col) => {
  const href = makeV2Href(base);

  it.each(V2_HREF)("v2Href(%j)", (input, ...expected) => {
    expect(href(input)).toBe(expected[col - 1]);
  });

  it("повторное применение ничего не меняет", () => {
    for (const [input] of V2_HREF) expect(href(href(input))).toBe(href(input));
  });
});

describe("v2Href: абсолютный адрес своего сайта", () => {
  const origin = "https://senim.example";

  it("без origin любой абсолютный адрес — главная", () => {
    expect(v2Href("https://senim.example/d/abc")).toBe("/v2");
  });

  it("свой origin: берётся путь, запрос и якорь", () => {
    expect(makeV2Href("/v2")("https://senim.example/d/abc?x=1#top", origin)).toBe("/v2/d/abc?x=1#top");
    expect(makeV2Href("")("https://senim.example/d/abc", origin)).toBe("/d/abc");
  });

  it("чужой origin, другая схема и мусор — главная", () => {
    const href = makeV2Href("/v2");
    expect(href("https://evil.example/d/abc", origin)).toBe("/v2");
    expect(href("https://senim.example.evil.example/d/abc", origin)).toBe("/v2");
    expect(href("https://senim.example@evil.example/d/abc", origin)).toBe("/v2");
    expect(href("https://senim.example/d/abc", "not a url")).toBe("/v2");
    expect(href("https:evil.example/d/abc", origin)).toBe("/v2");
    expect(href("https:/evil.example/d/abc", origin)).toBe("/v2");
    // Локальный путь при указанном origin обрабатывается как обычно.
    expect(href("/deals/d1", origin)).toBe("/v2/deals/d1");
  });
});

describe("v2Href приложения — префикс /v2", () => {
  it("совпадает с makeV2Href(\"/v2\")", () => {
    expect(v2Href("/deals/d1")).toBe("/v2/deals/d1");
    expect(v2Href("/requests/r1/offers/o9#chat")).toBe("/v2/chats/o9");
  });
});
