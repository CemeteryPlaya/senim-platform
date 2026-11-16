// @vitest-environment jsdom
import { act, useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@/kit/test-utils";
import { draftKey, useFormDraft, type FormDraft } from "./form-draft";

const EMPTY = { price: "", comment: "" };
const KEY = draftKey("offer", "req-1");

let latest: FormDraft<typeof EMPTY> | null = null;
function Probe({ id = "req-1" }: { id?: string }) {
  const draft = useFormDraft(draftKey("offer", id), EMPTY);
  useEffect(() => {
    latest = draft;
  });
  return <p>{`${draft.values.price}|${draft.values.comment}|${draft.restored}`}</p>;
}

afterEach(() => window.sessionStorage.clear());

describe("useFormDraft", () => {
  it("введённое переживает уход и возвращение; пустая форма черновика не оставляет", () => {
    const first = mount(<Probe />);
    act(() => latest?.set({ price: "1200000" }));
    act(() => latest?.set({ comment: "Сделаем за месяц" }));
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? "null")).toEqual({ price: "1200000", comment: "Сделаем за месяц" });
    first.unmount();

    const again = mount(<Probe />);
    expect(again.container.textContent).toBe("1200000|Сделаем за месяц|1");
    act(() => latest?.set({ price: "", comment: "" }));
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    again.unmount();
  });

  it("clear после отправки забывает черновик; у другой заявки черновик свой", () => {
    const m = mount(<Probe />);
    act(() => latest?.set({ price: "500000" }));
    act(() => latest?.clear());
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(m.container.textContent).toBe("||1");
    act(() => latest?.set({ price: "700000" }));
    m.unmount();
    const other = mount(<Probe id="req-2" />);
    expect(other.container.textContent).toBe("||0");
    other.unmount();
  });
});
