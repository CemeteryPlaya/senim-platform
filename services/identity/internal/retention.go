package internal

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// retentionBatch — сколько строк одна транзакция удаляет за раз: короткие блокировки и
// небольшой WAL; цикл повторяется, пока пачка неполная.
const retentionBatch = 1000

// MetricRetentionDeleted — счётчик строк, удалённых очисткой по срокам хранения;
// атрибут table — имя таблицы.
const MetricRetentionDeleted = "senim.retention.deleted"

// retentionLockKey — ключ pg_try_advisory_lock: хеш FNV-1a от «identity.retention».
// Замок действует в пределах базы identity: две реплики не чистят одновременно.
var retentionLockKey = func() int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte("identity.retention"))
	return int64(h.Sum64()) //nolint:gosec // ключ замка: важен набор битов, не знак
}()

// RetentionConfig — сроки хранения и период запуска очистки.
type RetentionConfig struct {
	// RetainOTP — сколько хранятся коды с момента создания.
	RetainOTP time.Duration
	// RetainSessions — сколько хранится сессия после окончания или отзыва.
	RetainSessions time.Duration
	// RetainRateLimits — сколько хранится окно лимита после начала окна (не меньше суток:
	// суточные счётчики живут сутки).
	RetainRateLimits time.Duration
	// RetainIdempotency — сколько хранятся сохранённые ответы идемпотентности.
	RetainIdempotency time.Duration
	// RetainOutbox — сколько хранятся записи outbox после публикации; неопубликованные не удаляются.
	RetainOutbox time.Duration
	// Every — период запуска очистки.
	Every time.Duration
}

// RetentionResult — сколько строк удалено в каждой таблице. Skipped — очистку ведёт
// другая реплика (замок занят).
type RetentionResult struct {
	OTP, Sessions, RateLimits, Idempotency, Outbox int64
	Skipped                                        bool
}

// Total — всего удалено строк.
func (r RetentionResult) Total() int64 {
	return r.OTP + r.Sessions + r.RateLimits + r.Idempotency + r.Outbox
}

type tableCount struct {
	table string
	n     int64
}

// byTable — удалённое по таблицам для метрики.
func (r RetentionResult) byTable() []tableCount {
	return []tableCount{
		{"otp_codes", r.OTP}, {"sessions", r.Sessions}, {"rate_limits", r.RateLimits},
		{"idempotency", r.Idempotency}, {"outbox", r.Outbox},
	}
}

// retentionStep — очистка одной таблицы: куда писать счёт, граница и запрос одной пачки.
type retentionStep struct {
	name   string
	dst    *int64
	cutoff pgtype.Timestamptz
	del    func(ctx context.Context, q *store.Queries, cutoff pgtype.Timestamptz) (int64, error)
}

// runRetention удаляет устаревшие строки пачками по retentionBatch, каждая пачка в своей
// транзакции, под advisory-замком на выделенном соединении (оно же выполняет пачки:
// пул из одного соединения не зависает). Ошибка одной таблицы не мешает остальным;
// возвращается объединение ошибок и то, что успели удалить.
func runRetention(ctx context.Context, pool *pgxpool.Pool, cfg RetentionConfig, now time.Time) (res RetentionResult, err error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return res, fmt.Errorf("срок хранения: соединение: %w", err)
	}
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, retentionLockKey).Scan(&locked); err != nil {
		conn.Release()
		return res, fmt.Errorf("срок хранения: замок: %w", err)
	}
	if !locked {
		conn.Release()
		res.Skipped = true
		return res, nil
	}
	defer func() {
		// Замок сессионный: отпускаем даже после отмены ctx. Не вышло — соединение
		// закрываем, иначе в пул вернулось бы соединение с чужим замком.
		unlockCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		var released bool
		uerr := conn.QueryRow(unlockCtx, `SELECT pg_advisory_unlock($1)`, retentionLockKey).Scan(&released)
		if uerr != nil || !released {
			_ = conn.Hijack().Close(unlockCtx)
			if uerr != nil {
				err = errors.Join(err, fmt.Errorf("срок хранения: снятие замка: %w", uerr))
			}
			return
		}
		conn.Release()
	}()

	cut := func(retain time.Duration) pgtype.Timestamptz { return ts(now.Add(-retain)) }
	steps := []retentionStep{
		{"otp_codes", &res.OTP, cut(cfg.RetainOTP), func(ctx context.Context, q *store.Queries, c pgtype.Timestamptz) (int64, error) {
			return q.DeleteOldOtpCodes(ctx, store.DeleteOldOtpCodesParams{Cutoff: c, BatchSize: retentionBatch})
		}},
		{"sessions", &res.Sessions, cut(cfg.RetainSessions), func(ctx context.Context, q *store.Queries, c pgtype.Timestamptz) (int64, error) {
			return q.DeleteOldSessions(ctx, store.DeleteOldSessionsParams{Cutoff: c, BatchSize: retentionBatch})
		}},
		{"rate_limits", &res.RateLimits, cut(cfg.RetainRateLimits), func(ctx context.Context, q *store.Queries, c pgtype.Timestamptz) (int64, error) {
			return q.DeleteOldRateLimits(ctx, store.DeleteOldRateLimitsParams{Cutoff: c, BatchSize: retentionBatch})
		}},
		{"idempotency", &res.Idempotency, cut(cfg.RetainIdempotency), func(ctx context.Context, q *store.Queries, c pgtype.Timestamptz) (int64, error) {
			return q.DeleteOldIdempotency(ctx, store.DeleteOldIdempotencyParams{Cutoff: c, BatchSize: retentionBatch})
		}},
		{"outbox", &res.Outbox, cut(cfg.RetainOutbox), func(ctx context.Context, q *store.Queries, c pgtype.Timestamptz) (int64, error) {
			return q.DeleteOldPublishedOutbox(ctx, store.DeleteOldPublishedOutboxParams{Cutoff: c, BatchSize: retentionBatch})
		}},
	}
	var errs []error
	for _, s := range steps {
		for {
			n, derr := deleteBatch(ctx, conn, s)
			*s.dst += n
			if derr != nil {
				errs = append(errs, fmt.Errorf("срок хранения: %s: %w", s.name, derr))
				break
			}
			if n < retentionBatch {
				break
			}
		}
	}
	return res, errors.Join(errs...)
}

// deleteBatch выполняет одну пачку шага в своей транзакции на соединении conn.
func deleteBatch(ctx context.Context, conn *pgxpool.Conn, s retentionStep) (int64, error) {
	tx, err := conn.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, err
	}
	n, err := s.del(ctx, store.New(tx), s.cutoff)
	if err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return n, nil
}

// retentionMetrics — счётчик удалённых строк.
type retentionMetrics struct{ deleted metric.Int64Counter }

func newRetentionMetrics(meter metric.Meter) (retentionMetrics, error) {
	c, err := meter.Int64Counter(MetricRetentionDeleted,
		metric.WithDescription("Строки, удалённые очисткой по срокам хранения"), metric.WithUnit("{row}"))
	if err != nil {
		return retentionMetrics{}, fmt.Errorf("метрика %s: %w", MetricRetentionDeleted, err)
	}
	return retentionMetrics{deleted: c}, nil
}

func (m retentionMetrics) record(ctx context.Context, res RetentionResult) {
	for _, tc := range res.byTable() {
		if tc.n > 0 {
			m.deleted.Add(ctx, tc.n, metric.WithAttributes(attribute.String("table", tc.table)))
		}
	}
}

// retentionLoop запускает очистку каждые cfg.Every, первый раз — через период после старта.
// Возвращается при отмене ctx. Ошибки пишутся в лог и сервис не останавливают.
func retentionLoop(ctx context.Context, pool *pgxpool.Pool, cfg RetentionConfig, m retentionMetrics, log *slog.Logger) {
	ticker := time.NewTicker(cfg.Every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		res, err := runRetention(ctx, pool, cfg, time.Now())
		m.record(context.WithoutCancel(ctx), res)
		if err != nil && ctx.Err() == nil { // при остановке сервиса отменённый запрос ошибкой не считается
			log.Error("срок хранения: очистка не завершена", "err", err)
		}
		if res.Total() > 0 {
			log.Info("срок хранения: удалено",
				"otp_codes", res.OTP, "sessions", res.Sessions, "rate_limits", res.RateLimits,
				"idempotency", res.Idempotency, "outbox", res.Outbox)
		}
	}
}
