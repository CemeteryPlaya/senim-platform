// Package inbox — обработка событий JetStream ровно один раз на получателя.
//
// Порядок событий не гарантирован (см. pkg/outbox): обработчик сверяет статус или
// версию агрегата, а не полагается на очередность.
//
// JetStream доставляет «хотя бы один раз»: после сбоя Ack, истечения AckWait или
// повторной публикации то же событие приходит снова. Handle записывает
// (consumer, event_id) в таблицу inbox в одной транзакции с эффектом обработчика:
// повтор видит запись и подтверждается без вызова обработчика, а одновременная
// доставка ждёт на первичном ключе, пока первая не завершится.
//
// # Границы гарантии «ровно один раз»
//
// Ключ дедупликации — (consumer, event_id), без источника. Это безопасно, потому что
// event_id — UUIDv7 из outbox.Add, а источник проверен до записи: Handle делает Term,
// если источник конверта не совпадает с источником субъекта senim.<source>.… или
// сообщение пришло не из потока SENIM_<SOURCE>, а
// публиковать в senim.<source>.> NATS разрешает только учётной записи <source>
// (ADR-012). Без этих двух условий чужое событие с известным event_id могло бы занять
// ключ раньше настоящего, и настоящее было бы молча подтверждено без обработки.
//
// Порядок сроков хранения (задача очистки — план 2) обязателен:
//
//	срок хранения inbox ≥ MaxAge потока + наибольшая задержка повторной публикации релея
//
// Повтор события, пришедший после удаления его записи inbox, обработается второй раз.
// Повторы бывают в течение всего MaxAge потока (переподписка, сброс консьюмера) и сверх
// него — когда релей публикует запись заново после падения позже окна дедупликации
// потока (outbox.DuplicateWindow, 2 ч): поток такую копию уже не отбросит. Очищать
// inbox раньше нельзя; удалять записи — ролью владельца (app-роль inbox только читает и
// дописывает).
//
// Ровно один раз — только для того, что обработчик пишет через tx. Побочные эффекты
// вне транзакции (SMS, Telegram, письмо, вызов другого сервиса или провайдера) — «хотя
// бы один раз»: при сбое коммита или Ack событие придёт снова и эффект повторится.
// Такие эффекты делают идемпотентными сами (idempotency_key = event_id у вызываемого
// сервиса или провайдера) или откладывают через outbox этого же сервиса.
package inbox

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel/propagation"
	"google.golang.org/protobuf/proto"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
)

// Schema — таблица inbox. Идемпотентна; сервис передаёт её в dbx.Migrate.
// Таблица append-only: рабочая роль получает только SELECT и INSERT.
const Schema = `-- senim:append-only inbox
CREATE TABLE IF NOT EXISTS inbox (
  consumer     text        NOT NULL,
  event_id     text        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
`

const (
	handleTimeout = 30 * time.Second
	minNakDelay   = time.Second
	maxNakDelay   = time.Minute
)

// Handler — обработчик события: всё, что он пишет через tx, коммитится вместе с
// записью inbox. ctx содержит контекст трассировки из envelope.trace_parent.
type Handler func(ctx context.Context, tx pgx.Tx, env *eventsv1.Envelope) error

// Handle обрабатывает сообщение ровно один раз для consumer.
//
// В одной транзакции: INSERT в inbox ... ON CONFLICT DO NOTHING; запись уже была —
// Ack без вызова fn; иначе fn, коммит, Ack. Ошибка fn или коммита — откат и
// NakWithDelay (1 с, 2 с, 4 с ... до 1 мин по числу доставок); возвращается ошибка.
// Конверт, который не разбирается, без event_id, с источником, не совпадающим с
// субъектом senim.<source>.…, или сообщение не из потока SENIM_<SOURCE> повтор не
// исправит — Term без вызова fn.
// Если у ctx нет дедлайна, ставится 30 с.
func Handle(ctx context.Context, pool *pgxpool.Pool, consumer string, msg jetstream.Msg, fn Handler) error {
	if consumer == "" {
		return errors.New("inbox: пустое имя получателя")
	}
	env := &eventsv1.Envelope{}
	if err := proto.Unmarshal(msg.Data(), env); err != nil {
		_ = msg.TermWithReason("inbox: envelope не разбирается")
		return fmt.Errorf("inbox: разбор envelope (%s): %w", msg.Subject(), err)
	}
	if env.GetEventId() == "" {
		_ = msg.TermWithReason("inbox: envelope без event_id")
		return fmt.Errorf("inbox: envelope без event_id (%s)", msg.Subject())
	}
	// За источник субъекта ручается NATS (публиковать в senim.<source>.> может только
	// учётная запись <source>, ADR-012); источник в конверте пишет сам публикатор. Не
	// совпали — подделка или ошибка, повтор не исправит: Term без обработчика.
	src, ok := outbox.SourceOf(msg.Subject())
	if !ok || env.GetSource() != src {
		_ = msg.TermWithReason("inbox: источник конверта не совпадает с субъектом")
		return fmt.Errorf("inbox: источник конверта %q не совпадает с субъектом %s (event_id %s)",
			env.GetSource(), msg.Subject(), env.GetEventId())
	}
	// Субъект источника — ещё не доказательство: каждый сервис может менять конфиг своего
	// потока (STREAM.UPDATE, ADR-012) и сложить в него чужие субъекты (subject_transform,
	// sources). Событие источника src принимается только из его потока SENIM_<SRC>.
	if md, err := msg.Metadata(); err != nil || md.Stream != outbox.StreamName(src) {
		_ = msg.TermWithReason("inbox: событие не из потока своего источника")
		return fmt.Errorf("inbox: событие %s (%s) не из потока %s", env.GetEventId(), msg.Subject(), outbox.StreamName(src))
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, handleTimeout)
		defer cancel()
	}
	if tp := env.GetTraceParent(); tp != "" {
		ctx = propagation.TraceContext{}.Extract(ctx, propagation.MapCarrier{"traceparent": tp})
	}

	fresh, err := process(ctx, pool, consumer, env, fn)
	if err != nil {
		if nakErr := msg.NakWithDelay(nakDelay(msg)); nakErr != nil {
			return errors.Join(err, fmt.Errorf("inbox: nak: %w", nakErr))
		}
		return err
	}
	// Ack после коммита: если он потеряется, повтор увидит запись inbox.
	if err := msg.Ack(); err != nil {
		return fmt.Errorf("inbox: ack %s (обработано=%v): %w", env.GetEventId(), fresh, err)
	}
	return nil
}

// process возвращает fresh=false, если событие уже обработано этим получателем.
func process(ctx context.Context, pool *pgxpool.Pool, consumer string, env *eventsv1.Envelope, fn Handler) (fresh bool, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("inbox: begin: %w", err)
	}
	// После Commit откат — no-op; при панике fn транзакция тоже откатывается.
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	tag, err := tx.Exec(ctx,
		`INSERT INTO inbox (consumer, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		consumer, env.GetEventId())
	if err != nil {
		return false, fmt.Errorf("inbox: запись: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	if err := fn(ctx, tx, env); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("inbox: commit: %w", err)
	}
	return true, nil
}

func nakDelay(msg jetstream.Msg) time.Duration {
	md, err := msg.Metadata()
	if err != nil || md.NumDelivered <= 1 {
		return minNakDelay
	}
	d := minNakDelay
	for i := uint64(1); i < md.NumDelivered && d < maxNakDelay; i++ {
		d *= 2
	}
	return min(d, maxNakDelay)
}
