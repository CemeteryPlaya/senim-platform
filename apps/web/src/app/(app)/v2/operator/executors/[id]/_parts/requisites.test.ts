import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { requisitesOf } from "./requisites";

const q = ru.app.operatorQueues;
const r = q.executors.card.requisites;

const card = (over: Partial<Parameters<typeof requisitesOf>[0]> = {}) =>
  requisitesOf({ legalForm: "TOO", legalName: "ТОО «Ағаш Шебер»", binIinLast4: "2345", signerFullName: "Тулегенов Бауыржан", payoutIbanLast4: "0100", ...over });

describe("реквизиты исполнителя для сверки оператором (номера — последние 4 символа)", () => {
  it("название, форма, ИИН/БИН, подписант и счёт для оплаты", () => {
    expect(card()).toEqual([
      { label: r.legalName, value: "ТОО «Ағаш Шебер»" },
      { label: r.legalForm, value: q.legalForms.TOO },
      { label: r.binIin, value: "•••• 2345", numeric: true },
      { label: r.signer, value: "Тулегенов Бауыржан" },
      { label: r.iban, value: "•••• 0100", numeric: true },
    ]);
  });

  it("счёт не указан и подписанта нет — так и сказано, а не пусто", () => {
    const rows = card({ payoutIbanLast4: null, signerFullName: null });
    expect(rows.find((x) => x.label === r.iban)).toEqual({ label: r.iban, value: r.ibanMissing });
    expect(rows.find((x) => x.label === r.signer)).toEqual({ label: r.signer, value: q.none });
  });

  it("полных номеров нет: ИИН/БИН и IBAN — только маской", () => {
    expect(JSON.stringify(card())).not.toMatch(/\d{5,}/);
  });
});
