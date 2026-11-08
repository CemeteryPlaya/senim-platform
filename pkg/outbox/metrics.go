package outbox

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/metric"
)

// Имена метрик отставания outbox. По ним строится алерт «события не уходят» — вместо
// снятия готовности при сбое NATS (готовность сервиса — только база, см. server.Run).
const (
	MetricPending   = "senim.outbox.pending"    // неопубликованных записей
	MetricOldestAge = "senim.outbox.oldest_age" // возраст самой старой неопубликованной записи, с
)

const backlogQueryTimeout = 2 * time.Second

// Backlog — неопубликованные записи outbox: число и возраст самой старой.
type Backlog struct {
	Pending   int64
	OldestAge time.Duration
}

// ReadBacklog читает отставание outbox (частичный индекс по published_at IS NULL).
func ReadBacklog(ctx context.Context, pool *pgxpool.Pool) (Backlog, error) {
	var b Backlog
	var ageSec float64
	err := pool.QueryRow(ctx, `SELECT count(*), coalesce(extract(epoch FROM now() - min(created_at)), 0)::float8
		FROM outbox WHERE published_at IS NULL`).Scan(&b.Pending, &ageSec)
	if err != nil {
		return Backlog{}, fmt.Errorf("outbox: отставание: %w", err)
	}
	b.OldestAge = time.Duration(ageSec * float64(time.Second))
	return b, nil
}

// ObserveBacklog регистрирует наблюдаемые метрики MetricPending и MetricOldestAge на
// meter: значения читаются из базы при каждом сборе метрик (раз в интервал экспорта).
// Возвращает функцию снятия регистрации.
func ObserveBacklog(pool *pgxpool.Pool, meter metric.Meter) (unregister func() error, err error) {
	pending, err := meter.Int64ObservableGauge(MetricPending,
		metric.WithDescription("Неопубликованные записи outbox"), metric.WithUnit("{event}"))
	if err != nil {
		return nil, fmt.Errorf("outbox: метрика %s: %w", MetricPending, err)
	}
	age, err := meter.Float64ObservableGauge(MetricOldestAge,
		metric.WithDescription("Возраст самой старой неопубликованной записи outbox"), metric.WithUnit("s"))
	if err != nil {
		return nil, fmt.Errorf("outbox: метрика %s: %w", MetricOldestAge, err)
	}
	reg, err := meter.RegisterCallback(func(ctx context.Context, o metric.Observer) error {
		ctx, cancel := context.WithTimeout(ctx, backlogQueryTimeout)
		defer cancel()
		b, err := ReadBacklog(ctx, pool)
		if err != nil {
			return err
		}
		o.ObserveInt64(pending, b.Pending)
		o.ObserveFloat64(age, b.OldestAge.Seconds())
		return nil
	}, pending, age)
	if err != nil {
		return nil, fmt.Errorf("outbox: регистрация метрик: %w", err)
	}
	return reg.Unregister, nil
}
