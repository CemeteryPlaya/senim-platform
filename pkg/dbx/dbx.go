// Package dbx — подключение к базе сервиса и транзакции.
//
// Каждый сервис владеет своей базой. Приложение подключается ролью <svc>_app
// (без DDL, TRUNCATE и чужих баз), миграции выполняет <svc>_owner (см. Migrate).
package dbx

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// DefaultMaxConns — размер пула по умолчанию (POOL_MAX_CONNS). pgxpool сам взял бы
// max(4, NumCPU): в контейнере без лимита CPU на 16 потоках это 16 соединений на реплику,
// а 8 сервисов × 2 реплики × 16 больше max_connections = 100 у Postgres.
const DefaultMaxConns = 4

// Connect открывает пул из maxConns соединений с application_name = service и
// трассировкой запросов. Соединение проверяется сразу: ошибка прав на базу
// возвращается отсюда. Тайм-ауты запросов и транзакций рабочей роли задаёт tools/dbinit
// (ALTER ROLE ... SET), а не DSN.
func Connect(ctx context.Context, dsn string, service string, maxConns int32) (*pgxpool.Pool, error) {
	if maxConns <= 0 {
		return nil, fmt.Errorf("dbx: размер пула %d, нужен ≥ 1", maxConns)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("dbx: разбор DSN: %w", err)
	}
	cfg.MaxConns = maxConns
	cfg.ConnConfig.RuntimeParams["application_name"] = service
	cfg.ConnConfig.Tracer = &tracer{tr: otel.Tracer("pkg/dbx")}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("dbx: пул: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("dbx: подключение к %s: %w", service, err)
	}
	return pool, nil
}

// InTx выполняет fn в транзакции: коммит при nil, откат при ошибке и панике.
func InTx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) (err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("dbx: begin: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(context.WithoutCancel(ctx))
			panic(p)
		}
	}()
	if err := fn(tx); err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("dbx: commit: %w", err)
	}
	return nil
}

// tracer создаёт спан на запрос. Текст запроса и аргументы в спан не попадают (ПДн).
type tracer struct{ tr trace.Tracer }

type spanKey struct{}

func (t *tracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	ctx, span := t.tr.Start(ctx, "db.query", trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(attribute.String("db.system", "postgresql")))
	return context.WithValue(ctx, spanKey{}, span)
}

func (t *tracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	span, ok := ctx.Value(spanKey{}).(trace.Span)
	if !ok {
		return
	}
	if data.Err != nil {
		span.RecordError(data.Err)
		span.SetStatus(codes.Error, "db error")
	}
	span.End()
}
