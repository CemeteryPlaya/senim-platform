package internal

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// retentionCfg — сроки, как в умолчаниях конфига.
func retentionCfg() RetentionConfig {
	return RetentionConfig{
		RetainOTP: 24 * time.Hour, RetainSessions: 720 * time.Hour, RetainRateLimits: 48 * time.Hour,
		RetainIdempotency: 48 * time.Hour, RetainOutbox: 168 * time.Hour, Every: time.Hour,
	}
}

func execAll(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func cleanRetentionTables(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	for _, table := range []string{"otp_codes", "sessions", "rate_limits", "idempotency", "outbox"} {
		execAll(t, pool, "DELETE FROM "+table)
	}
}

func rows(t *testing.T, pool *pgxpool.Pool, table string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRetentionDeletesOnlyOld(t *testing.T) {
	pool, q := migratedDB(t)
	cleanRetentionTables(t, pool)
	user, err := createUser(q, []string{"CLIENT"}, "CLIENT")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	cfg := retentionCfg()
	old := func(retain time.Duration) time.Time { return now.Add(-retain - time.Hour) }
	young := func(retain time.Duration) time.Time { return now.Add(-retain + time.Hour) }

	otp := `INSERT INTO otp_codes (phone, code_hash, expires_at, created_at) VALUES ($1, '\x00', $2, $2)`
	execAll(t, pool, otp, "+77000000001", old(cfg.RetainOTP))
	execAll(t, pool, otp, "+77000000002", young(cfg.RetainOTP))

	rl := `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)`
	execAll(t, pool, rl, "old", old(cfg.RetainRateLimits))
	execAll(t, pool, rl, "young", young(cfg.RetainRateLimits))

	idem := `INSERT INTO idempotency (method, key, request_hash, response, created_at) VALUES ('m', $1, '\x00', '\x00', $2)`
	execAll(t, pool, idem, "old", old(cfg.RetainIdempotency))
	execAll(t, pool, idem, "young", young(cfg.RetainIdempotency))

	// Сессии: истекла давно / отозвана давно / истекла недавно / отозвана недавно.
	sess := `INSERT INTO sessions (token_hash, user_id, active_role, expires_at, revoked_at, opened_by)
		VALUES (sha256(gen_random_uuid()::text::bytea), $1, 'CLIENT', $2, $3, 'otp')`
	execAll(t, pool, sess, user.ID, old(cfg.RetainSessions), nil)
	execAll(t, pool, sess, user.ID, now.Add(time.Hour), old(cfg.RetainSessions))
	execAll(t, pool, sess, user.ID, young(cfg.RetainSessions), nil)
	execAll(t, pool, sess, user.ID, now.Add(time.Hour), young(cfg.RetainSessions))

	// Outbox: опубликованная давно / опубликованная недавно / неопубликованная давняя.
	ob := `INSERT INTO outbox (id, subject, envelope, created_at, published_at) VALUES (gen_random_uuid(), 'senim.identity.x', '\x00', $1, $2)`
	execAll(t, pool, ob, old(cfg.RetainOutbox), old(cfg.RetainOutbox))
	execAll(t, pool, ob, young(cfg.RetainOutbox), young(cfg.RetainOutbox))
	execAll(t, pool, ob, old(cfg.RetainOutbox), nil)

	res, err := runRetention(context.Background(), pool, cfg, now)
	if err != nil {
		t.Fatal(err)
	}
	want := RetentionResult{OTP: 1, Sessions: 2, RateLimits: 1, Idempotency: 1, Outbox: 1}
	if res != want {
		t.Fatalf("удалено %+v, want %+v", res, want)
	}
	for table, left := range map[string]int{"otp_codes": 1, "sessions": 2, "rate_limits": 1, "idempotency": 1, "outbox": 2} {
		if got := rows(t, pool, table); got != left {
			t.Errorf("%s: осталось %d, want %d", table, got, left)
		}
	}
	// Неопубликованная запись жива, сколько бы ей ни было лет.
	var unpublished int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox WHERE published_at IS NULL`).Scan(&unpublished); err != nil || unpublished != 1 {
		t.Errorf("неопубликованных %d (err %v), want 1", unpublished, err)
	}
}

func TestRetentionBatches(t *testing.T) {
	pool, _ := migratedDB(t)
	cleanRetentionTables(t, pool)
	now := time.Now().UTC().Truncate(time.Second)
	cfg := retentionCfg()
	execAll(t, pool, `INSERT INTO otp_codes (phone, code_hash, expires_at, created_at)
		SELECT '+7700' || g, '\x00', $1::timestamptz, $1::timestamptz FROM generate_series(1, 2500) g`, now.Add(-cfg.RetainOTP-time.Hour))
	res, err := runRetention(context.Background(), pool, cfg, now)
	if err != nil {
		t.Fatal(err)
	}
	if left := rows(t, pool, "otp_codes"); res.OTP != 2500 || left != 0 {
		t.Fatalf("удалено %d, осталось %d, want 2500 и 0", res.OTP, left)
	}
}

func TestRetentionKeepsActiveSessions(t *testing.T) {
	pool, q := migratedDB(t)
	cleanRetentionTables(t, pool)
	user, err := createUser(q, []string{"CLIENT"}, "CLIENT")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	cfg := retentionCfg()
	// Живая сессия, созданная очень давно: не отозвана и ещё не истекла. И сессия,
	// отозванная только что, но с будущим истечением.
	sess := `INSERT INTO sessions (token_hash, user_id, active_role, created_at, last_seen_at, expires_at, revoked_at, opened_by)
		VALUES (sha256(gen_random_uuid()::text::bytea), $1, 'CLIENT', $2, $2, $3, $4, 'otp')`
	long := now.Add(-cfg.RetainSessions * 3)
	execAll(t, pool, sess, user.ID, long, now.Add(time.Minute), nil)
	execAll(t, pool, sess, user.ID, long, now.Add(time.Hour), now.Add(-time.Minute))
	res, err := runRetention(context.Background(), pool, cfg, now)
	if err != nil {
		t.Fatal(err)
	}
	if left := rows(t, pool, "sessions"); res.Sessions != 0 || left != 2 {
		t.Fatalf("удалено %d, осталось %d: живые сессии не трогаем", res.Sessions, left)
	}
}

func TestRetentionSingleReplica(t *testing.T) {
	pool, _ := migratedDB(t)
	cleanRetentionTables(t, pool)
	now := time.Now().UTC().Truncate(time.Second)
	cfg := retentionCfg()
	execAll(t, pool, `INSERT INTO otp_codes (phone, code_hash, expires_at, created_at)
		SELECT '+7700' || g, '\x00', $1::timestamptz, $1::timestamptz FROM generate_series(1, 30) g`, now.Add(-cfg.RetainOTP-time.Hour))

	// Другая реплика держит замок: этот запуск ничего не трогает.
	ctx := context.Background()
	holder, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var got bool
	if err := holder.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, retentionLockKey).Scan(&got); err != nil || !got {
		t.Fatalf("замок не взят: %v %v", got, err)
	}
	res, err := runRetention(ctx, pool, cfg, now)
	if err != nil {
		t.Fatal(err)
	}
	if left := rows(t, pool, "otp_codes"); !res.Skipped || res.OTP != 0 || left != 30 {
		t.Fatalf("при чужом замке: %+v, строк %d", res, left)
	}
	if _, err := holder.Exec(ctx, `SELECT pg_advisory_unlock($1)`, retentionLockKey); err != nil {
		t.Fatal(err)
	}
	holder.Release()

	// Замок отпущен — запуск чистит, а после запуска замок свободен снова.
	res, err = runRetention(ctx, pool, cfg, now)
	if err != nil || res.Skipped || res.OTP != 30 {
		t.Fatalf("после освобождения: %+v, %v", res, err)
	}
	res, err = runRetention(ctx, pool, cfg, now)
	if err != nil || res.Skipped {
		t.Fatalf("замок не освобождён после запуска: %+v, %v", res, err)
	}
}

func TestRetentionConfig(t *testing.T) {
	c, err := load(t, serveVars())
	if err != nil {
		t.Fatal(err)
	}
	if c.Retention != retentionCfg() {
		t.Errorf("умолчания %+v, want %+v", c.Retention, retentionCfg())
	}
	vars := serveVars()
	vars["IDENTITY_RETAIN_RATE_LIMITS"] = "1h" // меньше суток: стёрло бы живые суточные счётчики
	vars["IDENTITY_RETENTION_EVERY"] = "soon"
	_, err = load(t, vars)
	if err == nil || !strings.Contains(err.Error(), "IDENTITY_RETAIN_RATE_LIMITS") || !strings.Contains(err.Error(), "IDENTITY_RETENTION_EVERY") {
		t.Fatalf("want errors naming both variables, got %v", err)
	}
}
