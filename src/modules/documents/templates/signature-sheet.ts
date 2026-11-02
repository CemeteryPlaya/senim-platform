import type { SignMethod } from "@/generated/prisma/enums";
import type { Block, PdfSpec } from "../pdf/spec";
import { TEMPLATE_EDITION, dateTime } from "./common";
import type { SignatureSheetData } from "./types";

/*
 * Лист подписей — последняя страница подписанной копии. Подписывается исходный PDF (его SHA-256 — в Document),
 * лист его не меняет: копия = страницы исходного файла + этот лист. Здесь — изображение собственноручной
 * подписи (или напечатанное имя), время, хэш, который подписан, и данные сертификата ЭЦП. ИИН — последние 4 цифры.
 * IP и устройство подписанта в лист не попадают: копию пересылают третьим лицам; они хранятся на платформе.
 */

const METHOD: Record<SignMethod, string> = {
  EGOV_QR: "eGov Mobile (QR)",
  NCALAYER: "NCALayer",
  MOCK: "демо-подпись без юридической силы",
};

const matches = (signed: string, sha256: string) => (signed === sha256 ? "совпадает с хэшем документа" : "НЕ совпадает с хэшем документа");

function partyBlocks(p: SignatureSheetData["parties"][number], sha256: string): Block[] {
  const blocks: Block[] = [{ kind: "heading", text: `${p.role}: ${p.name}` }];
  const { hand, ecp } = p;
  if (!hand) blocks.push({ kind: "paragraph", text: "Собственноручная подпись: нет." });
  else if (hand.image) {
    blocks.push({ kind: "image", image: hand.image, maxHeight: 90, caption: `Собственноручная подпись · ${dateTime(hand.signedAt)} · хэш ${matches(hand.documentSha256, sha256)}` });
  } else {
    blocks.push({ kind: "paragraph", text: `Собственноручная подпись (напечатанное имя): ${hand.typedName ?? ""}`, bold: true });
    blocks.push({ kind: "paragraph", text: `${dateTime(hand.signedAt)} · хэш ${matches(hand.documentSha256, sha256)}` });
  }
  if (!ecp) blocks.push({ kind: "paragraph", text: "ЭЦП: нет." });
  else {
    const iin = ecp.certIinLast4 ? `, ИИН •••• ${ecp.certIinLast4}` : "";
    blocks.push({
      kind: "paragraph",
      text: `ЭЦП (${METHOD[ecp.method]}): ${dateTime(ecp.signedAt)} · сертификат № ${ecp.certSerial}, владелец ${ecp.certSubject}${iin} · подпись проверена платформой, хэш ${matches(ecp.signedSha256, sha256)}.`,
    });
  }
  return blocks;
}

export function signatureSheetSpec(d: SignatureSheetData): PdfSpec {
  return {
    title: `Лист подписей — ${d.documentTitle}`,
    issuedAt: d.issuedAt,
    footer: `Лист подписей к документу «${d.documentTitle}» · ${TEMPLATE_EDITION}`,
    blocks: [
      { kind: "title", text: "ЛИСТ ПОДПИСЕЙ" },
      { kind: "subtitle", text: d.documentTitle },
      { kind: "paragraph", text: `Стороны подписали PDF-файл документа с хэшем SHA-256: ${d.sha256}. Хэш подписанного файла можно проверить: исходный файл скачивается без листа подписей.` },
      ...d.parties.flatMap((p) => partyBlocks(p, d.sha256)),
    ],
  };
}
