// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { edit, mount, submit, type Mounted } from "@/kit/test-utils";
import type { ActionResult } from "@/platform/action";

const { resolve, preview, refresh } = vi.hoisted(() => ({ resolve: vi.fn(), preview: vi.fn(), refresh: vi.fn() }));
vi.mock("../actions", () => ({ resolveDisputeAction: resolve, previewSplitAction: preview }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../../mfa/actions", () => ({ verifySecondFactorAction: vi.fn(async () => ({ ok: true, data: undefined })) }));

import { ResolveForm } from "./ResolveForm";

const t = ru.app.operatorDisputes;
const d = t.decision;

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.clearAllMocks();
});

const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
const show = (): HTMLDivElement => (mounted as Mounted).container;
const button = (label: string) => [...show().querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
const radio = (value: string) => show().querySelector<HTMLInputElement>(`input[type=radio][value=${value}]`) as HTMLInputElement;
const share = () => show().querySelector<HTMLInputElement>('input[data-field="masterShareKzt"]') as HTMLInputElement;

/** Текст в многострочное поле, как после ввода: значение мимо отслеживания React и событие `input`. */
function typeInto(area: HTMLTextAreaElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, value);
    area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  });
}

function open(): void {
  mounted = mount(<ResolveForm disputeId="d1" maxTiyn={100_000_000n} mobile={false} />);
}

function pickSplit(): void {
  act(() => radio("PARTIAL_SPLIT").click());
}

describe("форма решения спора", () => {
  it("по умолчанию — «продолжить работу», поля суммы нет; раздел показывает поле суммы и подсказку с потолком", () => {
    open();
    expect(radio("CONTINUE").checked).toBe(true);
    expect(share()).toBeNull();
    pickSplit();
    expect(share()).not.toBeNull();
    expect(show().textContent).toContain(d.shareHint(formatMoney(100_000_000n)));
    expect(show().textContent).toContain(d.previewWaiting);
  });

  it("расчёт раздела: сервер получает тенге цифрами, ответ — три суммы; правка суммы делает расчёт устаревшим", async () => {
    preview.mockResolvedValue({ ok: true, data: { shareTiyn: "6000000", masterTiyn: "5760000", platformTiyn: "240000", refundTiyn: "4000000" } } satisfies ActionResult<unknown>);
    open();
    pickSplit();
    edit(share(), "60000", { data: "60000" });
    act(() => button(d.previewButton).click());
    await settle();

    expect(preview).toHaveBeenCalledWith({ disputeId: "d1", masterShareKzt: "60000" });
    const text = show().textContent ?? "";
    expect(text).toContain(d.previewMaster);
    expect(text).toContain(formatMoney(5_760_000n));
    expect(text).toContain(formatMoney(240_000n));
    expect(text).toContain(formatMoney(4_000_000n));

    edit(share(), "70000", { data: "0" });
    expect(show().textContent).toContain(d.previewStale);
    expect(show().textContent).not.toContain(formatMoney(5_760_000n));
  });

  it("расчёт без суммы — ошибка у поля, сервер не вызывается; отказ сервера — ошибка у поля суммы", async () => {
    open();
    pickSplit();
    act(() => button(d.previewButton).click());
    await settle();
    expect(preview).not.toHaveBeenCalled();
    expect(show().textContent).toContain(d.shareRequired);

    preview.mockResolvedValue({ ok: false, code: "VALIDATION", error: "Сумма больше цены", fieldErrors: { masterShareKzt: ["Сумма больше цены"] } } satisfies ActionResult<unknown>);
    edit(share(), "9999999", { data: "9" });
    act(() => button(d.previewButton).click());
    await settle();
    expect(show().textContent).toContain("Сумма больше цены");
  });

  it("решение: итог, сумма и обоснование уходят в действие; успех — экран обновляется; код просят по MFA_REQUIRED", async () => {
    resolve.mockResolvedValueOnce({ ok: false, code: "MFA_REQUIRED", error: ru.identity.mfa.stepUp }).mockResolvedValueOnce({ ok: true, data: undefined });
    open();
    pickSplit();
    edit(share(), "60000", { data: "0" });
    typeInto(show().querySelector("textarea") as HTMLTextAreaElement, "Сделана половина работы");
    submit(show().querySelector("form") as HTMLFormElement);
    await settle();

    expect(resolve).toHaveBeenCalledWith({ disputeId: "d1", outcome: "PARTIAL_SPLIT", masterShareKzt: "60000", rationale: "Сделана половина работы" });
    const code = show().querySelector<HTMLInputElement>('input[name="mfaCode"]');
    expect(code).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();

    edit(code as HTMLInputElement, "123456", { data: "123456" });
    submit(show().querySelector("form") as HTMLFormElement);
    await settle();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenLastCalledWith({ disputeId: "d1", outcome: "PARTIAL_SPLIT", masterShareKzt: "60000", rationale: "Сделана половина работы" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ошибка обоснования — у поля, один раз (общей плашки нет)", async () => {
    resolve.mockResolvedValue({ ok: false, code: "VALIDATION", error: "Напишите обоснование", fieldErrors: { rationale: ["Напишите обоснование"] } } satisfies ActionResult<unknown>);
    open();
    submit(show().querySelector("form") as HTMLFormElement);
    await settle();
    expect((show().textContent ?? "").split("Напишите обоснование")).toHaveLength(2);
    expect(show().querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
  });
});
