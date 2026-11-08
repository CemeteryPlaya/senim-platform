package internal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CemeteryPlaya/senim-platform/pkg/config"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/inbox"
	"github.com/CemeteryPlaya/senim-platform/pkg/logging"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/pkg/server"
	"github.com/CemeteryPlaya/senim-platform/services/identity"
)

const usage = "использование: identity serve | identity migrate | identity healthcheck"

// healthcheckTimeout — сколько ждать ответа пробы; docker compose сам ограничивает проверку сверху.
const healthcheckTimeout = 3 * time.Second

// Main выполняет команду и возвращает код выхода процесса. Ошибки пишутся в stderr
// через логгер; значения секретов в них не попадают.
func Main(ctx context.Context, args []string, src config.Source, stderr io.Writer) int {
	log := logging.New(stderr, Service, slog.LevelInfo)
	if len(args) != 1 {
		log.Error(usage)
		return 2
	}
	var err error
	switch args[0] {
	case "serve":
		err = Serve(ctx, src, log)
	case "migrate":
		err = Migrate(ctx, src, log)
	case "healthcheck":
		err = Healthcheck(ctx, src)
	default:
		log.Error(usage, "command", args[0])
		return 2
	}
	if err != nil {
		log.Error("identity: сбой", "command", args[0], "err", err)
		return 1
	}
	return 0
}

// Migrate применяет миграции сервиса ролью владельца базы.
func Migrate(ctx context.Context, src config.Source, log *slog.Logger) error {
	cfg, err := LoadMigrate(src)
	if err != nil {
		return err
	}
	migrations, err := identity.Migrations()
	if err != nil {
		return fmt.Errorf("миграции: %w", err)
	}
	if err := dbx.Migrate(ctx, cfg.OwnerDSN, Service, migrations, outbox.Schema, inbox.Schema); err != nil {
		return err
	}
	log.Info("миграции применены")
	return nil
}

// Healthcheck спрашивает /readyz у работающего в том же контейнере serve. Это healthcheck
// docker compose: в образе distroless нет оболочки и curl, проверку выполняет сам бинарник.
func Healthcheck(ctx context.Context, src config.Source) error {
	cfg, err := LoadHealthcheck(src)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, healthcheckTimeout)
	defer cancel()
	return server.CheckReady(ctx, cfg.ProbeAddr)
}

// Serve запускает gRPC (mTLS), пробы и релей outbox; возвращается после остановки.
func Serve(ctx context.Context, src config.Source, log *slog.Logger) error {
	cfg, err := LoadServe(src)
	if err != nil {
		return err
	}
	shutdownTelemetry, err := server.InitTelemetry(ctx, Service, cfg.OTLP)
	if err != nil {
		return err
	}
	defer func() { _ = shutdownTelemetry(context.WithoutCancel(ctx)) }()

	pool, err := dbx.Connect(ctx, cfg.AppDSN, Service)
	if err != nil {
		return err
	}
	defer pool.Close()

	nc, err := nats.Connect(cfg.NATSURL, nats.Name(Service), nats.MaxReconnects(-1))
	if err != nil {
		return fmt.Errorf("nats: подключение: %w", err)
	}
	defer nc.Close()
	js, err := jetstream.New(nc)
	if err != nil {
		return fmt.Errorf("nats: jetstream: %w", err)
	}
	if _, err := outbox.EnsureStream(ctx, js, Service); err != nil {
		return err
	}

	relayCtx, stopRelay := context.WithCancel(ctx)
	relayDone := make(chan error, 1)
	go func() { relayDone <- outbox.NewRelay(pool, js, log).Run(relayCtx) }()

	ready := func(ctx context.Context) error {
		if nc.Status() != nats.CONNECTED {
			return errors.New("nats: нет соединения")
		}
		return pool.Ping(ctx)
	}
	runErr := server.Run(ctx, server.Options{
		Name:      Service,
		GRPCAddr:  cfg.GRPCAddr,
		ProbeAddr: cfg.ProbeAddr,
		CertFile:  cfg.CertFile,
		KeyFile:   cfg.KeyFile,
		CAFile:    cfg.CAFile,
		Logger:    log,
		Services:  []string{ServiceName},
	}, func(*connect.Server) error { return nil }, ready)

	stopRelay()
	return errors.Join(runErr, <-relayDone)
}
