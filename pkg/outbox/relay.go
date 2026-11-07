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
)

// errSimulatedCrash — только для теста падения релея (export_test.go).
var errSimulatedCrash = errors.New("outbox: имитация падения после публикации")

// Relay публикует неотправленные записи outbox в JetStream.
//
// Батч: в одной транзакции SELECT ... FOR UPDATE SKIP LOCKED (до 100 записей по
// порядку id), публикация каждой с Nats-Msg-Id = event_id с ожиданием
// подтверждения, затем published_at = now() и коммит. Ошибка публикации — откат,
// записи останутся неотправленными. Падение между публикацией и коммитом даёт
// повторную публикацию, которую поток отбросит по Nats-Msg-Id. Несколько релеев
// (реплики сервиса) берут разные записи благодаря SKIP LOCKED.
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
// ошибке пишет её в лог и повторяет через 1 с. Возвращает nil после отмены ctx.
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

// publishBatch публикует один батч и возвращает число отмеченных записей.
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
		WHERE published_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, batchSize)
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

	ids := make([]string, 0, len(batch))
	for _, x := range batch {
		if err := r.publish(ctx, x); err != nil {
			return 0, err
		}
		ids = append(ids, x.id)
	}
	if r.crashAfterPublish {
		return 0, errSimulatedCrash
	}
	tag, err := tx.Exec(ctx, `UPDATE outbox SET published_at = now() WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return 0, fmt.Errorf("outbox: отметка: %w", err)
	}
	if tag.RowsAffected() != int64(len(ids)) {
		return 0, fmt.Errorf("outbox: отмечено %d из %d", tag.RowsAffected(), len(ids))
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("outbox: commit: %w", err)
	}
	return len(ids), nil
}

func (r *Relay) publish(ctx context.Context, x row) error {
	ctx, cancel := context.WithTimeout(ctx, publishTimeout)
	defer cancel()
	msg := &nats.Msg{Subject: x.subject, Data: x.env, Header: nats.Header{}}
	msg.Header.Set(jetstream.MsgIDHeader, x.id)
	if _, err := r.js.PublishMsg(ctx, msg); err != nil {
		return fmt.Errorf("outbox: публикация %s в %s: %w", x.id, x.subject, err)
	}
	return nil
}
