/**
 * PaymentRail — точка подключения банка. Сделка не знает, кто держит деньги:
 *  - manual: заказчик платит исполнителю напрямую, платформа только фиксирует отметки сторон;
 *  - escrow-simulator: встроенный симулятор банка (честно подписан в интерфейсе), полный цикл эскроу для показа;
 *  - bank: эскроу-счёт банка-партнёра. Сейчас только интерфейс; требования — docs/bank/03-escrow-integration.md.
 *
 * Денежные операции идемпотентны: повтор с тем же idempotencyKey не создаёт второе движение денег.
 * Деньги клиентов никогда не проходят через счёт платформы.
 */

export type RailMode = "manual" | "escrow-simulator" | "bank";

export type Requisites = {
  bankName: string;
  bik: string;
  iban: string; // счёт эскроу конкретной сделки
  beneficiary: string;
  paymentPurpose: string; // назначение платежа, по нему банк сопоставляет пополнение
};

export type OpenAccountInput = {
  dealId: string;
  dealNumber: number;
  amount: number; // ₸
  idempotencyKey: string;
};

export type TrancheInput = {
  externalId: string; // счёт сделки у банка
  dealId: string;
  /** Этап, за который раскрывается транш; нет — выплата по решению спора. */
  stageId?: string;
  amount: number;
  idempotencyKey: string;
};

export type RefundInput = {
  externalId: string;
  dealId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
};

export type OperationResult =
  | { status: "SUCCEEDED"; externalRef: string }
  | { status: "PENDING"; externalRef: string } // итог придёт вебхуком
  | { status: "FAILED"; externalRef?: string; error: string };

export type StatementEntry = {
  externalRef: string;
  kind: "DEPOSIT" | "RELEASE" | "REFUND";
  amount: number;
  occurredAt: Date;
  idempotencyKey?: string;
};

export type RailWebhookEvent = {
  eventId: string; // уникален у банка: повторная доставка не обрабатывается дважды
  type: "DEPOSIT_RECEIVED" | "RELEASE_COMPLETED" | "REFUND_COMPLETED" | "OPERATION_FAILED";
  externalId: string;
  amount: number;
  operationRef?: string;
  occurredAt: Date;
};

export interface PaymentRail {
  readonly mode: RailMode;
  /** Нужен ли шаг пополнения счёта до начала работ. В manual — нет. */
  readonly requiresDeposit: boolean;
  openAccount(input: OpenAccountInput): Promise<{ externalId: string; requisites: Requisites }>;
  getRequisites(externalId: string): Promise<Requisites>;
  releaseTranche(input: TrancheInput): Promise<OperationResult>;
  refund(input: RefundInput): Promise<OperationResult>;
  getStatement(externalId: string): Promise<StatementEntry[]>;
  /** Проверяет подпись вебхука (HMAC) и разбирает тело. Неверная подпись — исключение. */
  parseWebhook(input: { headers: Headers; rawBody: string }): Promise<RailWebhookEvent>;
}
