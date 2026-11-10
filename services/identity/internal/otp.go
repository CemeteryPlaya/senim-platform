package internal

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"math/big"
	"net/netip"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/idem"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

const (
	otpTTL = 5 * time.Minute
	// maxIdempotencyKey — предел длины ключа идемпотентности (global-constraints).
	maxIdempotencyKey = 128
	// webCaller — единственный сервис, которому открыт RequestOtp.
	webCaller = "web"

	day  = 24 * time.Hour
	hour = time.Hour

	globalLimitSubject = "senim.identity.otp.global_limit_reached"
)

// Лимиты запроса кода, перенесены один к одному из apps/web/src/modules/identity/otp.ts:
// повтор — раз в минуту; на номер — 5 кодов в час и 10 в сутки (с любых IP); с одного IP —
// 20 запросов в час. IP неизвестен (пуст) — лимиты по IP не применяются: общий ключ
// дал бы один лимит на всех.
// Номерам без пользователя (новые регистрации) — ещё суточные потолки на префикс номера
// (первые 6 цифр) и общий: рассылка по множеству номеров с множества адресов упирается в
// них, а не в счёт за SMS. Зарегистрированных потолки не касаются.
const (
	phoneCooldown = time.Minute
	phoneHourly   = 5
	phoneDaily    = 10
	ipHourly      = 20
)

// RequestOtp выдаёт новый код на номер и отправляет его. Порядок: вызывающий, повтор по
// ключу, лимиты (отдельными командами: отказанный запрос тоже засчитывается), затем
// транзакция с кодом, отправкой и ответом.
//
// Повтор того же ключа при действующем cooldown: лимиты стоят после Lookup, поэтому при
// отказе по лимиту (ResourceExhausted) Lookup повторяется ещё раз — если первый вызов с
// этим ключом успел завершиться, возвращается его сохранённый ответ, а не отказ.
// Остаётся окно: два вызова с одним ключом одновременно в фазе лимитов (оба прошли первый
// Lookup, ни один не дошёл до Do). Это допустимо: один ключ параллельно бывает только при
// повторе web после дедлайна, двойной клик даёт разные ключи, а двойного эффекта быть не
// может (Do выполняет fn один раз на ключ); худший исход — отказ по лимиту вместо ответа.
//
// Сбой отправки: транзакция откатывается (кода нет, ключ свободен), но счётчики лимитов уже
// засчитаны, поэтому немедленный повтор с тем же ключом получает otp_too_often, а через
// 61 с проходит. Обратный случай — Send удалась, а коммит не прошёл: SMS ушла, кода в базе
// нет; человек запрашивает код заново (через минуту).
func (s *Service) RequestOtp(ctx context.Context, req *identityv1.RequestOtpRequest) (*identityv1.RequestOtpResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	key := req.GetIdempotencyKey()
	if key == "" || len(key) > maxIdempotencyKey {
		return nil, rpcError(connect.CodeInvalidArgument, "invalid_request", nil)
	}
	phone, ok := parsePhone(req.GetPhone())
	if !ok {
		return nil, rpcError(connect.CodeInvalidArgument, "invalid_phone", nil)
	}
	ip, ok := parseClientIP(req.GetClientIp())
	if !ok {
		return nil, rpcError(connect.CodeInvalidArgument, "invalid_request", nil)
	}

	// Повтор после успеха возвращает сохранённый ответ и не упирается в лимиты.
	const method = identityv1connect.IdentityServiceRequestOtpProcedure
	saved := &identityv1.RequestOtpResponse{}
	found, err := idem.Lookup(ctx, s.pool, method, key, req, saved)
	if errors.Is(err, idem.ErrKeyReused) {
		return nil, rpcError(connect.CodeInvalidArgument, "idempotency_key_reused", nil)
	}
	if err != nil {
		// Побочных эффектов ещё нет: «повторите» — правда (см. документацию server.Run).
		s.log.ErrorContext(ctx, "otp: проверка ключа идемпотентности", "err", err)
		return nil, connect.NewError(connect.CodeUnavailable, "unavailable")
	}
	if found {
		return saved, nil
	}

	if err := s.enforceLimits(ctx, phone, ip); err != nil {
		if connect.CodeOf(err) == connect.CodeResourceExhausted {
			again := &identityv1.RequestOtpResponse{}
			if found, lerr := idem.Lookup(ctx, s.pool, method, key, req, again); lerr == nil && found {
				return again, nil
			}
		}
		return nil, err
	}

	resp := &identityv1.RequestOtpResponse{}
	demoCode := ""
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		_, err := idem.Do(ctx, tx, method, key, req, resp, func() error {
			code, err := newOtpCode()
			if err != nil {
				return err
			}
			expiresAt := s.now().Add(otpTTL)
			// Действует только последний выданный код: прежние гасятся в этой же транзакции.
			q := store.New(tx)
			if err := q.RetireOtpCodes(ctx, store.RetireOtpCodesParams{Phone: phone, Now: pgtype.Timestamptz{Time: s.now(), Valid: true}}); err != nil {
				return fmt.Errorf("гашение прежних кодов: %w", err)
			}
			if err := q.InsertOtpCode(ctx, store.InsertOtpCodeParams{
				Phone:     phone,
				CodeHash:  otpHash(s.cfg.OTPHMACKey, phone, code),
				ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
				CreatedAt: pgtype.Timestamptz{Time: s.now(), Valid: true},
			}); err != nil {
				return fmt.Errorf("запись кода: %w", err)
			}
			if err := s.sender.Send(ctx, phone, code); err != nil {
				return fmt.Errorf("отправка кода: %w", err)
			}
			// В идемпотентный ответ код не попадает: повтор вернёт его пустым.
			resp.Phone = phone
			resp.ExpiresAt = timestamppb.New(expiresAt)
			if s.showsDemoCode() {
				demoCode = code
			}
			return nil
		})
		return err
	})
	if errors.Is(err, idem.ErrKeyReused) {
		return nil, rpcError(connect.CodeInvalidArgument, "idempotency_key_reused", nil)
	}
	if err != nil {
		// Лимиты уже засчитаны, SMS могла уйти: Unavailable здесь запрещён.
		s.log.ErrorContext(ctx, "otp: выдача кода", "err", err)
		return nil, internalError()
	}
	out, _ := proto.Clone(resp).(*identityv1.RequestOtpResponse)
	out.DemoCode = demoCode
	return out, nil
}

// parseClientIP приводит client_ip к каноническому виду; пустой остаётся пустым («IP
// неизвестен»), нераспознанный — не годится.
func parseClientIP(raw string) (string, bool) {
	ip := strings.TrimSpace(raw)
	if ip == "" {
		return "", true
	}
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return "", false
	}
	return addr.Unmap().String(), true
}

// ipLimitKey — адрес в ключе лимита по IP (запрос и проверка кода): IPv4 как есть, IPv6 — префикс /64. Абоненту
// обычно выдают целую /64, и полный адрес внутри неё меняется свободно: лимит по /128 обходился бы сменой адреса.
// IPv4-mapped IPv6 считается как IPv4. Нераспознанный адрес (parseClientIP его не пропускает) — как есть.
func ipLimitKey(ip string) string {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	addr = addr.Unmap()
	if addr.Is4() {
		return addr.String()
	}
	prefix, err := addr.Prefix(64)
	if err != nil {
		return addr.String()
	}
	return prefix.String()
}

// showsDemoCode — код возвращается в ответе только в демо с мок-провайдером: настоящая SMS
// никуда не уходит.
func (s *Service) showsDemoCode() bool {
	return s.cfg.DemoMode && s.cfg.OTPProvider == "mock"
}

// enforceLimits применяет лимиты в порядке otp.ts; потолки — последними, чтобы запросы,
// отклонённые лимитами номера и IP, их не расходовали.
func (s *Service) enforceLimits(ctx context.Context, phone, ip string) error {
	lim := limiter{now: s.now}
	check := func(key string, limit int, window time.Duration, reason string) error {
		allowed, err := lim.hit(ctx, s.pool, key, limit, window)
		if err != nil {
			s.log.ErrorContext(ctx, "otp: счётчик лимита", "err", err)
			return internalError()
		}
		if !allowed {
			return rpcError(connect.CodeResourceExhausted, reason, nil)
		}
		return nil
	}
	if ip != "" {
		if err := check("otp:ip:"+ipLimitKey(ip), ipHourly, hour, "otp_too_many_requests"); err != nil {
			return err
		}
	}
	if err := check("otp:phone:"+phone+":cooldown", 1, phoneCooldown, "otp_too_often"); err != nil {
		return err
	}
	if err := check("otp:phone:"+phone, phoneHourly, hour, "otp_too_many_requests"); err != nil {
		return err
	}
	if err := check("otp:phone:"+phone+":day", phoneDaily, day, "otp_too_many_today"); err != nil {
		return err
	}

	_, err := store.New(s.pool).GetUserByPhone(ctx, phone)
	if err == nil {
		return nil // зарегистрированных потолки не касаются
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		s.log.ErrorContext(ctx, "otp: поиск пользователя", "err", err)
		return internalError()
	}
	if err := check("otp:prefix:"+prefixOf(phone)+":day", s.cfg.OTPDailyPrefixLimit, day, "otp_global_limit"); err != nil {
		return err
	}
	allowed, err := lim.hit(ctx, s.pool, "otp:global:day", s.cfg.OTPDailyGlobalLimit, day)
	if err != nil {
		s.log.ErrorContext(ctx, "otp: счётчик общего потолка", "err", err)
		return internalError()
	}
	if allowed {
		return nil
	}
	s.alertGlobalCeiling(ctx, lim)
	return rpcError(connect.CodeResourceExhausted, "otp_global_limit", nil)
}

// alertGlobalCeiling — первое за сутки достижение общего потолка: предупреждение в лог и
// событие OtpGlobalLimitReached в outbox (уведомление операторам — после плана 6, notify).
// «Один раз в сутки» — тот же атомарный счётчик с лимитом 1, в одной транзакции с
// событием: из одновременных отказов оповещает ровно один, а сбой записи события не
// оставляет счётчик погашенным. Сбой оповещения отказ не меняет.
//
// Окно счётчика оповещения не выровнено с окном общего счётчика (у каждого ключа окно
// начинается с его первого попадания), как и в otp.ts: событие приходит раз в сутки от
// первого отказа, а не от начала окна потолка.
func (s *Service) alertGlobalCeiling(ctx context.Context, lim limiter) {
	limit := s.cfg.OTPDailyGlobalLimit
	first := false
	err := dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		ok, err := lim.hit(ctx, tx, "otp:global:day:alert", 1, day)
		if err != nil || !ok {
			return err
		}
		first = true
		_, err = outbox.Add(ctx, tx, ServiceID, globalLimitSubject, "senim.events.v1.OtpGlobalLimitReached", &eventsv1.OtpGlobalLimitReached{
			Limit: int64(limit),
			Date:  timestamppb.New(s.now().UTC().Truncate(day)),
		})
		return err
	})
	switch {
	case err != nil:
		s.log.ErrorContext(ctx, "otp: событие общего потолка не записано", "err", err)
	case first:
		s.log.WarnContext(ctx, "otp.global_limit_reached", "limit", limit)
	}
}

// prefixOf — первые 6 цифр номера («+77001234567» даёт «770012»): блок из ста тысяч соседних номеров.
func prefixOf(phone string) string { return phone[1:7] }

// newOtpCode — шесть цифр из crypto/rand.
func newOtpCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("генерация кода: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// otpHash — HMAC-SHA256(ключ, "otp:v1:"+номер+":"+код). Ключа в базе нет: по дампу код не
// подобрать; номер в составе, чтобы хэш не переносился на другой номер.
func otpHash(key []byte, phone, code string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte("otp:v1:" + phone + ":" + code))
	return m.Sum(nil)
}
