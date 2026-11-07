package outbox

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

const (
	batchSize      = 100
	idleDelay      = 200 * time.Millisecond
	errorDelay     = time.Second
	batchTimeout   = 60 * time.Second
	publishTimeout = 5 * time.Second
	// maxLastError — длина last_error в строке outbox.
	maxLastError = 1000
)

// errSimulatedCrash — только для теста падения релея (export_test.go).
var errSimulatedCrash = errors.New("outbox: имитация падения после публикации")

// Relay публикует неотправленные записи outbox в JetStream.
//
// Батч: в одной транзакции SELECT ... FOR UPDATE SKIP LOCKED (до 100 записей, у
// которых наступил next_attempt_at, по порядку id), публикация каждой с
// Nats-Msg-Id = event_id с ожиданием подтверждения, затем published_at = now() и
// коммит. Несколько релеев (реплики сервиса) берут разные записи благодаря SKIP
// LOCKED. Падение между публикацией и коммитом даёт повторную публикацию, которую
// поток отбросит по Nats-Msg-Id.
//
// Ошибка публикации одной записи (нет потока, слишком большое сообщение, поток
// удалён) не останавливает остальные: у записи растут attempts, пишется last_error,
// next_attempt_at сдвигается на min(2^attempts с, 5 мин), в лог уходит Error.
// Если же недоступен сам NATS (соединение закрыто или разорвано) или истёк ctx —
// батч откатывается целиком, попытки не тратятся.
type Relay struct {
	pool *pgxpool.Pool
	js   jetstream.JetStream
	log  *slog.Logger

	crashAfterPublish bool // тестовый хук: вернуть ошибку до отметки published_at
}

// NewRelay создаёт релей; log == nil — slog.Default().
func NewRelay(pool *pgxpool.Pool, js jetstream.JetStream, log *slog.Logger) *Relay {
	if log == nil {
		log = slog.Default()
	}
	return &Relay{pool: pool, js: js, log: log}
}

// Run публикует записи, пока ctx не отменён; при пустой очереди ждёт 200 мс, при
// ошибке батча пишет её в лог и повторяет через 1 с. Возвращает nil после отмены ctx.
func (r *Relay) Run(ctx context.Context) error {
	for {
		n, err := r.publishBatch(ctx)
		if ctx.Err() != nil {
			return nil
		}
		delay := time.Duration(0)
		switch {
		case err != nil:
			r.log.ErrorContext(ctx, "outbox: батч не опубликован", slog.Any("err", err))
			delay = errorDelay
		case n == 0:
			delay = idleDelay
		}
		if delay > 0 {
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(delay):
			}
		}
	}
}

type row struct {
	id      string
	subject string
	env     []byte
}

type failure struct {
	row
	err error
}

// publishBatch обрабатывает один батч и возвращает число записей, взятых из
// очереди (опубликованных и отложенных после ошибки).
func (r *Relay) publishBatch(ctx context.Context) (n int, err error) {
	ctx, cancel := context.WithTimeout(ctx, batchTimeout)
	defer cancel()

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("outbox: begin: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()

	rows, err := tx.Query(ctx, `SELECT id::text, subject, envelope FROM outbox
		WHERE published_at IS NULL AND next_attempt_at <= now()
		ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, batchSize)
	if err != nil {
		return 0, fmt.Errorf("outbox: выборка: %w", err)
	}
	batch, err := pgx.CollectRows(rows, func(rr pgx.CollectableRow) (row, error) {
		var x row
		return x, rr.Scan(&x.id, &x.subject, &x.env)
	})
	if err != nil {
		return 0, fmt.Errorf("outbox: выборка: %w", err)
	}
	if len(batch) == 0 {
		return 0, tx.Commit(ctx)
	}

	published := make([]string, 0, len(batch))
	var failed []failure
	for _, x := range batch {
		perr := r.publish(ctx, x)
		if perr == nil {
			published = append(published, x.id)
			continue
		}
		if r.unavailable(ctx, perr) {
			return 0, perr
		}
		failed = append(failed, failure{row: x, err: perr})
	}
	if r.crashAfterPublish {
		return 0, errSimulatedCrash
	}

	if len(published) > 0 {
		tag, err := tx.Exec(ctx, `UPDATE outbox SET published_at = now() WHERE id = ANY($1::uuid[])`, published)
		if err != nil {
			return 0, fmt.Errorf("outbox: отметка: %w", err)
		}
		if tag.RowsAffected() != int64(len(published)) {
			return 0, fmt.Errorf("outbox: отмечено %d из %d", tag.RowsAffected(), len(published))
		}
	}
	attempts := make([]int, len(failed))
	for i, f := range failed {
		msg := f.err.Error()
		if len(msg) > maxLastError {
			msg = msg[:maxLastError]
		}
		// Сдвиг считается от attempts до увеличения: 1 с, 2 с, 4 с ... до 5 мин;
		// степень ограничена, чтобы interval не переполнился.
		if err := tx.QueryRow(ctx, `UPDATE outbox SET
				attempts = attempts + 1,
				last_error = $2,
				next_attempt_at = now() + least(power(2, least(attempts, 9)) * interval '1 second', interval '5 minutes')
			WHERE id = $1 RETURNING attempts`, f.id, msg).Scan(&attempts[i]); err != nil {
			return 0, fmt.Errorf("outbox: отметка ошибки %s: %w", f.id, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("outbox: commit: %w", err)
	}
	// Лог после коммита: attempts в нём уже сохранены.
	for i, f := range failed {
		r.log.ErrorContext(ctx, "outbox: событие не опубликовано, повтор отложен",
			slog.String("event_id", f.id), slog.String("subject", f.subject),
			slog.Int("attempts", attempts[i]), slog.Any("err", f.err))
	}
	return len(batch), nil
}

// unavailable — ошибка не про запись, а про доступность NATS или конец ctx:
// батч откатывается целиком, попытки записей не тратятся.
func (r *Relay) unavailable(ctx context.Context, err error) bool {
	if ctx.Err() != nil {
		return true
	}
	if errors.Is(err, nats.ErrConnectionClosed) || errors.Is(err, nats.ErrDisconnected) ||
		errors.Is(err, nats.ErrConnectionDraining) || errors.Is(err, nats.ErrConnectionReconnecting) {
		return true
	}
	return !r.js.Conn().IsConnected()
}

func (r *Relay) publish(ctx context.Context, x row) error {
	ctx, cancel := context.WithTimeout(ctx, publishTimeout)
	defer cancel()
	msg := &nats.Msg{Subject: x.subject, Data: x.env, Header: nats.Header{}}
	msg.Header.Set(jetstream.MsgIDHeader, x.id)
	ack, err := r.js.PublishMsg(ctx, msg)
	if err != nil {
		return fmt.Errorf("outbox: публикация %s в %s: %w", x.id, x.subject, err)
	}
	if ack.Duplicate {
		r.log.DebugContext(ctx, "outbox: поток отбросил повтор по Nats-Msg-Id",
			slog.String("event_id", x.id), slog.String("stream", ack.Stream))
	}
	return nil
}
