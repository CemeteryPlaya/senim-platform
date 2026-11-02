import type { LegalForm, MoneyTransactionStatus, MoneyTransactionType, PaymentProviderKind, SignMethod, SignParty } from "@/generated/prisma/enums";

/** Данные для шаблонов. Сервис собирает их из БД и расшифровывает ИИН/БИН; шаблоны — чистые функции. */

/** Снимок денег сделки (computeDealMoney при акцепте), тиыны. */
export type DealMoney = {
  priceTiyn: bigint;
  protectionTiyn: bigint;
  buyerTotalTiyn: bigint;
  guaranteeTiyn: bigint;
  payoutTiyn: bigint;
  platformIncomeTiyn: bigint;
};

export type ExecutorParty = { legalForm: LegalForm; legalName: string; binIin: string; signerFullName: string | null };

export type ContractData = {
  number: string; // «Д-0014/2026»
  version: number;
  issuedAt: Date;
  city: string;
  /** Покупатель: ФИО и ИИН (если указан). Телефон в оферту не попадает. */
  client: { fullName: string; iin: string | null };
  /** Мастер раскрывается здесь: наименование/ФИО и ИИН/БИН. Телефон — нигде. */
  executor: ExecutorParty;
  subject: { title: string; details: string[]; address: string | null };
  money: DealMoney;
  durationDays: number;
  warrantyMonths: number;
  provider: PaymentProviderKind;
  isDemo: boolean;
};

/** Фото сдачи для акта: байты для встраивания (null — файл недоступен) и хэш файла — он фиксирует фото в акте. */
export type ActPhoto = { image: PdfImage | null; sha256: string };
export type PdfImage = { bytes: Uint8Array; format: "jpg" | "png" };

export type AcceptanceActData = {
  number: string; // «А-0014»
  version: number;
  issuedAt: Date;
  city: string;
  contractNumber: string;
  dealTitle: string;
  /** Стороны названы как в оферте, без ИИН/БИН: реквизиты раскрываются только в оферте. */
  clientName: string;
  executorName: string;
  money: DealMoney;
  readyAt: Date;
  photos: ActPhoto[];
  /** GPS-отметка сдачи: null — мастер не дал геолокацию. */
  gps: { distanceM: number | null; withinRadius: boolean | null; radiusM: number; accuracyM: number | null } | null;
  /** Флаг executorHandSignsAct: подписывает ли мастер акт ещё и собственноручно. */
  executorHandSigns: boolean;
  isDemo: boolean;
};

export type StatementEntry = {
  type: Exclude<MoneyTransactionType, "RELEASE">;
  status: MoneyTransactionStatus;
  amountTiyn: bigint;
  at: Date;
  operationRef: string | null;
  isTest: boolean;
};

export type MoneyStatementData = {
  number: string; // «В-0014»
  version: number;
  issuedAt: Date;
  contractNumber: string | null;
  dealTitle: string;
  money: DealMoney;
  entries: StatementEntry[];
  bankBalanceTiyn: bigint;
  isDemo: boolean;
};

export type ReleaseReceiptData = {
  number: string; // «Р-0014»
  version: number;
  issuedAt: Date;
  city: string;
  contractNumber: string;
  actNumber: string | null;
  actSha256: string | null;
  client: { fullName: string; iin: string | null };
  executor: ExecutorParty & { iban: string | null };
  money: DealMoney;
  /** Суммы раскрытия из журнала (SPLIT_MASTER, SPLIT_PLATFORM, REFUND), тиыны. */
  release: { masterTiyn: bigint; platformTiyn: bigint; refundTiyn: bigint };
};

/** Лист подписей — приложение к подписанной копии документа. */
export type SignatureSheetData = {
  documentTitle: string;
  sha256: string;
  issuedAt: Date;
  parties: {
    party: SignParty;
    role: string;
    name: string;
    hand: { image: PdfImage | null; typedName: string | null; signedAt: Date; documentSha256: string } | null;
    ecp: { method: SignMethod; signedAt: Date; signedSha256: string; certSubject: string; certSerial: string; certIinLast4: string | null } | null;
  }[];
};
