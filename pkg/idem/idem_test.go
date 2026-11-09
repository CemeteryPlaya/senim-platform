package idem_test

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
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/wrapperspb"

	"github.com/CemeteryPlaya/senim-platform/internal/testdb"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/idem"
)

const service = "identity"

var pgEnv *testdb.Env

func TestMain(m *testing.M) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	var err error
	pgEnv, err = testdb.Start(ctx)
	cancel()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	code := m.Run()
	pgEnv.Terminate()
	os.Exit(code)
}

func setup(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := dbx.Migrate(ctx, pgEnv.OwnerDSN(service), service, fstest.MapFS{}, idem.Schema); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	owner, err := pgx.Connect(ctx, pgEnv.OwnerDSN(service))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = owner.Close(ctx) }()
	if _, err := owner.Exec(ctx, `TRUNCATE idempotency`); err != nil {
		t.Fatal(err)
	}
	pool, err := dbx.Connect(ctx, pgEnv.AppDSN(service), service, dbx.DefaultMaxConns)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// call выполняет Do в своей транзакции; fn пишет в resp значение out.
func call(ctx context.Context, pool *pgxpool.Pool, key string, req *wrapperspb.StringValue, out string, calls *atomic.Int32) (*wrapperspb.StringValue, bool, error) {
	resp := &wrapperspb.StringValue{}
	var replayed bool
	err := dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		var err error
		replayed, err = idem.Do(ctx, tx, "/svc/Method", key, req, resp, func() error {
			calls.Add(1)
			resp.Value = out
			return nil
		})
		return err
	})
	return resp, replayed, err
}

func TestReplayReturnsSavedResponse(t *testing.T) {
	pool := setup(t)
	ctx := context.Background()
	var calls atomic.Int32
	req := wrapperspb.String("r")
	r1, replayed, err := call(ctx, pool, "k1", req, "first", &calls)
	if err != nil || replayed || r1.GetValue() != "first" {
		t.Fatalf("первый вызов: %v %v %v", r1, replayed, err)
	}
	r2, replayed, err := call(ctx, pool, "k1", req, "second", &calls)
	if err != nil || !replayed || r2.GetValue() != "first" {
		t.Fatalf("повтор: %v %v %v", r2, replayed, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("fn вызван %d раз", calls.Load())
	}
	// Lookup видит готовый ответ без блокировки.
	got := &wrapperspb.StringValue{}
	found, err := idem.Lookup(ctx, pool, "/svc/Method", "k1", req, got)
	if err != nil || !found || got.GetValue() != "first" {
		t.Fatalf("Lookup: %v %v %v", got, found, err)
	}
	found, err = idem.Lookup(ctx, pool, "/svc/Method", "nope", req, got)
	if err != nil || found {
		t.Fatalf("Lookup чужого ключа: %v %v", found, err)
	}
}

func TestKeyReusedWithOtherRequest(t *testing.T) {
	pool := setup(t)
	ctx := context.Background()
	var calls atomic.Int32
	if _, _, err := call(ctx, pool, "k", wrapperspb.String("a"), "ok", &calls); err != nil {
		t.Fatal(err)
	}
	_, _, err := call(ctx, pool, "k", wrapperspb.String("b"), "ok", &calls)
	if !errors.Is(err, idem.ErrKeyReused) {
		t.Fatalf("ожидалась ErrKeyReused, получено %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("fn вызван %d раз", calls.Load())
	}
}

func TestConcurrentSameKeyRunsOnce(t *testing.T) {
	pool := setup(t)
	ctx := context.Background()
	var calls atomic.Int32
	req := wrapperspb.String("r")
	const n = 10
	results := make([]*wrapperspb.StringValue, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], _, errs[i] = call(ctx, pool, "same", req, fmt.Sprintf("by-%d", i), &calls)
		}()
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("fn вызван %d раз", calls.Load())
	}
	for i := range n {
		if errs[i] != nil {
			t.Fatalf("горутина %d: %v", i, errs[i])
		}
		if !proto.Equal(results[i], results[0]) {
			t.Fatalf("ответы различаются: %v и %v", results[i], results[0])
		}
	}
}

func TestFailedFnLeavesNoRecord(t *testing.T) {
	pool := setup(t)
	ctx := context.Background()
	boom := errors.New("boom")
	req := wrapperspb.String("r")
	err := dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		_, err := idem.Do(ctx, tx, "/svc/Method", "k", req, &wrapperspb.StringValue{}, func() error { return boom })
		return err
	})
	if !errors.Is(err, boom) {
		t.Fatalf("ожидалась ошибка fn, получено %v", err)
	}
	var calls atomic.Int32
	r, replayed, err := call(ctx, pool, "k", req, "done", &calls)
	if err != nil || replayed || r.GetValue() != "done" || calls.Load() != 1 {
		t.Fatalf("после отката: %v %v %v calls=%d", r, replayed, err, calls.Load())
	}
}

func TestEmptyResponseReplays(t *testing.T) {
	pool := setup(t)
	ctx := context.Background()
	var calls atomic.Int32
	req := wrapperspb.String("r")
	if _, _, err := call(ctx, pool, "e", req, "", &calls); err != nil {
		t.Fatal(err)
	}
	_, replayed, err := call(ctx, pool, "e", req, "x", &calls)
	if err != nil || !replayed || calls.Load() != 1 {
		t.Fatalf("пустой ответ: %v calls=%d err=%v", replayed, calls.Load(), err)
	}
}
