import type { LegalForm, PaymentDue, PaymentMode } from "@/generated/prisma/enums";

/** Данные для шаблонов. Сервис собирает их из БД и расшифровывает ИИН/БИН; шаблоны — чистые функции. */

export type DocStage = {
  order: number;
  title: string;
  description: string;
  amount: number; // ₸
  paymentDue: PaymentDue;
};

export type ContractData = {
  number: string; // «Д-0014/2026»
  version: number;
  issuedAt: Date;
  city: string;
  paymentMode: PaymentMode;
  /** Заказчик: ФИО и ИИН (если указан при регистрации). Телефон в договор не попадает. */
  client: { fullName: string; iin: string | null };
  /**
   * Исполнитель раскрывается только здесь: наименование/ФИО и ИИН/БИН. Телефон — нигде.
   * signerFullName — подписант профиля: у ТОО директор («в лице директора …»); null — профиль до ADR-003.
   */
  executor: { legalForm: LegalForm; legalName: string; binIin: string; signerFullName: string | null };
  subject: { title: string; details: string[]; address: string | null };
  totalAmount: number;
  stages: DocStage[];
  durationDays: number;
  warrantyMonths: number;
  autoAcceptDays: number;
};

export type StageActData = {
  number: string; // «А-0014-2»
  issuedAt: Date;
  city: string;
  paymentMode: PaymentMode;
  /** Договор, к которому составлен акт; стороны в акте названы через договор, без раскрытия исполнителя. */
  contractNumber: string;
  dealTitle: string;
  stage: DocStage;
  acceptedAt: Date;
  acceptedAutomatically: boolean;
  autoAcceptDays: number;
};
