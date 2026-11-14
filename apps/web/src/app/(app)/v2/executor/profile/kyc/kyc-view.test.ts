import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ru } from "@/i18n/ru";
import type { UploaderItem } from "@/kit";
import { documentItems, isPdfName, kycNow, kycSchema, showAgainLink, showForm } from "./kyc-view";

const t = ru.app.masterCompany.kyc;

describe("карточка «Сейчас / Дальше» документов", () => {
  it("не поданы, на проверке (с числом файлов), проверены, отказ с причиной и без", () => {
    expect(kycNow("NOT_SUBMITTED", null, 0).title).toBe(t.status.NOT_SUBMITTED);
    expect(kycNow("PENDING", null, 3).uploaded).toBe(t.now.PENDING.uploaded(3));
    expect(kycNow("PENDING", null, 0).uploaded).toBeNull();
    expect(kycNow("VERIFIED", null, 2).uploaded).toBeNull();
    // Проверены: «Дальше» — про счёт, только пока он не указан.
    expect(kycNow("VERIFIED", null, 2).next).toBe(t.now.VERIFIED.next);
    expect(kycNow("VERIFIED", null, 2, { payoutSet: true }).next).toBeNull();
    // Режим «заново»: предупреждение о замене вместо «от вас ничего не требуется».
    const again = kycNow("PENDING", null, 2, { again: true });
    expect(again.body).toBe(t.now.PENDING.again);
    expect(again.uploaded).toBeNull();
    expect(kycNow("PENDING", null, 2).body).toBe(t.now.PENDING.body);
    expect(kycNow("REJECTED", "Фото нечёткое", 0).body).toBe(t.now.REJECTED.reason("Фото нечёткое"));
    expect(kycNow("REJECTED", null, 0).body).toBe(t.now.REJECTED.noReason);
  });

  it("число файлов склоняется", () => {
    expect(t.now.PENDING.uploaded(1)).toBe("Отправлено: 1 файл");
    expect(t.now.PENDING.uploaded(2)).toBe("Отправлено: 2 файла");
    expect(t.now.PENDING.uploaded(5)).toBe("Отправлено: 5 файлов");
  });
});

describe("когда показывать форму", () => {
  it("не поданы и отказ — сразу; на проверке — только по «заново»; проверенные заменять нельзя", () => {
    expect(showForm("NOT_SUBMITTED", true, false)).toBe(true);
    expect(showForm("REJECTED", true, false)).toBe(true);
    expect(showForm("PENDING", true, false)).toBe(false);
    expect(showForm("PENDING", true, true)).toBe(true);
    expect(showForm("VERIFIED", false, true)).toBe(false);
    expect(showAgainLink("PENDING", true, false)).toBe(true);
    expect(showAgainLink("PENDING", true, true)).toBe(false);
    expect(showAgainLink("REJECTED", true, false)).toBe(false);
  });
});

describe("файлы загрузчика", () => {
  it("PDF по имени — документ без превью; фото остаются с превью", () => {
    const items: UploaderItem[] = [
      { id: "1", name: "Талон.PDF", previewUrl: "blob:x", state: "done" },
      { id: "2", name: "front.jpg", previewUrl: "blob:y", state: "done" },
      { id: "3", name: "справка.pdf", state: "error", error: "Сбой" },
    ];
    const [pdf, photo, failed] = documentItems(items);
    expect(isPdfName("a.PdF")).toBe(true);
    expect(pdf).toEqual({ id: "1", name: "Талон.PDF", kind: "document", state: "done" });
    expect(photo).toBe(items[1]);
    expect(failed).toMatchObject({ kind: "document", state: "error", error: "Сбой" });
  });
});

describe("вход действия", () => {
  const ok = () => [randomUUID()];
  const issues = (input: unknown) => {
    const r = kycSchema.safeParse(input);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };

  it("по файлу в каждом разделе — верно; пустой раздел — отказ у раздела", () => {
    expect(issues({ idFileIds: ok(), registrationFileIds: ok() })).toEqual([]);
    expect(issues({ idFileIds: [], registrationFileIds: ok() })).toEqual([`idFileIds: ${t.form.errors.needId}`]);
    expect(issues({ idFileIds: ok(), registrationFileIds: [] })).toEqual([`registrationFileIds: ${t.form.errors.needRegistration}`]);
  });

  it("не больше четырёх в разделе; не UUID — «загрузите заново»; лишние поля отвергаются", () => {
    const five = Array.from({ length: 5 }, () => randomUUID());
    expect(issues({ idFileIds: five, registrationFileIds: ok() })).toEqual([`idFileIds: ${t.form.errors.limit(4)}`]);
    expect(issues({ idFileIds: ["не-uuid"], registrationFileIds: ok() })).toEqual([`idFileIds.0: ${t.form.errors.reupload}`]);
    expect(issues({ idFileIds: ok(), registrationFileIds: ok(), userId: "x" })).not.toEqual([]);
  });
});
