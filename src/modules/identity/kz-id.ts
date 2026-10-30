import type { LegalForm } from "@/generated/prisma/enums";
// INTEGRATOR: алгоритм контрольной цифры живёт в src/demo/kz-id.ts (его же использует сид).
// Перенести kzCheckDigit в src/platform/ и импортировать оттуда и здесь, и в сиде.
import { kzCheckDigit } from "@/demo/kz-id";

export type BinIinKind = "IIN" | "BIN";

/** Самозанятый и ИП работают по ИИН, ТОО — по БИН. */
export function binIinKindFor(legalForm: LegalForm): BinIinKind {
  return legalForm === "TOO" ? "BIN" : "IIN";
}

function checksumOk(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;
  return kzCheckDigit(value.slice(0, 11)) === Number(value[11]);
}

const month = (mm: string) => Number(mm) >= 1 && Number(mm) <= 12;

/** ИИН: ГГММДД, цифра века и пола 1–6, порядковый номер, контрольная цифра. */
export function isValidIin(value: string): boolean {
  if (!checksumOk(value)) return false;
  const day = Number(value.slice(4, 6));
  const centuryGender = Number(value[6]);
  return month(value.slice(2, 4)) && day >= 1 && day <= 31 && centuryGender >= 1 && centuryGender <= 6;
}

/** БИН: ГГММ регистрации, тип организации 4–6, признак 0–3, номер, контрольная цифра. */
export function isValidBin(value: string): boolean {
  if (!checksumOk(value)) return false;
  const orgType = Number(value[4]);
  const subdivision = Number(value[5]);
  return month(value.slice(2, 4)) && orgType >= 4 && orgType <= 6 && subdivision <= 3;
}

export function isValidBinIin(kind: BinIinKind, value: string): boolean {
  return kind === "IIN" ? isValidIin(value) : isValidBin(value);
}
