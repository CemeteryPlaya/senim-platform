package internal

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel"

	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/config"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/idem"
	"github.com/CemeteryPlaya/senim-platform/pkg/inbox"
	"github.com/CemeteryPlaya/senim-platform/pkg/logging"
	"github.com/CemeteryPlaya/senim-platform/pkg/natsx"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/pkg/server"
	"github.com/CemeteryPlaya/senim-platform/services/identity"
)

const usage = "использование: identity serve | identity migrate | identity healthcheck | identity mfa-reset --phone <E.164>"

// healthcheckTimeout — сколько ждать ответа пробы; docker compose сам ограничивает проверку сверху.
const healthcheckTimeout = 3 * time.Second

// mfaResetTimeout — предел подключения к базе и транзакции identity mfa-reset: ни одного
// вызова без дедлайна.
const mfaResetTimeout = 30 * time.Second

// Main выполняет команду и возвращает код выхода процесса. Ошибки пишутся в stderr
// через логгер; значения секретов в них не попадают.
func Main(ctx context.Context, args []string, src config.Source, stderr io.Writer) int {
	log := logging.New(stderr, ServiceID, slog.LevelInfo)
	if len(args) == 0 || (args[0] != "mfa-reset" && len(args) != 1) {
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
	case "mfa-reset":
		err = MfaReset(ctx, src, log, args[1:])
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
	if err := dbx.Migrate(ctx, cfg.OwnerDSN, ServiceID, migrations, outbox.Schema, inbox.Schema, idem.Schema); err != nil {
		return err
	}
	log.Info("миграции применены")
	return nil
}

// MfaReset — подкоманда «identity mfa-reset --phone <E.164>»: владелец сбрасывает второй
// фактор оператора (потерян телефон). Удаляет фактор, снимает отметку второго фактора со
// всех сессий пользователя, пишет MfaReset и аудит (actor_kind "cli") в одной транзакции.
// После сброса оператор подключает TOTP заново при следующем входе. Работает рабочей
// ролью (IDENTITY_APP_DSN); телефон в лог не пишется.
func MfaReset(ctx context.Context, src config.Source, log *slog.Logger, args []string) error {
	fs := flag.NewFlagSet("mfa-reset", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	rawPhone := fs.String("phone", "", "телефон оператора в E.164")
	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("mfa-reset: %w", err)
	}
	if fs.NArg() != 0 {
		return errors.New("mfa-reset: лишние аргументы")
	}
	phone, ok := parsePhone(*rawPhone)
	if !ok {
		return errors.New("mfa-reset: --phone: нужен мобильный номер РК (+77001234567)")
	}
	cfg, err := LoadMfaReset(src)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, mfaResetTimeout)
	defer cancel()
	pool, err := dbx.Connect(ctx, cfg.AppDSN, ServiceID, 1)
	if err != nil {
		return err
	}
	defer pool.Close()
	userID, err := resetMfa(ctx, pool, phone, time.Now())
	if err != nil {
		return err
	}
	log.Info("второй фактор сброшен", "user_id", userID.String())
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

// newSender выбирает отправителя кодов по IDENTITY_OTP_PROVIDER. Конфиг уже проверил значение,
// но неизвестное не должно молча превратиться в мок.
func newSender(provider string, log *slog.Logger) (OtpSender, error) {
	switch provider {
	case "mock":
		return mockSender{log: log}, nil
	default:
		return nil, fmt.Errorf("IDENTITY_OTP_PROVIDER: нет отправителя для %q", provider)
	}
}

// Serve запускает gRPC (mTLS), пробы и релей outbox; возвращается после остановки.
//
// Кто может звать методы IdentityService (каждый обработчик проверяет это первой строкой через
// requireCaller; тест TestCallerPolicyCoversEveryRPC обходит все RPC дескриптора):
//
//	RequestOtp, VerifyOtp, Authenticate, SignOut, SignOutEverywhere,
//	SwitchRole, GrantRole, StartDemoSession, SeedUsers, ResetDemo,
//	StartTotpEnrollment, ConfirmTotpEnrollment, VerifySecondFactor,
//	RecordPerson, UpdateContacts, GetProfile                       — только web
//	GetSigningKeys                                                 — Go-сервисы из tools/services
//
// Новый RPC без решения в этой таблице и в тесте не принимается.
func Serve(ctx context.Context, src config.Source, log *slog.Logger) error {
	cfg, err := LoadServe(src)
	if err != nil {
		return err
	}
	shutdownTelemetry, err := server.InitTelemetry(ctx, ServiceID, cfg.OTLP)
	if err != nil {
		return err
	}
	defer func() { _ = shutdownTelemetry(context.WithoutCancel(ctx)) }()

	sender, err := newSender(cfg.OTPProvider, log)
	if err != nil {
		return err
	}
	pool, err := dbx.Connect(ctx, cfg.AppDSN, ServiceID, cfg.PoolMaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	nc, err := natsx.Connect(cfg.NATS, ServiceID, log)
	if err != nil {
		return err
	}
	defer nc.Close()
	js, err := jetstream.New(nc)
	if err != nil {
		return fmt.Errorf("nats: jetstream: %w", err)
	}
	if _, err := outbox.EnsureStream(ctx, js, ServiceID); err != nil {
		return err
	}

	relayCtx, stopRelay := context.WithCancel(ctx)
	relayDone := make(chan error, 1)
	go func() { relayDone <- outbox.NewRelay(pool, js, log).Run(relayCtx) }()

	// Отставание outbox — метрики senim.outbox.* (алерт «события не уходят»).
	unobserve, err := outbox.ObserveBacklog(pool, otel.Meter("github.com/CemeteryPlaya/senim-platform/pkg/outbox"))
	if err != nil {
		stopRelay()
		return errors.Join(err, <-relayDone)
	}
	defer func() { _ = unobserve() }()

	// Очистка по срокам хранения: первый раз через период после старта; ошибки в лог.
	metrics, err := newRetentionMetrics(otel.Meter("github.com/CemeteryPlaya/senim-platform/services/identity"))
	if err != nil {
		stopRelay()
		return errors.Join(err, <-relayDone)
	}
	retentionCtx, stopRetention := context.WithCancel(ctx)
	retentionDone := make(chan struct{})
	go func() {
		defer close(retentionDone)
		retentionLoop(retentionCtx, pool, cfg.Retention, metrics, log)
	}()
	defer func() { stopRetention(); <-retentionDone }()

	// Готовность — только база. NATS для синхронного пути не нужен: события копятся в
	// outbox и уходят, когда NATS вернётся; потеря и возврат соединения — в лог (natsx),
	// отставание — в метриках (правило ready — в документации server.Run).
	ready := func(ctx context.Context) error { return pool.Ping(ctx) }
	runErr := server.Run(ctx, server.Options{
		Name:      ServiceID,
		GRPCAddr:  cfg.GRPCAddr,
		ProbeAddr: cfg.ProbeAddr,
		CertFile:  cfg.CertFile,
		KeyFile:   cfg.KeyFile,
		CAFile:    cfg.CAFile,
		Logger:    log,
		Services:  []string{ServiceName},
		// Только mesh (за ним — вызывающий из XFCC) и свои реплики; web и другие сервисы
		// напрямую не допускаются (ADR-011).
		AllowedPeers: []string{server.MeshPeer, ServiceID},
	}, func(s *connect.Server) error {
		identityv1connect.RegisterIdentityServiceHandler(s, NewService(pool, cfg, sender, log))
		return nil
	}, ready)

	stopRelay()
	return errors.Join(runErr, <-relayDone)
}
