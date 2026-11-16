// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { mount } from "@/kit/test-utils";
import { randomKey, useClientKey, type ClientKey } from "./client-key";

function Probe({ expose }: { expose: (k: ClientKey) => void }) {
  expose(useClientKey());
  return null;
}

describe("useClientKey: ключ повтора формы", () => {
  it("ключ — UUID, стабилен между отрисовками; renew() даёт новый", () => {
    let current: ClientKey | null = null;
    const view = mount(<Probe expose={(k) => (current = k)} />);
    const first = current!.key;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    act(() => view.root.render(<Probe expose={(k) => (current = k)} />));
    expect(current!.key).toBe(first);
    act(() => current!.renew());
    expect(current!.key).not.toBe(first);
    view.unmount();
  });
});

describe("randomKey: ключ и на http вне localhost", () => {
  it("без crypto.randomUUID (страница по http с адресом сети) — всё равно UUID v4 из crypto.getRandomValues", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const a = randomKey();
      const b = randomKey();
      expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(b).not.toBe(a);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
