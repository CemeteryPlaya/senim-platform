// Package outbox — надёжная отправка событий: запись в таблицу outbox в той же
// транзакции, что и изменение данных, и релей, который публикует записи в NATS
// JetStream.
//
// Гарантии: событие не теряется (запись и данные коммитятся вместе; релей отмечает
// published_at только после подтверждения JetStream) и не дублируется в потоке
// (заголовок Nats-Msg-Id = event_id; окно дедупликации потока — 2 ч). Получатель
// дополнительно защищён inbox (pkg/inbox).
//
// Имена: поток сервиса — SENIM_<SOURCE>, субъекты — senim.<source>.<event>.
package outbox

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel/propagation"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
)

// Schema — таблица outbox. Идемпотентна; сервис передаёт её в dbx.Migrate.
// Рабочей роли нужен UPDATE (published_at), поэтому таблица не append-only.
const Schema = `CREATE TABLE IF NOT EXISTS outbox (
  id           uuid        PRIMARY KEY,
  subject      text        NOT NULL,
  envelope     bytea       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox (id) WHERE published_at IS NULL;
`

// DuplicateWindow — окно дедупликации потока по Nats-Msg-Id. Повтор публикации
// после падения релея отбрасывается, если релей поднялся в пределах окна.
const DuplicateWindow = 2 * time.Hour

var (
	sourceRe  = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	subjectRe = regexp.MustCompile(`^senim\.([a-z][a-z0-9_]*)(\.[a-z0-9_]+)+$`)
)

// StreamName — имя потока источника: SENIM_<SOURCE>.
func StreamName(source string) string { return "SENIM_" + strings.ToUpper(source) }

// EnsureStream создаёт или обновляет поток источника: субъекты senim.<source>.>,
// окно дедупликации DuplicateWindow, хранение на диске.
func EnsureStream(ctx context.Context, js jetstream.JetStream, source string) (jetstream.Stream, error) {
	if !sourceRe.MatchString(source) {
		return nil, fmt.Errorf("outbox: недопустимый источник %q", source)
	}
	s, err := js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:       StreamName(source),
		Subjects:   []string{"senim." + source + ".>"},
		Storage:    jetstream.FileStorage,
		Duplicates: DuplicateWindow,
	})
	if err != nil {
		return nil, fmt.Errorf("outbox: поток %s: %w", StreamName(source), err)
	}
	return s, nil
}

// Add записывает событие в outbox в транзакции tx и возвращает его event_id
// (UUIDv7). Субъект — senim.<source>.<event>; source берётся из субъекта.
// trace_parent — W3C traceparent из ctx (пусто, если трассировки нет).
func Add(ctx context.Context, tx pgx.Tx, subject string, eventType string, payload proto.Message) (string, error) {
	m := subjectRe.FindStringSubmatch(subject)
	if m == nil {
		return "", fmt.Errorf("outbox: недопустимый субъект %q (нужно senim.<source>.<event>)", subject)
	}
	if eventType == "" {
		return "", errors.New("outbox: пустой тип события")
	}
	body, err := proto.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("outbox: payload: %w", err)
	}
	id, err := uuid.NewV7()
	if err != nil {
		return "", fmt.Errorf("outbox: event_id: %w", err)
	}
	carrier := propagation.MapCarrier{}
	propagation.TraceContext{}.Inject(ctx, carrier)
	now := time.Now().UTC()
	env, err := proto.Marshal(&eventsv1.Envelope{
		EventId:     id.String(),
		Type:        eventType,
		Source:      m[1],
		OccurredAt:  timestamppb.New(now),
		TraceParent: carrier.Get("traceparent"),
		Payload:     body,
	})
	if err != nil {
		return "", fmt.Errorf("outbox: envelope: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO outbox (id, subject, envelope, created_at) VALUES ($1, $2, $3, $4)`,
		id.String(), subject, env, now); err != nil {
		return "", fmt.Errorf("outbox: запись: %w", err)
	}
	return id.String(), nil
}
