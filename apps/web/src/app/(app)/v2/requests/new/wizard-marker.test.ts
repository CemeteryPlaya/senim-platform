// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { memoryKey } from "./wizard-memory";

// Ввод первого шага до создания черновика хранится под меткой мастера из адреса (`?w=`): новая заявка — новая метка,
// и ввод брошенной заявки в неё не подставляется; перезагрузка с той же меткой — ввод на месте.

const PREFIX = "senim.request-wizard";

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/v2/requests/new");
});

describe("метка мастера заявки до черновика", () => {
  it("адрес без w — новая метка в адресе; ввод прошлой брошенной заявки забыт", () => {
    sessionStorage.setItem(`${PREFIX}:new-old1:start`, JSON.stringify({ furnitureType: "kitchen" }));
    sessionStorage.setItem(`${PREFIX}.session`, "new-old1");

    const key = memoryKey(null, "start");

    const w = new URL(window.location.href).searchParams.get("w");
    expect(w).toMatch(/^new-[a-z0-9]+$/);
    expect(w).not.toBe("new-old1");
    expect(key).toBe(`${PREFIX}:${w}:start`);
    expect(sessionStorage.getItem(`${PREFIX}:new-old1:start`)).toBeNull();
  });

  it("перезагрузка с той же w — тот же ключ, ввод на месте", () => {
    window.history.replaceState(null, "", "/v2/requests/new?w=new-abc123");
    sessionStorage.setItem(`${PREFIX}:new-abc123:start`, JSON.stringify({ furnitureType: "kitchen" }));
    expect(memoryKey(null, "start")).toBe(`${PREFIX}:new-abc123:start`);
    expect(sessionStorage.getItem(`${PREFIX}:new-abc123:start`)).not.toBeNull();
  });

  it("черновик — ключ по черновику, метка не нужна; чужие черновики не трогаются", () => {
    sessionStorage.setItem(`${PREFIX}:d1:place`, "{}");
    expect(memoryKey("d1", "place")).toBe(`${PREFIX}:d1:place`);
    expect(new URL(window.location.href).searchParams.get("w")).toBeNull();
    expect(sessionStorage.getItem(`${PREFIX}:d1:place`)).toBe("{}");
  });
});
