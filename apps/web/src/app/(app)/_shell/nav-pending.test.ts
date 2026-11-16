import { describe, expect, it } from "vitest";
import { nextPending, shownHref } from "./nav-pending";

describe("вкладка выбирается в момент касания (useLinkStatus)", () => {
  it("начат переход — линза у нажатой вкладки, а не у текущего адреса", () => {
    const pending = nextPending(null, "/v2/deals", true);
    expect(pending).toBe("/v2/deals");
    expect(shownHref(pending, "/v2")).toBe("/v2/deals");
  });

  it("переход закончен — снова по адресу (он уже новый)", () => {
    expect(nextPending("/v2/deals", "/v2/deals", false)).toBeNull();
    expect(shownHref(null, "/v2/deals")).toBe("/v2/deals");
  });

  it("быстрые нажатия подряд: конец первого перехода не сбрасывает второй", () => {
    let pending = nextPending(null, "/v2/deals", true);
    pending = nextPending(pending, "/v2/chats", true);
    pending = nextPending(pending, "/v2/deals", false);
    expect(pending).toBe("/v2/chats");
  });

  it("ссылки без перехода при монтировании ничего не меняют", () => {
    expect(nextPending(null, "/v2/profile", false)).toBeNull();
    expect(shownHref(null, undefined)).toBeUndefined();
  });
});
