package config

import (
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// PostgresDSN возвращает обязательный DSN Postgres. Вне dev DSN обязан давать полную
// проверку TLS: его разбирает тот же pgconn.ParseConfig, которым потом подключается
// сервис, и принимается только такой результат, где основное подключение и каждое
// запасное (хосты через запятую, sslmode=prefer/allow) идут по TLS с проверкой
// сертификата и имени сервера, то есть эквивалентно sslmode=verify-full. Так разбор
// (экранирование «\», пробелы вокруг «=», кавычки, URL, повтор ключа) не расходится
// с драйвером. Переменные PG* учитываются так же, как при подключении: DSN без sslmode
// и PGSSLMODE=verify-full в окружении проходит проверку, потому что и подключится так же.
// Пароль в ошибку не попадает: в ней только имя переменной.
func (l *Loader) PostgresDSN(key string) string {
	v := l.Required(key)
	if v == "" {
		return ""
	}
	if l.strict() && !fullVerifyTLS(v) {
		l.fail("%s: must use TLS with full certificate verification (sslmode=verify-full) when APP_ENV is not dev", key)
		return ""
	}
	return v
}

// fullVerifyTLS сообщает, что каждое подключение, которое соберёт pgconn из dsn,
// использует TLS с проверкой цепочки и имени хоста. У verify-full tls.Config имеет
// ServerName и InsecureSkipVerify=false; у require/verify-ca/prefer/allow
// InsecureSkipVerify=true (verify-ca проверяет цепочку вручную, но не имя), у disable
// конфига нет вовсе.
func fullVerifyTLS(dsn string) bool {
	cfg, err := pgconn.ParseConfig(dsn)
	if err != nil {
		return false
	}
	if cfg.TLSConfig == nil || cfg.TLSConfig.InsecureSkipVerify || cfg.TLSConfig.ServerName == "" {
		return false
	}
	for _, f := range cfg.Fallbacks {
		if f.TLSConfig == nil || f.TLSConfig.InsecureSkipVerify || f.TLSConfig.ServerName == "" {
			return false
		}
	}
	return true
}

// OTLPEndpoint возвращает адрес OTLP-экспортёра или пустую строку (телеметрия выключена).
// Вне dev непустой адрес обязан начинаться с https://.
func (l *Loader) OTLPEndpoint(key string) string {
	v := l.String(key, "")
	if v != "" && l.strict() && !strings.HasPrefix(strings.ToLower(v), "https://") {
		l.fail("%s: must be an https:// URL when APP_ENV is not dev", key)
		return ""
	}
	return v
}
