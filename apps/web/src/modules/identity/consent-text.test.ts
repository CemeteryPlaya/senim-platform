import { describe, expect, it } from "vitest";
import { brand } from "@/config/brand";
import { CONSENT_DOCUMENTS } from "@/i18n/ru/consent";
import { canonicalJson, consentTextSha256, needsConsent } from "./consent-text";

/**
 * Закреплённые хэши текстов согласий: identity хранит версию и SHA-256 показанного текста, поэтому любая правка текста —
 * новая версия. Тест падает, если текст изменился, а версия — нет. Сменили текст — смените `version` в ru/consent.ts и
 * закрепите здесь новую пару (старую редакцию identity хранит в записях согласий).
 */
const PINNED = {
  PD_PROCESSING: { version: "2026-11-11-d1", sha256: "fb08a2f72968416372000b3230633897f9c7a511ebf1f5d28df4e841359a1c62" },
  BANK_TRANSFER: { version: "2026-11-11-d1", sha256: "e6134ff86cb97b837c07f1ca4e8cd61c4b3d7c2245dcfec5dc8853fd6a3d8fe5" },
} as const;

describe("тексты согласий: версия и хэш", () => {
  it.each(["PD_PROCESSING", "BANK_TRANSFER"] as const)("%s: текст не менялся без новой версии (снимок хэша)", (kind) => {
    expect({ version: CONSENT_DOCUMENTS[kind].version, sha256: consentTextSha256(kind) }).toEqual(PINNED[kind]);
  });

  it("хэш — SHA-256 канонического JSON: 64 hex-символа, не зависит от порядка полей", () => {
    expect(consentTextSha256("PD_PROCESSING")).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJson({ b: 1, a: [{ d: "x", c: null }] })).toBe(canonicalJson({ a: [{ c: null, d: "x" }], b: 1 }));
    expect(canonicalJson({ b: 1, a: "т" })).toBe('{"a":"т","b":1}');
  });

  it("любая правка текста меняет хэш", () => {
    const doc = CONSENT_DOCUMENTS.PD_PROCESSING;
    const changed = { ...doc, sections: doc.sections.map((s, i) => (i === 0 ? { ...s, body: `${s.body} ` } : s)) };
    expect(canonicalJson(changed)).not.toBe(canonicalJson(doc));
  });

  it("структура A.8: черновик первой строкой; 12 разделов ПДн, 4 — передачи банку; версия и цели — по правилам identity", () => {
    expect(Object.keys(CONSENT_DOCUMENTS.PD_PROCESSING)[0]).toBe("version");
    for (const doc of Object.values(CONSENT_DOCUMENTS)) {
      expect(doc.draft).toBe("Черновик, требует юридической проверки");
      expect(doc.version).toMatch(/^[A-Za-z0-9.-]{1,32}$/);
      expect(doc.purposes.length).toBeGreaterThan(0);
      expect(doc.purposes.length).toBeLessThanOrEqual(32);
      for (const p of doc.purposes) {
        expect(p.trim().length).toBeGreaterThan(0);
        expect(p.length).toBeLessThanOrEqual(200);
      }
    }
    expect(CONSENT_DOCUMENTS.PD_PROCESSING.sections).toHaveLength(12);
    expect(CONSENT_DOCUMENTS.BANK_TRANSFER.sections.map((s) => s.heading)).toEqual(["1. Цель", "2. Какие данные передаются", "3. Банк-партнёр", "4. Срок и отзыв"]);
    // Название продукта — из brand.ts; реквизиты ТОО и банка — заполнители до проверки юристом.
    expect(CONSENT_DOCUMENTS.PD_PROCESSING.sections[0]!.body).toContain(brand.name);
    expect(CONSENT_DOCUMENTS.PD_PROCESSING.sections[0]!.body).toContain("[наименование ТОО, БИН]");
  });
});

describe("needsConsent", () => {
  const current = CONSENT_DOCUMENTS.PD_PROCESSING.version;

  it("нет согласия или только прежняя редакция — нужен экран согласия", () => {
    expect(needsConsent({ role: "CLIENT", consents: [] })).toBe(true);
    expect(needsConsent({ role: "EXECUTOR", consents: [{ version: "2020-01-01" }] })).toBe(true);
  });

  it("согласие текущей редакции — не нужен (среди нескольких — тоже)", () => {
    expect(needsConsent({ role: "CLIENT", consents: [{ version: "2020-01-01" }, { version: current }] })).toBe(false);
  });

  it("сотрудникам площадки (оператор, замерщик) экран не нужен", () => {
    expect(needsConsent({ role: "OPERATOR", consents: [] })).toBe(false);
    expect(needsConsent({ role: "MEASURER", consents: [] })).toBe(false);
  });
});
