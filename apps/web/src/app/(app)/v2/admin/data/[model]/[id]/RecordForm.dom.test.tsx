// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { edit, mount, submit, type Mounted } from "@/kit/test-utils";
import type { AdminFieldInfo, AdminRow } from "@/modules/admin";

const { update, refresh, toastFn } = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn(), toastFn: vi.fn() }));
vi.mock("./actions", () => ({ updateRecordAction: update }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/v2/admin/data/ExecutorProfile/p1" }));
vi.mock("@/kit", async (original) => ({ ...(await original<typeof import("@/kit")>()), toast: toastFn }));

import { RecordForm } from "./RecordForm";

const t = ru.app.admin.record;

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.clearAllMocks();
  update.mockReset();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
const show = (): HTMLDivElement => (mounted as Mounted).container;
const field = (name: string) => show().querySelector<HTMLInputElement>(`[name="to.${name}"]`);
const form = () => show().querySelector("form") as HTMLFormElement;

/** Профиль мастера, как его отдаёт модуль: часть полей правится (строка, целое, флажок, перечисление), часть — только чтение. */
const FIELDS: AdminFieldInfo[] = [
  { name: "id", type: "String", access: "readonly", required: true },
  { name: "about", type: "String", access: "editable", required: true },
  { name: "yearsExperience", type: "Int", access: "editable", required: true },
  { name: "city", type: "String", access: "editable", required: true },
  { name: "addedByOperator", type: "Boolean", access: "readonly", required: true },
  { name: "featured", type: "Boolean", access: "editable", required: true },
  { name: "measurementTerms", type: "MeasurementTerms", access: "editable", required: true, enumValues: ["FREE", "FEE_IF_NO_DEAL"] },
  { name: "status", type: "RegistrationStatus", access: "readonly", required: true, enumValues: ["PENDING", "APPROVED", "REJECTED"] },
  { name: "rejectReason", type: "String", access: "readonly", required: false },
];
const ROW: AdminRow = {
  id: "p1",
  about: "Кухни на заказ",
  yearsExperience: 7,
  city: "Астана",
  addedByOperator: false,
  featured: true,
  measurementTerms: "FREE",
  status: "APPROVED",
  rejectReason: null,
};

function open(fields: readonly AdminFieldInfo[] = FIELDS, row: AdminRow = ROW): void {
  mounted = mount(<RecordForm model="ExecutorProfile" id="p1" fields={fields} row={row} />);
}

describe("форма записи админки", () => {
  it("редактируемые поля — поля kit не ниже 48 px; только чтение — текстом без полей; одно главное действие «Сохранить»", () => {
    open();
    for (const name of ["about", "yearsExperience", "city", "measurementTerms"]) {
      const control = field(name);
      expect(control, name).not.toBeNull();
      expect(control?.className, name).toMatch(/\bh-control\b/);
    }
    // Флажок: цель касания — вся строка подписи 48 px.
    const featured = field("featured");
    expect(featured?.type).toBe("checkbox");
    expect(featured?.checked).toBe(true);
    expect(featured?.closest("label")?.className).toMatch(/\bmin-h-control\b/);
    expect(field("measurementTerms")?.tagName).toBe("SELECT");
    expect(field("yearsExperience")?.getAttribute("inputmode")).toBe("numeric");

    for (const name of ["id", "addedByOperator", "status", "rejectReason"]) expect(field(name), name).toBeNull();
    const text = show().textContent ?? "";
    expect(text).toContain("APPROVED");
    expect(text).toContain("rejectReason");
    expect(text).toContain(ru.app.admin.data.none);

    const primary = show().querySelectorAll("[data-primary-action]");
    expect(primary).toHaveLength(1);
    expect(primary[0].textContent).toBe(t.save);
    expect((primary[0] as HTMLButtonElement).type).toBe("submit");
  });

  it("прежние значения — скрытыми полями; отправка — правка по каждому редактируемому полю с from и to", async () => {
    update.mockResolvedValue({ ok: true, data: { changed: 1 } });
    open();
    const hidden = Object.fromEntries([...show().querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((i) => [i.name, i.value]));
    expect(hidden).toEqual({ "from.about": "Кухни на заказ", "from.yearsExperience": "7", "from.city": "Астана", "from.featured": "true", "from.measurementTerms": "FREE" });

    edit(field("city") as HTMLInputElement, "Алматы");
    act(() => field("featured")?.click());
    submit(form());
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toEqual({
      model: "ExecutorProfile",
      id: "p1",
      changes: [
        { field: "about", from: "Кухни на заказ", to: "Кухни на заказ" },
        { field: "yearsExperience", from: "7", to: "7" },
        { field: "city", from: "Астана", to: "Алматы" },
        { field: "featured", from: "true", to: "false" },
        { field: "measurementTerms", from: "FREE", to: "FREE" },
      ],
    });
    expect(toastFn).toHaveBeenCalledWith(t.saved);
    expect(refresh).toHaveBeenCalled();
  });

  it("пустое прежнее значение — без скрытого поля (null); ничего не изменилось — «Изменений нет»", async () => {
    update.mockResolvedValue({ ok: true, data: { changed: 0 } });
    const fields: AdminFieldInfo[] = [{ name: "customType", type: "String", access: "editable", required: false }];
    open(fields, { customType: null });
    expect(show().querySelector('input[type="hidden"]')).toBeNull();
    submit(form());
    await settle();
    expect(update.mock.calls[0][0].changes).toEqual([{ field: "customType", from: null, to: "" }]);
    expect(toastFn).toHaveBeenCalledWith(t.unchanged);
  });

  it("конфликт — текст модуля плашкой; ошибка поля — у поля", async () => {
    update.mockResolvedValueOnce({ ok: false, code: "CONFLICT", error: t.conflict });
    open();
    submit(form());
    await settle();
    expect(show().querySelector('[role="alert"]')?.textContent).toContain(t.conflict);
    expect(refresh).not.toHaveBeenCalled();

    update.mockResolvedValueOnce({ ok: false, code: "VALIDATION", error: ru.common.errors.invalid, fieldErrors: { yearsExperience: [t.errors.int] } });
    submit(form());
    await settle();
    const years = field("yearsExperience");
    expect(years?.getAttribute("aria-invalid")).toBe("true");
    expect(show().textContent).toContain(t.errors.int);
  });

  it("таблица только для чтения — без формы и кнопки, все поля текстом", () => {
    open(FIELDS.map((f) => ({ ...f, access: "readonly" as const })));
    expect(show().querySelector("form")).toBeNull();
    expect(show().querySelectorAll("button")).toHaveLength(0);
    expect(show().textContent).toContain(t.readonlyNote);
    expect(show().textContent).toContain("Кухни на заказ");
  });
});
