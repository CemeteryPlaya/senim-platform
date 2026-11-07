// Package outbox — надёжная отправка событий: запись в таблицу outbox в той же
// транзакции, что и изменение данных, и релей, который публикует записи в NATS
// JetStream.
//
// Гарантии: событие не теряется (запись и данные коммитятся вместе; релей отмечает
// published_at только после подтверждения JetStream) и не дублируется в потоке
// (заголовок Nats-Msg-Id = event_id; окно дедупликации потока — 2 ч). Получатель
// дополнительно защищён inbox (pkg/inbox).
//
// Порядок доставки НЕ гарантирован: несколько релеев публикуют параллельно, а
// событие с ошибкой публикации уходит позже следующих. Получатель не должен
// полагаться на порядок — сверяет статус или версию агрегата.
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
// Рабочей роли нужен UPDATE (published_at, учёт попыток), поэтому таблица не
// append-only. attempts, last_error и next_attempt_at — учёт неудачных публикаций:
// запись с ошибкой откладывается и не задерживает остальные.
const Schema = `CREATE TABLE IF NOT EXISTS outbox (
  id              uuid        PRIMARY KEY,
  subject         text        NOT NULL,
  envelope        bytea       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  attempts        int         NOT NULL DEFAULT 0,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox (next_attempt_at, id) WHERE published_at IS NULL;
`

// MaxEnvelopeBytes — предел размера envelope: max_payload NATS по умолчанию 1 МБ
// включает заголовки, 4 КБ оставлены на них. Больше — Add возвращает ошибку в
// транзакции вызывающего, а не релею.
const MaxEnvelopeBytes = 1<<20 - 4<<10

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
// eventType обязан совпадать с полным именем payload (proto.MessageName) — защита
// от опечатки, по которой получатель не разберёт событие. payload не nil;
// envelope не больше MaxEnvelopeBytes.
// trace_parent — W3C traceparent из ctx (пусто, если трассировки нет).
func Add(ctx context.Context, tx pgx.Tx, subject string, eventType string, payload proto.Message) (string, error) {
	m := subjectRe.FindStringSubmatch(subject)
	if m == nil {
		return "", fmt.Errorf("outbox: недопустимый субъект %q (нужно senim.<source>.<event>)", subject)
	}
	if payload == nil || !payload.ProtoReflect().IsValid() {
		return "", errors.New("outbox: пустой payload")
	}
	if name := string(proto.MessageName(payload)); eventType != name {
		return "", fmt.Errorf("outbox: тип события %q не совпадает с payload %q", eventType, name)
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
	if len(env) > MaxEnvelopeBytes {
		return "", fmt.Errorf("outbox: envelope %d байт больше предела %d", len(env), MaxEnvelopeBytes)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO outbox (id, subject, envelope, created_at) VALUES ($1, $2, $3, $4)`,
		id.String(), subject, env, now); err != nil {
		return "", fmt.Errorf("outbox: запись: %w", err)
	}
	return id.String(), nil
}
