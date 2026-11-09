package config

import (
	"net/url"
	"strings"
)

// PostgresDSN возвращает обязательный DSN Postgres. Вне dev DSN обязан требовать
// sslmode=verify-full (шифрование и проверка сертификата и имени сервера); разбираются
// обе формы — URL и «ключ=значение». В ошибку DSN не попадает: в нём пароль.
func (l *Loader) PostgresDSN(key string) string {
	v := l.Required(key)
	if v == "" {
		return ""
	}
	if l.strict() && dsnSSLMode(v) != "verify-full" {
		l.fail("%s: sslmode=verify-full is required when APP_ENV is not dev", key)
		return ""
	}
	return v
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

// dsnSSLMode достаёт sslmode из DSN в форме URL или «ключ=значение»; нет — пустая строка.
func dsnSSLMode(dsn string) string {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		u, err := url.Parse(dsn)
		if err != nil {
			return ""
		}
		return u.Query().Get("sslmode")
	}
	return keywordParams(dsn)["sslmode"]
}

// keywordParams разбирает DSN вида «host=db password='a b' sslmode=verify-full»:
// значение — до пробела или в одинарных кавычках, внутри кавычек \' и \ экранируют.
// Нераспознанный хвост отбрасывается; повтор ключа — последнее значение, как в libpq.
func keywordParams(s string) map[string]string {
	res := map[string]string{}
	for i := 0; i < len(s); {
		for i < len(s) && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n') {
			i++
		}
		start := i
		for i < len(s) && s[i] != '=' && s[i] != ' ' {
			i++
		}
		if i >= len(s) || s[i] != '=' {
			continue
		}
		key := s[start:i]
		i++ // '='
		var val strings.Builder
		if i < len(s) && s[i] == '\'' {
			i++
			for i < len(s) && s[i] != '\'' {
				if s[i] == '\\' && i+1 < len(s) {
					i++
				}
				val.WriteByte(s[i])
				i++
			}
			i++ // закрывающая кавычка
		} else {
			for i < len(s) && s[i] != ' ' && s[i] != '\t' && s[i] != '\n' {
				val.WriteByte(s[i])
				i++
			}
		}
		res[key] = val.String()
	}
	return res
}
