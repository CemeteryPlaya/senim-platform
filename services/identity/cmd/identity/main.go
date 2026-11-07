// Command identity — сервис входа, сессий и ролей: подкоманды serve и migrate.
package main

import (
	"context"
	"os"

	"github.com/CemeteryPlaya/senim-platform/services/identity/internal"
)

func main() {
	os.Exit(internal.Main(context.Background(), os.Args[1:], os.LookupEnv, os.Stderr))
}
