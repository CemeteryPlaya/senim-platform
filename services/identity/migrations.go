// Package identity хранит встроенные миграции сервиса identity.
// Код сервиса — в internal, точка входа — в cmd/identity.
package identity

import (
	"embed"
	"io/fs"
)

//go:embed migrations/*.sql
var embedded embed.FS

// Migrations — SQL-файлы миграций в корне файловой системы (как ждёт dbx.Migrate).
func Migrations() (fs.FS, error) { return fs.Sub(embedded, "migrations") }
