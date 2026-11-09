package internal

import (
	"context"
	"os"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
)

type columnInfo struct {
	Table, Name, Type, Nullable string
	Pos                         int
}

func columnsOf(t *testing.T, conn *pgx.Conn, schema string) []columnInfo {
	t.Helper()
	r, err := conn.Query(context.Background(), `SELECT table_name, column_name, data_type, is_nullable, ordinal_position
		FROM information_schema.columns WHERE table_schema = $1 AND table_name IN ('outbox', 'idempotency')
		ORDER BY table_name, ordinal_position`, schema)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	var out []columnInfo
	for r.Next() {
		var c columnInfo
		if err := r.Scan(&c.Table, &c.Name, &c.Type, &c.Nullable, &c.Pos); err != nil {
			t.Fatal(err)
		}
		out = append(out, c)
	}
	if err := r.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestPlatformSchemaMatchesPkg: platform_schema.sql (копия для sqlc) совпадает по колонкам
// с боевыми outbox.Schema и idem.Schema, применёнными миграцией (схема public).
func TestPlatformSchemaMatchesPkg(t *testing.T) {
	migratedDB(t) // поднимает базу и применяет миграции с outbox.Schema и idem.Schema
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, pgEnv.OwnerDSN("identity"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()

	src, err := os.ReadFile("../platform_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, `DROP SCHEMA IF EXISTS drift_check CASCADE; CREATE SCHEMA drift_check`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = conn.Exec(context.Background(), `DROP SCHEMA IF EXISTS drift_check CASCADE`) })
	if _, err := conn.Exec(ctx, `SET search_path = drift_check`); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, string(src)); err != nil {
		t.Fatalf("platform_schema.sql: %v", err)
	}
	copyCols, realCols := columnsOf(t, conn, "drift_check"), columnsOf(t, conn, "public")
	if len(realCols) == 0 || !reflect.DeepEqual(copyCols, realCols) {
		t.Fatalf("platform_schema.sql разошёлся с pkg/outbox.Schema и pkg/idem.Schema:\ncopy: %+v\nreal: %+v", copyCols, realCols)
	}
}
