package idem_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/types/known/wrapperspb"

	"github.com/CemeteryPlaya/senim-platform/pkg/idem"
)

const method = "/svc/Method"

func TestLookupNotFound(t *testing.T) {
	pool := setup(t)
	ctx := context.Background()
	found, err := idem.Lookup(ctx, pool, method, "none", wrapperspb.String("r"), &wrapperspb.StringValue{})
	if err != nil || found {
		t.Fatalf("Lookup: %v %v", found, err)
	}
	// Пробная строка не остаётся: следующий Do выполняет fn.
	var calls atomic.Int32
	if _, replayed, err := call(ctx, pool, "none", wrapperspb.String("r"), "x", &calls); err != nil || replayed || calls.Load() != 1 {
		t.Fatalf("Do после Lookup: %v %v calls=%d", replayed, err, calls.Load())
	}
}

func TestLookupKeyReused(t *testing.T) {
	pool := setup(t)
	ctx := context.Background()
	var calls atomic.Int32
	if _, _, err := call(ctx, pool, "k", wrapperspb.String("a"), "ok", &calls); err != nil {
		t.Fatal(err)
	}
	_, err := idem.Lookup(ctx, pool, method, "k", wrapperspb.String("b"), &wrapperspb.StringValue{})
	if !errors.Is(err, idem.ErrKeyReused) {
		t.Fatalf("ожидалась ErrKeyReused, получено %v", err)
	}
}

// inflight — транзакция с Do, чья fn стоит на канале, пока тест не вызовет finish.
type inflight struct {
	gate chan struct{}
	done chan error
	tx   pgx.Tx
}

// holdDo открывает транзакцию, входит в fn и ждёт.
func holdDo(t *testing.T, pool *pgxpool.Pool, key string, req *wrapperspb.StringValue, out string) *inflight {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	h := &inflight{gate: make(chan struct{}), done: make(chan error, 1), tx: tx}
	entered := make(chan struct{})
	go func() {
		resp := &wrapperspb.StringValue{}
		_, err := idem.Do(ctx, tx, method, key, req, resp, func() error {
			close(entered)
			<-h.gate
			resp.Value = out
			return nil
		})
		h.done <- err
	}()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("fn не вызвана")
	}
	return h
}

// finish отпускает fn (успех) и коммитит или откатывает транзакцию.
func (h *inflight) finish(t *testing.T, commit bool) {
	t.Helper()
	close(h.gate)
	if err := <-h.done; err != nil {
		t.Fatalf("Do: %v", err)
	}
	ctx := context.Background()
	if commit {
		if err := h.tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		return
	}
	if err := h.tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
}

// waitLockWaiters ждёт, пока в базе будет n сеансов в ожидании блокировки.
func waitLockWaiters(t *testing.T, pool *pgxpool.Pool, n int) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var c int
		if err := pool.QueryRow(context.Background(),
			`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`).Scan(&c); err != nil {
			t.Fatal(err)
		}
		if c >= n {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("не дождались %d ожидающих блокировку сеансов", n)
}

type lookupResult struct {
	resp  *wrapperspb.StringValue
	found bool
	err   error
}

func asyncLookup(pool *pgxpool.Pool, key string, req *wrapperspb.StringValue) <-chan lookupResult {
	ch := make(chan lookupResult, 1)
	go func() {
		resp := &wrapperspb.StringValue{}
		found, err := idem.Lookup(context.Background(), pool, method, key, req, resp)
		ch <- lookupResult{resp, found, err}
	}()
	return ch
}

func recv[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(10 * time.Second):
		t.Fatal("таймаут ожидания результата")
		panic("unreachable")
	}
}

func TestLookupWaitsForInFlightDo(t *testing.T) {
	pool := setup(t)
	req := wrapperspb.String("r")
	h := holdDo(t, pool, "k", req, "saved")
	res := asyncLookup(pool, "k", req)
	waitLockWaiters(t, pool, 1)
	select {
	case r := <-res:
		t.Fatalf("Lookup не дождался Do: %+v", r)
	default:
	}
	h.finish(t, true)
	r := recv(t, res)
	if r.err != nil || !r.found || r.resp.GetValue() != "saved" {
		t.Fatalf("Lookup: %+v", r)
	}
}

func TestLookupAfterRolledBackDo(t *testing.T) {
	pool := setup(t)
	req := wrapperspb.String("r")
	h := holdDo(t, pool, "k", req, "saved")
	res := asyncLookup(pool, "k", req)
	waitLockWaiters(t, pool, 1)
	h.finish(t, false)
	if r := recv(t, res); r.err != nil || r.found {
		t.Fatalf("Lookup после отката: %+v", r)
	}
}

func TestLookupKeyReusedAfterInFlightDo(t *testing.T) {
	pool := setup(t)
	h := holdDo(t, pool, "k", wrapperspb.String("a"), "saved")
	res := asyncLookup(pool, "k", wrapperspb.String("b"))
	waitLockWaiters(t, pool, 1)
	h.finish(t, true)
	if r := recv(t, res); !errors.Is(r.err, idem.ErrKeyReused) {
		t.Fatalf("ожидалась ErrKeyReused: %+v", r)
	}
}

type doResult struct {
	resp     *wrapperspb.StringValue
	replayed bool
	err      error
}

func asyncDo(pool *pgxpool.Pool, key string, req *wrapperspb.StringValue, calls *atomic.Int32) <-chan doResult {
	ch := make(chan doResult, 1)
	go func() {
		resp, replayed, err := call(context.Background(), pool, key, req, "second", calls)
		ch <- doResult{resp, replayed, err}
	}()
	return ch
}

func TestSecondDoWaitsAndReplaysAfterCommit(t *testing.T) {
	pool := setup(t)
	req := wrapperspb.String("r")
	var calls atomic.Int32
	h := holdDo(t, pool, "k", req, "first")
	res := asyncDo(pool, "k", req, &calls)
	waitLockWaiters(t, pool, 1)
	h.finish(t, true)
	r := recv(t, res)
	if r.err != nil || !r.replayed || r.resp.GetValue() != "first" || calls.Load() != 0 {
		t.Fatalf("второй Do: %+v calls=%d", r, calls.Load())
	}
}

func TestSecondDoRunsAfterRollback(t *testing.T) {
	pool := setup(t)
	req := wrapperspb.String("r")
	var calls atomic.Int32
	h := holdDo(t, pool, "k", req, "first")
	res := asyncDo(pool, "k", req, &calls)
	waitLockWaiters(t, pool, 1)
	h.finish(t, false)
	r := recv(t, res)
	if r.err != nil || r.replayed || r.resp.GetValue() != "second" || calls.Load() != 1 {
		t.Fatalf("второй Do: %+v calls=%d", r, calls.Load())
	}
}

func TestSecondDoWithOtherRequestKeyReused(t *testing.T) {
	pool := setup(t)
	var calls atomic.Int32
	h := holdDo(t, pool, "k", wrapperspb.String("a"), "first")
	res := asyncDo(pool, "k", wrapperspb.String("b"), &calls)
	waitLockWaiters(t, pool, 1)
	h.finish(t, true)
	if r := recv(t, res); !errors.Is(r.err, idem.ErrKeyReused) || calls.Load() != 0 {
		t.Fatalf("второй Do: %+v calls=%d", r, calls.Load())
	}
}

// Ошибка fn и коммит вызывающим «всё равно» не должны оставить пустой успех.
func TestFailedFnThenCommitLeavesNoRecord(t *testing.T) {
	pool := setup(t)
	ctx := context.Background()
	req := wrapperspb.String("r")
	boom := errors.New("boom")
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = idem.Do(ctx, tx, method, "k", req, &wrapperspb.StringValue{}, func() error { return boom })
	if !errors.Is(err, boom) {
		t.Fatalf("ожидалась ошибка fn, получено %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	r, replayed, err := call(ctx, pool, "k", req, "done", &calls)
	if err != nil || replayed || r.GetValue() != "done" || calls.Load() != 1 {
		t.Fatalf("после коммита: %v %v %v calls=%d", r, replayed, err, calls.Load())
	}
}
