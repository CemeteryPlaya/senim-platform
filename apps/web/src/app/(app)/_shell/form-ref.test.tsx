// @vitest-environment jsdom
import { useRef } from "react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { TextField } from "@/kit";
import { edit, mount } from "@/kit/test-utils";
import { useActionForm } from "./form";

/** Форма без onSubmit хука: проверка в браузере (`reject`) и программная отправка, как в мастерах и длинных формах. */
function Screen({ expose }: { expose: (reject: (errors: Record<string, string>) => void) => void }) {
  const ref = useRef<HTMLFormElement>(null);
  const form = useActionForm(async () => ({ ok: true as const, data: null }), { formRef: ref, clears: (name) => (name === "alias" ? ["title"] : []) });
  expose(form.reject);
  return (
    <form ref={ref} noValidate>
      <TextField label="Название" name="title" error={form.fieldErrors.title} />
      <TextField label="Псевдоним" name="alias" />
      <TextField label="Город" name="city" error={form.fieldErrors.city} />
    </form>
  );
}

describe("useActionForm: formRef и reject", () => {
  it("отказ проверки ставит фокус на первое поле с ошибкой, правка снимает ошибку этого поля", () => {
    let reject: (errors: Record<string, string>) => void = () => {};
    const m = mount(<Screen expose={(r) => (reject = r)} />);
    const [title, , city] = Array.from(m.container.querySelectorAll("input"));
    act(() => reject({ city: "Укажите город", title: "Укажите название" }));
    expect(m.container.textContent).toContain("Укажите город");
    expect(document.activeElement).toBe(title);

    edit(city as HTMLInputElement, "Алматы");
    expect(m.container.textContent).not.toContain("Укажите город");
    expect(m.container.textContent).toContain("Укажите название");
    m.unmount();
  });

  it("clears: правка поля снимает и ошибку, названную иначе", () => {
    let reject: (errors: Record<string, string>) => void = () => {};
    const m = mount(<Screen expose={(r) => (reject = r)} />);
    const alias = m.container.querySelectorAll("input")[1] as HTMLInputElement;
    act(() => reject({ title: "Укажите название" }));
    edit(alias, "кухня");
    expect(m.container.textContent).not.toContain("Укажите название");
    m.unmount();
  });
});
