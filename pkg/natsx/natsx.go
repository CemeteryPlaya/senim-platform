// Package natsx — подключение сервиса к NATS JetStream по правилам платформы (ADR-012):
// своя учётная запись (NATS_USER / NATS_PASSWORD), TLS с клиентским сертификатом
// сервиса, свой префикс ответов, бесконечные переподключения и запись смены состояния
// соединения в лог.
//
// Права учётной записи задаёт конфиг сервера (tools/natsconf → deploy/compose/nats):
// публикация только в senim.<service>.> и в API JetStream своего потока, подписка — только
// на свой префикс ответов InboxPrefix(service) и на то, что сервис получает.
package natsx

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/CemeteryPlaya/senim-platform/pkg/config"
	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
)

// minPasswordBytes — пароль NATS вне dev: base64 не короче 32 байт после декодирования
// (как остальные секреты, pkg/config). Серверу передаётся строка как есть.
const minPasswordBytes = 32

// Config — подключение сервиса к NATS.
type Config struct {
	URL      string // tls://nats:4222 (вне dev обязательно), nats:// — только dev
	User     string
	Password string
	CertFile string // клиентский сертификат и ключ — те же, что у gRPC сервиса (TLS_*)
	KeyFile  string
	CAFile   string
}

// Load читает NATS_URL, NATS_USER и NATS_PASSWORD. certFile, keyFile и caFile — файлы
// mTLS сервиса: тот же сертификат служит клиентским для NATS.
//
// Вне dev: каждый адрес в NATS_URL — tls://, NATS_USER и NATS_PASSWORD обязательны
// (пароль — секрет: base64, ≥ 32 байт). В dev допустимы nats:// и вход без учётной
// записи (тесты на голом NATS); если NATS_USER задан, пароль обязателен.
func Load(l *config.Loader, certFile, keyFile, caFile string) Config {
	c := Config{
		URL:      l.Required("NATS_URL"),
		User:     l.String("NATS_USER", ""),
		CertFile: certFile,
		KeyFile:  keyFile,
		CAFile:   caFile,
	}
	strict := l.Env() != config.Dev
	if strict {
		for _, u := range strings.Split(c.URL, ",") {
			if p, err := url.Parse(strings.TrimSpace(u)); err != nil || p.Scheme != "tls" {
				l.Invalid("NATS_URL", "must use tls:// when APP_ENV is not dev")
				break
			}
		}
		if c.User == "" {
			l.Required("NATS_USER")
		}
		if l.Secret("NATS_PASSWORD", minPasswordBytes) != nil {
			c.Password = l.String("NATS_PASSWORD", "")
		}
		return c
	}
	if c.User != "" {
		c.Password = l.Required("NATS_PASSWORD")
	}
	return c
}

// InboxPrefix — префикс ответов JetStream API и подтверждений публикации для service.
// У каждой учётной записи свой: подписка на чужие ответы ей не разрешена.
func InboxPrefix(service string) string { return "_INBOX_" + service }

// Connect подключает service к NATS: имя соединения = service, переподключения без
// предела, свой InboxPrefix, учётная запись из cfg и TLS 1.3 с клиентским сертификатом
// для tls://. Потеря и восстановление соединения, закрытие и асинхронные ошибки сервера
// (например, нарушение прав) пишутся в log.
func Connect(cfg Config, service string, log *slog.Logger) (*nats.Conn, error) {
	if service == "" {
		return nil, errors.New("natsx: пустое имя сервиса")
	}
	if log == nil {
		log = slog.Default()
	}
	opts := []nats.Option{
		nats.Name(service),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(time.Second),
		nats.CustomInboxPrefix(InboxPrefix(service)),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			log.Warn("nats: соединение потеряно, переподключение", slog.Any("err", err))
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Info("nats: соединение восстановлено", slog.String("server", nc.ConnectedUrlRedacted()))
		}),
		nats.ClosedHandler(func(*nats.Conn) { log.Info("nats: соединение закрыто") }),
		nats.ErrorHandler(func(_ *nats.Conn, sub *nats.Subscription, err error) {
			attrs := []any{slog.Any("err", err)}
			if sub != nil {
				attrs = append(attrs, slog.String("subject", sub.Subject))
			}
			log.Error("nats: ошибка сервера", attrs...)
		}),
	}
	if cfg.User != "" {
		opts = append(opts, nats.UserInfo(cfg.User, cfg.Password))
	}
	if usesTLS(cfg.URL) {
		tc, err := tlsx.ClientConfig(cfg.CertFile, cfg.KeyFile, cfg.CAFile)
		if err != nil {
			return nil, fmt.Errorf("natsx: TLS: %w", err)
		}
		tc.NextProtos = nil // ALPN h2 — для gRPC, у NATS своего протокола нет
		opts = append(opts, nats.Secure(tc))
	}
	nc, err := nats.Connect(cfg.URL, opts...)
	if err != nil {
		return nil, fmt.Errorf("natsx: подключение %s: %w", service, err)
	}
	return nc, nil
}

func usesTLS(urls string) bool {
	for _, u := range strings.Split(urls, ",") {
		if strings.HasPrefix(strings.TrimSpace(u), "tls://") {
			return true
		}
	}
	return false
}
