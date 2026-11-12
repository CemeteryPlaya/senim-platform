import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { documentBadge, signatureProgress } from "./state";

const at = new Date(0);

describe("signatureProgress — «Подписи: N из M» в разделе «Документы»", () => {
  it("считает только требуемые подписи обеих сторон", () => {
    expect(
      signatureProgress({
        parties: [
          { party: "CLIENT", required: { hand: true, ecp: true }, hand: { signedAt: at, documentSha256: "a", typed: false }, ecp: null },
          { party: "EXECUTOR", required: { hand: false, ecp: true }, hand: null, ecp: { signedAt: at, signedSha256: "a", method: "MOCK" } },
        ],
      }),
    ).toEqual({ done: 2, total: 3 });
    expect(signatureProgress({ parties: [] })).toEqual({ done: 0, total: 0 });
  });
});

describe("documentBadge — метка документа", () => {
  const party = { party: "CLIENT" as const, required: { hand: true, ecp: true }, hand: null, ecp: null };
  it("без подписи, подписан, заменён, в процессе — «N из M»", () => {
    expect(documentBadge({ signable: false, status: "SIGNING", parties: [] })).toEqual({ tone: "neutral", text: ru.documents.status.NOT_REQUIRED });
    expect(documentBadge({ signable: true, status: "SIGNED", parties: [party] })).toEqual({ tone: "success", text: ru.documents.status.SIGNED });
    expect(documentBadge({ signable: true, status: "SUPERSEDED", parties: [party] })).toEqual({ tone: "neutral", text: ru.documents.status.SUPERSEDED });
    expect(documentBadge({ signable: true, status: "SIGNING", parties: [party] })).toEqual({ tone: "warning", text: ru.documents.section.signaturesOf(0, 2) });
  });
});
