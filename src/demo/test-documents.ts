import { brand } from "@/config/brand";
import { renderPdf } from "@/modules/documents";

/**
 * Тестовый PDF с пометкой «ТЕСТОВЫЙ ДОКУМЕНТ» крупно: скан удостоверения и регистрации для KYC и скан
 * банковского документа для подтверждений оператора. Настоящих документов в демо нет.
 */
export function testDocumentPdf(title: string, lines: readonly string[], issuedAt: Date): Promise<Uint8Array> {
  return renderPdf({
    title,
    issuedAt,
    footer: `ТЕСТОВЫЙ ДОКУМЕНТ — демо-данные ${brand.name}`,
    blocks: [{ kind: "notice", text: "ТЕСТОВЫЙ ДОКУМЕНТ — не настоящий" }, { kind: "title", text: title }, ...lines.map((text) => ({ kind: "paragraph" as const, text }))],
  });
}
