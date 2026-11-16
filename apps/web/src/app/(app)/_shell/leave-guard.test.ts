import { describe, expect, it } from "vitest";
import { leavingPath, type ClickInfo } from "./leave-guard";

const here = { origin: "https://senim.test", pathname: "/v2/deals/1/dispute", search: "" };
const click = (patch: Partial<ClickInfo> & { href?: string; target?: string; download?: boolean }): ClickInfo => ({
  button: 0,
  modifiers: false,
  defaultPrevented: false,
  here,
  link: { href: patch.href ?? "/v2/deals/1", target: patch.target ?? "", download: patch.download ?? false },
  ...("link" in patch ? { link: patch.link ?? null } : {}),
  ...(patch.button !== undefined ? { button: patch.button } : {}),
  ...(patch.modifiers !== undefined ? { modifiers: patch.modifiers } : {}),
});

describe("leavingPath", () => {
  it("ссылка на другую страницу сайта — куда уводит", () => {
    expect(leavingPath(click({ href: "/v2/deals/1?tab=money#top" }))).toBe("/v2/deals/1?tab=money#top");
    expect(leavingPath(click({ href: "https://senim.test/v2/chats" }))).toBe("/v2/chats");
  });

  it.each([
    ["чужой сайт", { href: "https://example.com/" }],
    ["новая вкладка", { target: "_blank" }],
    ["скачивание", { download: true }],
    ["эта же страница", { href: "/v2/deals/1/dispute" }],
    ["средняя кнопка", { button: 1 }],
    ["с Ctrl / Cmd", { modifiers: true }],
    ["не ссылка", { link: null }],
  ])("%s — не мешаем", (_name, patch) => {
    expect(leavingPath(click(patch))).toBeNull();
  });
});
