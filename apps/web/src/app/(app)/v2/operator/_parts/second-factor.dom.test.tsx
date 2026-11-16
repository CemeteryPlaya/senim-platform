// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { HiddenField } from "@/kit";
import { edit, mount, submit, type Mounted } from "@/kit/test-utils";
import type { ActionResult } from "@/platform/action";
import { MFA_CODE_FIELD, useActionForm, type VerifyCode } from "../../../_shell/form";
import { SecondFactorField } from "./SecondFactorField";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const STEP_UP = ru.identity.mfa.stepUp;

/** Форма действия с деньгами: скрытое поле операции, поле кода по просьбе, общая ошибка. */
function MoneyForm({ action, verify }: { action: (input: Record<string, FormDataEntryValue>) => Promise<ActionResult<number>>; verify: VerifyCode }) {
  const form = useActionForm(action, { verifyCode: verify });
  return (
    <form onSubmit={form.onSubmit} noValidate>
      <HiddenField name="transactionId" value="t1" />
      <SecondFactorField form={form} />
      {form.error && <p data-error>{form.error}</p>}
    </form>
  );
}

async function submitAndSettle(container: HTMLElement): Promise<void> {
  submit(container.querySelector("form") as HTMLFormElement);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const codeInput = (container: HTMLElement) => container.querySelector<HTMLInputElement>(`input[name="${MFA_CODE_FIELD}"]`);

describe("код из приложения в форме оператора (SecondFactorField + useActionForm)", () => {
  it("MFA_REQUIRED → поле кода с пояснением и фокусом; код → проверка, затем повтор действия без поля кода", async () => {
    const calls: Record<string, FormDataEntryValue>[] = [];
    const action = vi.fn(async (input: Record<string, FormDataEntryValue>): Promise<ActionResult<number>> => {
      calls.push(input);
      return calls.length === 1 ? { ok: false, code: "MFA_REQUIRED", error: STEP_UP } : { ok: true, data: 1 };
    });
    const verify = vi.fn<VerifyCode>(async () => ({ ok: true, data: undefined }));
    mounted = mount(<MoneyForm action={action} verify={verify} />);
    const { container } = mounted;
    expect(codeInput(container)).toBeNull();

    await submitAndSettle(container);
    const input = codeInput(container);
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    // Пояснение — текст сервера, связан с полем; общей ошибки нет.
    const reason = container.ownerDocument.getElementById(input?.getAttribute("aria-describedby")?.split(" ")[0] ?? "");
    expect(reason?.textContent).toBe(STEP_UP);
    expect(container.querySelector("[data-error]")).toBeNull();

    edit(input as HTMLInputElement, "123456", { data: "123456" });
    await submitAndSettle(container);
    expect(verify).toHaveBeenCalledWith({ code: "123456" });
    expect(calls[1]).toEqual({ transactionId: "t1" });
    // Действие прошло — поле кода убрано.
    expect(codeInput(container)).toBeNull();
  });

  it("код принят, действие упало по сети — поле кода убрано, повтор идёт без проверки кода", async () => {
    let calls = 0;
    const action = vi.fn(async (): Promise<ActionResult<number>> => {
      calls += 1;
      if (calls === 1) return { ok: false, code: "MFA_REQUIRED", error: STEP_UP };
      if (calls === 2) throw new TypeError("Failed to fetch");
      return { ok: true, data: 1 };
    });
    const verify = vi.fn<VerifyCode>(async () => ({ ok: true, data: undefined }));
    mounted = mount(<MoneyForm action={action} verify={verify} />);
    const { container } = mounted;
    await submitAndSettle(container);
    edit(codeInput(container) as HTMLInputElement, "123456", { data: "123456" });
    await submitAndSettle(container);
    expect(codeInput(container)).toBeNull();
    expect(container.querySelector("[data-error]")).not.toBeNull();

    await submitAndSettle(container);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(3);
    expect(container.querySelector("[data-error]")).toBeNull();
  });

  it("неверный код — ошибка под полем кода, действие не повторяется", async () => {
    const action = vi.fn(async (): Promise<ActionResult<number>> => ({ ok: false, code: "MFA_REQUIRED", error: STEP_UP }));
    const wrong = ru.identity.mfa.errors.wrongCode(4);
    const verify = vi.fn<VerifyCode>(async () => ({ ok: false, code: "VALIDATION", error: wrong, fieldErrors: { code: [wrong] } }));
    mounted = mount(<MoneyForm action={action} verify={verify} />);
    const { container } = mounted;
    await submitAndSettle(container);
    edit(codeInput(container) as HTMLInputElement, "000000", { data: "000000" });
    await submitAndSettle(container);

    expect(action).toHaveBeenCalledTimes(1);
    const input = codeInput(container) as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(wrong);
  });
});
