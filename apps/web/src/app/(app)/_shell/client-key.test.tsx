// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { mount } from "@/kit/test-utils";
import { useClientKey, type ClientKey } from "./client-key";

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
