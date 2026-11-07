package outbox_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/wrapperspb"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	"github.com/CemeteryPlaya/senim-platform/internal/testdb"
	"github.com/CemeteryPlaya/senim-platform/internal/testnats"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
)

const (
	service   = "deal"
	eventType = "google.protobuf.StringValue"
)

var (
	pgEnv   *testdb.Env
	natsEnv *testnats.Env
	srcSeq  atomic.Int32
)

func TestMain(m *testing.M) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	var err error
	if pgEnv, err = testdb.Start(ctx); err != nil {
		cancel()
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if natsEnv, err = testnats.Start(ctx); err != nil {
		cancel()
		pgEnv.Terminate()
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cancel()
	code := m.Run()
	natsEnv.Terminate()
	pgEnv.Terminate()
	os.Exit(code)
}

type fixture struct {
	pool   *pgxpool.Pool
	owner  *pgx.Conn
	nc     *nats.Conn
	js     jetstream.JetStream
	source string
	stream jetstream.Stream
	// seen — все сообщения на субъектах источника, включая дубликаты, которые
	// поток отбросил: core-подписка видит каждую публикацию.
	seen atomic.Int32
}

// setup: схема outbox через dbx.Migrate (настоящие роли), пустая таблица, код
// работает от deal_app; отдельный поток SENIM_<source> на каждый тест.
func setup(t *testing.T) *fixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := dbx.Migrate(ctx, pgEnv.OwnerDSN(service), service, fstest.MapFS{}, outbox.Schema); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	owner, err := pgx.Connect(ctx, pgEnv.OwnerDSN(service))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = owner.Close(context.Background()) })
	if _, err := owner.Exec(ctx, `TRUNCATE outbox`); err != nil {
		t.Fatal(err)
	}
	pool, err := dbx.Connect(ctx, pgEnv.AppDSN(service), service)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	nc, js, err := natsEnv.Connect()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(nc.Close)
	f := &fixture{pool: pool, owner: owner, nc: nc, js: js, source: fmt.Sprintf("src%d", srcSeq.Add(1))}
	if f.stream, err = outbox.EnsureStream(ctx, js, f.source); err != nil {
		t.Fatalf("EnsureStream: %v", err)
	}
	sub, err := nc.Subscribe("senim."+f.source+".>", func(*nats.Msg) { f.seen.Add(1) })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sub.Unsubscribe() })
	if err := nc.Flush(); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *fixture) subject() string { return "senim." + f.source + ".created" }

// addCommitted записывает n событий в одной транзакции.
func (f *fixture) addCommitted(t *testing.T, n int) []string {
	t.Helper()
	ctx := context.Background()
	var ids []string
	err := dbx.InTx(ctx, f.pool, func(tx pgx.Tx) error {
		for i := range n {
			id, err := outbox.Add(ctx, tx, f.subject(), eventType, wrapperspb.String(fmt.Sprintf("e%d", i)))
			if err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	return ids
}

func (f *fixture) count(t *testing.T, where string) int {
	t.Helper()
	var n int
	if err := f.owner.QueryRow(context.Background(), `SELECT count(*) FROM outbox WHERE `+where).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (f *fixture) streamMsgs(t *testing.T) uint64 {
	t.Helper()
	info, err := f.stream.Info(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return info.State.Msgs
}

// waitPublished ждёт, пока все записи outbox получат published_at.
func (f *fixture) waitPublished(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for f.count(t, "published_at IS NULL") > 0 {
		if time.Now().After(deadline) {
			t.Fatalf("не опубликовано за 30 с: осталось %d", f.count(t, "published_at IS NULL"))
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// waitSeen ждёт want публикаций и ещё немного — чтобы лишние успели прийти.
func (f *fixture) waitSeen(t *testing.T, want int32) int32 {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for f.seen.Load() < want && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(300 * time.Millisecond)
	return f.seen.Load()
}

// runRelay запускает релей в фоне; возвращает остановку, которая ждёт выхода Run.
func runRelay(t *testing.T, r *outbox.Relay) func() {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- r.Run(ctx) }()
	var once sync.Once
	stop := func() {
		once.Do(func() {
			cancel()
			select {
			case err := <-done:
				if err != nil {
					t.Errorf("Run: %v", err)
				}
			case <-time.After(10 * time.Second):
				t.Error("Run не остановился за 10 с")
			}
		})
	}
	t.Cleanup(stop)
	return stop
}

func TestAddIsPartOfTransaction(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	boom := errors.New("boom")
	err := dbx.InTx(ctx, f.pool, func(tx pgx.Tx) error {
		if _, err := outbox.Add(ctx, tx, f.subject(), eventType, wrapperspb.String("x")); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	if n := f.count(t, "true"); n != 0 {
		t.Fatalf("после отката в outbox %d записей", n)
	}
}

func TestAddEnvelope(t *testing.T) {
	f := setup(t)
	traceID := trace.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	spanID := trace.SpanID{1, 2, 3, 4, 5, 6, 7, 8}
	ctx := trace.ContextWithSpanContext(context.Background(), trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: traceID, SpanID: spanID, TraceFlags: trace.FlagsSampled,
	}))
	var id string
	before := time.Now().Add(-time.Second)
	err := dbx.InTx(ctx, f.pool, func(tx pgx.Tx) error {
		var err error
		id, err = outbox.Add(ctx, tx, f.subject(), eventType, wrapperspb.String("hello"))
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	u, err := uuid.Parse(id)
	if err != nil || u.Version() != 7 {
		t.Fatalf("event_id %q: не UUIDv7 (%v)", id, err)
	}
	var subject string
	var raw []byte
	var published *time.Time
	if err := f.owner.QueryRow(ctx, `SELECT subject, envelope, published_at FROM outbox WHERE id = $1`, id).Scan(&subject, &raw, &published); err != nil {
		t.Fatal(err)
	}
	if subject != f.subject() || published != nil {
		t.Fatalf("subject=%q published_at=%v", subject, published)
	}
	env := &eventsv1.Envelope{}
	if err := proto.Unmarshal(raw, env); err != nil {
		t.Fatal(err)
	}
	if env.GetEventId() != id || env.GetType() != eventType || env.GetSource() != f.source {
		t.Fatalf("envelope = %v", env)
	}
	if at := env.GetOccurredAt().AsTime(); at.Before(before) || at.After(time.Now().Add(time.Second)) {
		t.Fatalf("occurred_at = %v", at)
	}
	want := "00-0102030405060708090a0b0c0d0e0f10-0102030405060708-01"
	if env.GetTraceParent() != want {
		t.Fatalf("trace_parent = %q, ожидался %q", env.GetTraceParent(), want)
	}
	payload := &wrapperspb.StringValue{}
	if err := proto.Unmarshal(env.GetPayload(), payload); err != nil || payload.GetValue() != "hello" {
		t.Fatalf("payload = %v (%v)", payload, err)
	}
}

func TestAddRejectsBadInput(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	for _, tc := range []struct{ subject, typ string }{
		{"identity.created", eventType},
		{"senim.created", eventType},
		{"senim.Identity.created", eventType},
		{"senim.identity.>", eventType},
		{"senim.identity.*", eventType},
		{"senim.identity.created", ""},
	} {
		err := dbx.InTx(ctx, f.pool, func(tx pgx.Tx) error {
			_, err := outbox.Add(ctx, tx, tc.subject, tc.typ, wrapperspb.String("x"))
			return err
		})
		if err == nil {
			t.Errorf("Add(%q, %q) без ошибки", tc.subject, tc.typ)
		}
	}
}

func TestStreamNaming(t *testing.T) {
	f := setup(t)
	info, err := f.stream.Info(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info.Config.Name != "SENIM_"+upper(f.source) || outbox.StreamName(f.source) != info.Config.Name {
		t.Fatalf("имя потока %q", info.Config.Name)
	}
	if len(info.Config.Subjects) != 1 || info.Config.Subjects[0] != "senim."+f.source+".>" {
		t.Fatalf("субъекты %v", info.Config.Subjects)
	}
	if info.Config.Duplicates != 2*time.Hour {
		t.Fatalf("окно дедупликации %v", info.Config.Duplicates)
	}
}

func upper(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'a' && c <= 'z' {
			b[i] = c - 'a' + 'A'
		}
	}
	return string(b)
}

func TestRelayPublishesOnce(t *testing.T) {
	f := setup(t)
	ids := f.addCommitted(t, 2)
	stop := runRelay(t, outbox.NewRelay(f.pool, f.js, nil))
	f.waitPublished(t)
	if got := f.waitSeen(t, 2); got != 2 {
		t.Fatalf("публикаций %d, ожидалось 2", got)
	}
	stop()
	if n := f.streamMsgs(t); n != 2 {
		t.Fatalf("в потоке %d сообщений, ожидалось 2", n)
	}
	// Заголовок Nats-Msg-Id = event_id, тело — Envelope.
	for seq, id := range ids {
		m, err := f.stream.GetMsg(context.Background(), uint64(seq+1))
		if err != nil {
			t.Fatal(err)
		}
		if got := m.Header.Get(jetstream.MsgIDHeader); got != id {
			t.Errorf("сообщение %d: Nats-Msg-Id %q, ожидался %q", seq+1, got, id)
		}
		env := &eventsv1.Envelope{}
		if err := proto.Unmarshal(m.Data, env); err != nil || env.GetEventId() != id {
			t.Errorf("сообщение %d: envelope %v (%v)", seq+1, env, err)
		}
	}
}

func TestRelayCrashAfterPublish(t *testing.T) {
	f := setup(t)
	f.addCommitted(t, 2)
	// Первый релей публикует и «падает» до отметки published_at.
	crashing := outbox.NewRelay(f.pool, f.js, nil)
	outbox.CrashAfterPublish(crashing)
	if _, err := outbox.RunBatch(context.Background(), crashing); err == nil {
		t.Fatal("ожидалась ошибка имитации падения")
	}
	if n := f.count(t, "published_at IS NULL"); n != 2 {
		t.Fatalf("после падения не отмечено %d записей, ожидалось 2", n)
	}
	if n := f.streamMsgs(t); n != 2 {
		t.Fatalf("после падения в потоке %d сообщений", n)
	}
	// Перезапуск: те же события публикуются ещё раз, поток их отбрасывает.
	runRelay(t, outbox.NewRelay(f.pool, f.js, nil))
	f.waitPublished(t)
	if got := f.waitSeen(t, 4); got != 4 {
		t.Fatalf("публикаций %d, ожидалось 4 (2 до падения + 2 повтора)", got)
	}
	if n := f.streamMsgs(t); n != 2 {
		t.Fatalf("в потоке %d сообщений, ожидалось 2: повтор не отброшен", n)
	}
}

func TestTwoRelaysNoDuplicates(t *testing.T) {
	f := setup(t)
	const total = 500
	f.addCommitted(t, total)
	runRelay(t, outbox.NewRelay(f.pool, f.js, nil))
	runRelay(t, outbox.NewRelay(f.pool, f.js, nil))
	f.waitPublished(t)
	// Core-подписка видит и дубликаты, которые поток отбросил бы по Nats-Msg-Id:
	// ровно 500 публикаций — значит, релеи не делили записи.
	if got := f.waitSeen(t, total); got != total {
		t.Fatalf("публикаций %d, ожидалось %d", got, total)
	}
	if n := f.streamMsgs(t); n != total {
		t.Fatalf("в потоке %d сообщений, ожидалось %d", n, total)
	}
}

func TestRelayRollsBackWhenPublishFails(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	// Субъект без потока: публикация не подтверждается, отметки нет.
	err := dbx.InTx(ctx, f.pool, func(tx pgx.Tx) error {
		_, err := outbox.Add(ctx, tx, "senim.nostream"+f.source+".created", eventType, wrapperspb.String("x"))
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := outbox.RunBatch(ctx, outbox.NewRelay(f.pool, f.js, nil)); err == nil {
		t.Fatal("ожидалась ошибка публикации")
	}
	if n := f.count(t, "published_at IS NULL"); n != 1 {
		t.Fatalf("запись отмечена без подтверждения публикации: неотмеченных %d", n)
	}
}
