package inbox_test

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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	"github.com/CemeteryPlaya/senim-platform/internal/testdb"
	"github.com/CemeteryPlaya/senim-platform/internal/testnats"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/inbox"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
)

const (
	service  = "audit"
	consumer = "audit-deal-events"
)

// effects — побочный эффект обработчика; должен появиться ровно один раз.
var migrations = fstest.MapFS{
	"00001_effects.sql": {Data: []byte(`-- +goose Up
CREATE TABLE effects (id bigserial PRIMARY KEY, event_id text NOT NULL);
-- +goose Down
DROP TABLE effects;
`)},
}

var (
	pgEnv   *testdb.Env
	natsEnv *testnats.Env
	srcSeq  atomic.Int32
	evSeq   atomic.Int32
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
	pool  *pgxpool.Pool
	owner *pgx.Conn
}

// setup: inbox.Schema через dbx.Migrate (настоящие роли), пустые таблицы, код
// работает от audit_app.
func setup(t *testing.T) *fixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := dbx.Migrate(ctx, pgEnv.OwnerDSN(service), service, migrations, inbox.Schema); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	owner, err := pgx.Connect(ctx, pgEnv.OwnerDSN(service))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = owner.Close(context.Background()) })
	if _, err := owner.Exec(ctx, `TRUNCATE inbox, effects`); err != nil {
		t.Fatal(err)
	}
	pool, err := dbx.Connect(ctx, pgEnv.AppDSN(service), service)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return &fixture{pool: pool, owner: owner}
}

func (f *fixture) count(t *testing.T, table string) int {
	t.Helper()
	var n int
	if err := f.owner.QueryRow(context.Background(), `SELECT count(*) FROM `+table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// bus — поток и durable-консьюмер на отдельном источнике.
type bus struct {
	js     jetstream.JetStream
	source string
	cons   jetstream.Consumer
}

func newBus(t *testing.T) *bus {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	nc, js, err := natsEnv.Connect()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(nc.Close)
	b := &bus{js: js, source: fmt.Sprintf("src%d", srcSeq.Add(1))}
	if _, err := outbox.EnsureStream(ctx, js, b.source); err != nil {
		t.Fatal(err)
	}
	b.cons, err = js.CreateOrUpdateConsumer(ctx, outbox.StreamName(b.source), jetstream.ConsumerConfig{
		Durable:   consumer,
		AckPolicy: jetstream.AckExplicitPolicy,
		AckWait:   30 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func newEnvelope(source string) *eventsv1.Envelope {
	return &eventsv1.Envelope{
		EventId:    fmt.Sprintf("0190a000-0000-7000-8000-%012d", evSeq.Add(1)),
		Type:       "google.protobuf.StringValue",
		Source:     source,
		OccurredAt: timestamppb.Now(),
		Payload:    []byte("p"),
	}
}

// publishCopy публикует конверт без Nats-Msg-Id: каждая копия — отдельное
// сообщение потока, как повторная доставка того же события.
func (b *bus) publishCopy(t *testing.T, env *eventsv1.Envelope) {
	t.Helper()
	data, err := proto.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := b.js.Publish(ctx, "senim."+b.source+".created", data); err != nil {
		t.Fatal(err)
	}
}

func (b *bus) next(t *testing.T, wait time.Duration) jetstream.Msg {
	t.Helper()
	m, err := b.cons.Next(jetstream.FetchMaxWait(wait))
	if err != nil {
		t.Fatalf("нет сообщения за %v: %v", wait, err)
	}
	return m
}

// countingMsg считает Ack и Nak поверх настоящего сообщения.
type countingMsg struct {
	jetstream.Msg
	acks, naks, terms *atomic.Int32
}

func (m countingMsg) Ack() error { m.acks.Add(1); return m.Msg.Ack() }
func (m countingMsg) NakWithDelay(d time.Duration) error {
	m.naks.Add(1)
	return m.Msg.NakWithDelay(d)
}
func (m countingMsg) Nak() error  { m.naks.Add(1); return m.Msg.Nak() }
func (m countingMsg) Term() error { m.terms.Add(1); return m.Msg.Term() }
func (m countingMsg) TermWithReason(r string) error {
	m.terms.Add(1)
	return m.Msg.TermWithReason(r)
}

type counters struct{ acks, naks, terms atomic.Int32 }

func (c *counters) wrap(m jetstream.Msg) jetstream.Msg {
	return countingMsg{Msg: m, acks: &c.acks, naks: &c.naks, terms: &c.terms}
}

func recordEffect(ctx context.Context, tx pgx.Tx, env *eventsv1.Envelope) error {
	_, err := tx.Exec(ctx, `INSERT INTO effects (event_id) VALUES ($1)`, env.GetEventId())
	return err
}

func TestInboxProcessesOnce(t *testing.T) {
	f := setup(t)
	b := newBus(t)
	env := newEnvelope(b.source)
	b.publishCopy(t, env)
	b.publishCopy(t, env)

	var c counters
	var calls atomic.Int32
	fn := func(ctx context.Context, tx pgx.Tx, got *eventsv1.Envelope) error {
		calls.Add(1)
		if got.GetEventId() != env.GetEventId() {
			t.Errorf("event_id %q", got.GetEventId())
		}
		return recordEffect(ctx, tx, got)
	}
	ctx := context.Background()
	for range 2 {
		if err := inbox.Handle(ctx, f.pool, consumer, c.wrap(b.next(t, 5*time.Second)), fn); err != nil {
			t.Fatalf("Handle: %v", err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("fn вызван %d раз, ожидался 1", calls.Load())
	}
	if c.acks.Load() != 2 || c.naks.Load() != 0 {
		t.Fatalf("acks=%d naks=%d, ожидалось 2 и 0", c.acks.Load(), c.naks.Load())
	}
	if n := f.count(t, "effects"); n != 1 {
		t.Fatalf("эффектов %d", n)
	}
	if n := f.count(t, "inbox"); n != 1 {
		t.Fatalf("записей inbox %d", n)
	}
	// Оба сообщения подтверждены сервером: ждать нечего.
	deadline := time.Now().Add(5 * time.Second)
	for {
		info, err := b.cons.Info(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if info.NumAckPending == 0 && info.NumPending == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("ack pending=%d pending=%d", info.NumAckPending, info.NumPending)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestInboxRetriesOnError(t *testing.T) {
	f := setup(t)
	b := newBus(t)
	env := newEnvelope(b.source)
	b.publishCopy(t, env)

	var c counters
	var calls atomic.Int32
	boom := errors.New("boom")
	fn := func(ctx context.Context, tx pgx.Tx, got *eventsv1.Envelope) error {
		if err := recordEffect(ctx, tx, got); err != nil {
			return err
		}
		if calls.Add(1) == 1 {
			return boom // эффект первой попытки должен откатиться
		}
		return nil
	}
	ctx := context.Background()
	first := b.next(t, 5*time.Second)
	if err := inbox.Handle(ctx, f.pool, consumer, c.wrap(first), fn); !errors.Is(err, boom) {
		t.Fatalf("первая попытка: err = %v", err)
	}
	if c.naks.Load() != 1 || c.acks.Load() != 0 {
		t.Fatalf("после ошибки acks=%d naks=%d", c.acks.Load(), c.naks.Load())
	}
	if n := f.count(t, "inbox"); n != 0 {
		t.Fatalf("после отката записей inbox %d", n)
	}
	if n := f.count(t, "effects"); n != 0 {
		t.Fatalf("после отката эффектов %d", n)
	}

	// Повторная доставка после задержки Nak.
	second := b.next(t, 15*time.Second)
	md, err := second.Metadata()
	if err != nil {
		t.Fatal(err)
	}
	if md.NumDelivered != 2 {
		t.Fatalf("NumDelivered = %d, ожидалась повторная доставка", md.NumDelivered)
	}
	if err := inbox.Handle(ctx, f.pool, consumer, c.wrap(second), fn); err != nil {
		t.Fatalf("вторая попытка: %v", err)
	}
	if calls.Load() != 2 || c.acks.Load() != 1 {
		t.Fatalf("calls=%d acks=%d", calls.Load(), c.acks.Load())
	}
	if n := f.count(t, "inbox"); n != 1 {
		t.Fatalf("записей inbox %d, ожидалась 1", n)
	}
	if n := f.count(t, "effects"); n != 1 {
		t.Fatalf("эффектов %d, ожидался 1", n)
	}
}

// fakeMsg — сообщение без сервера для гонок и битых данных.
type fakeMsg struct {
	jetstream.Msg
	data []byte
	c    *counters
}

func (m fakeMsg) Data() []byte                     { return m.data }
func (m fakeMsg) Subject() string                  { return "senim.fake.created" }
func (m fakeMsg) Headers() nats.Header             { return nats.Header{} }
func (m fakeMsg) Ack() error                       { m.c.acks.Add(1); return nil }
func (m fakeMsg) Nak() error                       { m.c.naks.Add(1); return nil }
func (m fakeMsg) NakWithDelay(time.Duration) error { m.c.naks.Add(1); return nil }
func (m fakeMsg) Term() error                      { m.c.terms.Add(1); return nil }
func (m fakeMsg) TermWithReason(string) error      { m.c.terms.Add(1); return nil }
func (m fakeMsg) Metadata() (*jetstream.MsgMetadata, error) {
	return &jetstream.MsgMetadata{NumDelivered: 1}, nil
}

func TestInboxConcurrentDuplicates(t *testing.T) {
	f := setup(t)
	env := newEnvelope("fake")
	data, err := proto.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	var c counters
	var calls atomic.Int32
	fn := func(ctx context.Context, tx pgx.Tx, got *eventsv1.Envelope) error {
		calls.Add(1)
		time.Sleep(200 * time.Millisecond) // вторая доставка ждёт на ключе inbox
		return recordEffect(ctx, tx, got)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for range 4 {
		wg.Go(func() {
			errs <- inbox.Handle(context.Background(), f.pool, consumer, fakeMsg{data: data, c: &c}, fn)
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("Handle: %v", err)
		}
	}
	if calls.Load() != 1 || c.acks.Load() != 4 || c.naks.Load() != 0 {
		t.Fatalf("calls=%d acks=%d naks=%d", calls.Load(), c.acks.Load(), c.naks.Load())
	}
	if n := f.count(t, "effects"); n != 1 {
		t.Fatalf("эффектов %d", n)
	}
}

func TestInboxSeparatesConsumers(t *testing.T) {
	f := setup(t)
	data, err := proto.Marshal(newEnvelope("fake"))
	if err != nil {
		t.Fatal(err)
	}
	var c counters
	var calls atomic.Int32
	fn := func(context.Context, pgx.Tx, *eventsv1.Envelope) error { calls.Add(1); return nil }
	for _, name := range []string{"a", "b", "a"} {
		if err := inbox.Handle(context.Background(), f.pool, name, fakeMsg{data: data, c: &c}, fn); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("calls=%d: у каждого получателя своя дедупликация", calls.Load())
	}
}

func TestInboxTermsMalformedMessage(t *testing.T) {
	f := setup(t)
	noID, err := proto.Marshal(&eventsv1.Envelope{Type: "x"})
	if err != nil {
		t.Fatal(err)
	}
	for _, data := range [][]byte{{0xff, 0xff, 0xff}, noID} {
		var c counters
		called := false
		fn := func(context.Context, pgx.Tx, *eventsv1.Envelope) error { called = true; return nil }
		if err := inbox.Handle(context.Background(), f.pool, consumer, fakeMsg{data: data, c: &c}, fn); err == nil {
			t.Fatal("ожидалась ошибка для битого конверта")
		}
		if called || c.terms.Load() != 1 || c.acks.Load() != 0 {
			t.Fatalf("called=%v terms=%d acks=%d", called, c.terms.Load(), c.acks.Load())
		}
	}
	if n := f.count(t, "inbox"); n != 0 {
		t.Fatalf("записей inbox %d", n)
	}
}

func TestInboxPassesTraceParent(t *testing.T) {
	f := setup(t)
	env := newEnvelope("fake")
	env.TraceParent = "00-0102030405060708090a0b0c0d0e0f10-0102030405060708-01"
	data, err := proto.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	var c counters
	var got trace.SpanContext
	fn := func(ctx context.Context, _ pgx.Tx, _ *eventsv1.Envelope) error {
		got = trace.SpanContextFromContext(ctx)
		return nil
	}
	if err := inbox.Handle(context.Background(), f.pool, consumer, fakeMsg{data: data, c: &c}, fn); err != nil {
		t.Fatal(err)
	}
	if got.TraceID().String() != "0102030405060708090a0b0c0d0e0f10" || !got.IsRemote() {
		t.Fatalf("контекст трассировки %v", got)
	}
}

func TestInboxTableIsAppendOnly(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `INSERT INTO inbox (consumer, event_id) VALUES ('x', 'y')`); err != nil {
		t.Fatalf("INSERT: %v", err)
	}
	for _, stmt := range []string{`UPDATE inbox SET consumer = 'z'`, `DELETE FROM inbox`} {
		_, err := f.pool.Exec(ctx, stmt)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Fatalf("%q от app-роли: %v", stmt, err)
		}
	}
}
