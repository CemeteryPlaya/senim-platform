// Package config загружает и строго проверяет конфигурацию сервиса при старте.
// Ошибки копятся и возвращаются разом через Err; каждая называет переменную
// и никогда не содержит её значение.
package config

import (
	"errors"
	"fmt"
	"slices"
	"strconv"
)

// AppEnv — окружение, в котором запущен сервис.
type AppEnv string

const (
	Dev     AppEnv = "dev"
	Staging AppEnv = "staging"
	Prod    AppEnv = "prod"
)

// Source отдаёт значение переменной; в проде это os.LookupEnv.
type Source func(key string) (string, bool)

// Loader читает переменные и накапливает нарушения.
type Loader struct {
	src     Source
	errs    []error
	env     AppEnv
	demo    bool
	envDone bool
}

// NewLoader создаёт загрузчик поверх источника переменных.
func NewLoader(src Source) *Loader {
	return &Loader{src: src}
}

func (l *Loader) fail(format string, args ...any) {
	l.errs = append(l.errs, fmt.Errorf(format, args...))
}

// Err возвращает все накопленные ошибки разом или nil.
func (l *Loader) Err() error {
	return errors.Join(l.errs...)
}

// Env читает обязательную APP_ENV и DEMO_MODE. Неизвестное значение APP_ENV — ошибка.
// DEMO_MODE разбирается strconv.ParseBool (true, TRUE, 1, t ...); значение, которое не
// разбирается (yes, on ...), — ошибка в любом окружении: опечатка не должна молча
// включать или выключать демо-режим. Включённый DEMO_MODE при APP_ENV=prod — ошибка.
// Результат кэшируется, ошибки по APP_ENV и DEMO_MODE не дублируются.
func (l *Loader) Env() AppEnv {
	if l.envDone {
		return l.env
	}
	l.envDone = true
	raw, ok := l.src("APP_ENV")
	switch {
	case !ok || raw == "":
		l.fail("APP_ENV: not set (expected dev, staging or prod)")
	case AppEnv(raw) == Dev || AppEnv(raw) == Staging || AppEnv(raw) == Prod:
		l.env = AppEnv(raw)
	default:
		l.fail("APP_ENV: unknown value (expected dev, staging or prod)")
	}
	if v, ok := l.src("DEMO_MODE"); ok && v != "" {
		demo, err := strconv.ParseBool(v)
		switch {
		case err != nil:
			l.fail("DEMO_MODE: not a boolean (expected true or false)")
		case demo && l.env == Prod:
			l.fail("DEMO_MODE: must not be enabled when APP_ENV=prod")
		default:
			l.demo = demo
		}
	}
	return l.env
}

// DemoMode сообщает, включён ли демо-режим (DEMO_MODE). При ошибке разбора или
// запрете в prod — false, а ошибка уже в Err.
func (l *Loader) DemoMode() bool {
	l.Env()
	return l.demo
}

// strict: правила prod/staging; при неверном или отсутствующем APP_ENV
// строгие правила включены (безопасное умолчание).
func (l *Loader) strict() bool {
	return l.Env() != Dev
}

// String возвращает значение или def, если переменная не задана.
func (l *Loader) String(key, def string) string {
	if v, ok := l.src(key); ok && v != "" {
		return v
	}
	return def
}

// Required возвращает значение; отсутствие — ошибка.
func (l *Loader) Required(key string) string {
	v, ok := l.src(key)
	if !ok || v == "" {
		l.fail("%s: required but not set", key)
		return ""
	}
	return v
}

// Provider проверяет выбор провайдера из allowed; в prod значения из mocks запрещены.
func (l *Loader) Provider(key string, allowed []string, mocks []string) string {
	v := l.Required(key)
	if v == "" {
		return ""
	}
	if !slices.Contains(allowed, v) {
		l.fail("%s: value %q is not allowed (allowed: %v)", key, v, allowed)
		return ""
	}
	if l.Env() == Prod && slices.Contains(mocks, v) {
		l.fail("%s: mock provider %q is forbidden when APP_ENV=prod", key, v)
		return ""
	}
	return v
}
