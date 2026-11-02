/**
 * Платёжный провайдер (ТЗ п. 10, ADR-009): банк не вшит в бизнес-логику. deal-core пишет операцию в журнал
 * (`MoneyTransaction`, статус PENDING) и вызывает провайдера с тем же ключом идемпотентности; повтор вызова
 * с тем же ключом у провайдера не создаёт второй операции. Итог — сразу (`SUCCEEDED`/`FAILED`) или позже:
 * вебхуком провайдера, кнопкой оператора (manual) или опросом `getStatus`.
 *
 * Карточные данные через сервер платформы не проходят: hold может вернуть ссылку на страницу провайдера.
 * Деньги клиентов не проходят через счета ТОО: hold резервирует деньги в банке, а не на балансе платформы.
 */

export type PaymentProviderName = "mock" | "manual" | "freedompay";

export type ProviderResult =
  | { status: "SUCCEEDED"; externalRef: string }
  /** Ждём банк: вебхук, подтверждение оператора (manual) или getStatus. redirectUrl — страница оплаты провайдера. */
  | { status: "PENDING"; externalRef?: string; redirectUrl?: string }
  | { status: "FAILED"; error: string };

type Base = {
  dealId: string;
  /** Ключ операции журнала: `hold:<dealId>`, `split-master:<dealId>`… Тот же ключ — та же операция. */
  idempotencyKey: string;
  amountTiyn: bigint;
};

export type HoldRequest = Base & {
  /** Назначение платежа без персональных данных: «Сделка №17». */
  description: string;
  /** Куда вернуть покупателя со страницы оплаты провайдера. */
  returnUrl: string;
};

export type ReleaseRequest = Base;

export type PayoutRecipient = {
  /** Расшифрованный IBAN мастера: только для передачи провайдеру, в журнал и логи не пишется. */
  iban: string | null;
  name: string;
};

export type SplitRequest = {
  dealId: string;
  master: Base & { recipient: PayoutRecipient };
  platform: Base;
};

export type RefundRequest = Base & { reason: string };

export type StatusRequest = { idempotencyKey: string; externalRef: string | null };

export type WebhookInput = { headers: Headers; body: string };

export type WebhookResult =
  /** Провайдер сообщил итог операции журнала; responseBody — ответ, которого ждёт провайдер (подписанный, если нужно). */
  | { kind: "settled"; externalEventId: string; idempotencyKey: string; result: ProviderResult; response: WebhookResponse }
  /** Подпись верна, но событие нам не нужно (неизвестная операция, служебный пинг). */
  | { kind: "ignored"; externalEventId: string | null; reason: string; response: WebhookResponse }
  /** Подпись неверна или тело не разобрать — 4xx, событие не сохраняем. */
  | { kind: "rejected"; reason: string };

export type WebhookResponse = { status: number; contentType: string; body: string };

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** Тестовые деньги: интерфейс честно помечает операции «тестовый платёж». */
  readonly isTest: boolean;
  hold(request: HoldRequest): Promise<ProviderResult>;
  release(request: ReleaseRequest): Promise<ProviderResult>;
  split(request: SplitRequest): Promise<{ master: ProviderResult; platform: ProviderResult }>;
  refund(request: RefundRequest): Promise<ProviderResult>;
  getStatus(request: StatusRequest): Promise<ProviderResult>;
  handleWebhook(input: WebhookInput): Promise<WebhookResult>;
}
