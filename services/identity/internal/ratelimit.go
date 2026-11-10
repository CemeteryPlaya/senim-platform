package internal

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// limiter — счётчики с фиксированным окном в таблице rate_limits (перенос
// apps/web/src/platform/rate-limit.ts). now — часы сервиса.
type limiter struct{ now func() time.Time }

// hit засчитывает попытку по ключу и сообщает, укладывается ли она в limit за окно window.
// Атомарно: один INSERT ... ON CONFLICT RETURNING. db — пул (отдельная команда, счётчик
// остаётся и при откате вызывающей транзакции) или транзакция.
func (l limiter) hit(ctx context.Context, db store.DBTX, key string, limit int, window time.Duration) (allowed bool, err error) {
	count, err := l.count(ctx, db, key, window)
	if err != nil {
		return false, err
	}
	return count <= limit, nil
}

// count засчитывает попытку по ключу и возвращает число попыток в текущем окне, включая
// эту. Атомарно, как hit.
func (l limiter) count(ctx context.Context, db store.DBTX, key string, window time.Duration) (int, error) {
	count, err := store.New(db).HitRateLimit(ctx, store.HitRateLimitParams{
		Key:        key,
		Now:        pgtype.Timestamptz{Time: l.now(), Valid: true},
		WindowSecs: window.Seconds(),
	})
	if err != nil {
		return 0, fmt.Errorf("счётчик лимита: %w", err)
	}
	return int(count), nil
}
