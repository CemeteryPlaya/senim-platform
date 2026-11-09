package internal

import (
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
)

// Service — обработчики gRPC IdentityService. Методы, которых здесь ещё нет, отвечают
// Unimplemented (их добавляют следующие задачи плана).
type Service struct {
	identityv1connect.UnimplementedIdentityServiceHandler

	pool   *pgxpool.Pool
	cfg    ServeConfig
	sender OtpSender
	now    func() time.Time // часы: в тестах подменяются
	log    *slog.Logger
}

// NewService собирает сервис с настоящими часами.
func NewService(pool *pgxpool.Pool, cfg ServeConfig, sender OtpSender, log *slog.Logger) *Service {
	return &Service{pool: pool, cfg: cfg, sender: sender, now: time.Now, log: log}
}
