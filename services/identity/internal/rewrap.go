package internal

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CemeteryPlaya/senim-platform/pkg/config"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/pii"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

const (
	// defaultRewrapBatch, maxRewrapBatch — строк в одной транзакции identity rewrap-pii.
	defaultRewrapBatch = 500
	maxRewrapBatch     = 10_000
	// rewrapBatchTimeout — дедлайн одной пачки (транзакции); rewrapConnectTimeout —
	// подключения к базе. Ни одного вызова без дедлайна.
	rewrapBatchTimeout   = 30 * time.Second
	rewrapConnectTimeout = 30 * time.Second
	// piiKeysCheckTimeout — дедлайн проверки ключей при старте serve.
	piiKeysCheckTimeout = 30 * time.Second
)

// checkPIIKeys — проверка при старте serve: каждый kid шифртекстов ПДн в базе (persons,
// parties, mfa_factors) есть в наборе ключей. Ключ убран из PII_KEKS раньше перешифровки —
// ошибка с именем kid: сервис не стартует, а не отвечает Internal на каждое чтение.
func checkPIIKeys(ctx context.Context, pool *pgxpool.Pool, keys *pii.Keyring) error {
	ctx, cancel := context.WithTimeout(ctx, piiKeysCheckTimeout)
	defer cancel()
	kids, err := store.New(pool).ListPIIKIDs(ctx)
	if err != nil {
		return fmt.Errorf("проверка ключей ПДн: %w", err)
	}
	var missing []string
	for _, kid := range kids {
		if !keys.Has(kid) {
			missing = append(missing, strconv.Quote(kid))
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("pii_key_unknown: в базе есть ПДн под kid %s, которого нет в %s (вернуть ключ, перешифровать identity rewrap-pii и только затем убрать)",
			strings.Join(missing, ", "), pii.EnvKEKs)
	}
	return nil
}

// RewrapConfig — настройки подкоманды rewrap-pii: рабочая роль базы и ключи ПДн.
type RewrapConfig struct {
	Env    config.AppEnv
	AppDSN string
	PII    *pii.Keyring
}

// LoadRewrap читает переменные rewrap-pii; все нарушения возвращаются разом.
func LoadRewrap(src config.Source) (RewrapConfig, error) {
	l := config.NewLoader(src)
	c := RewrapConfig{Env: l.Env(), AppDSN: l.PostgresDSN("IDENTITY_APP_DSN")}
	c.PII = pii.LoadKeyring(l, "IDENTITY_OTP_HMAC_KEY", "IDENTITY_TOKEN_SIGNING_KEY")
	if err := l.Err(); err != nil {
		return RewrapConfig{}, fmt.Errorf("конфигурация: %w", err)
	}
	return c, nil
}

// RewrapResult — сколько строк перешифровано в каждой таблице и какие значения
// перешифровать не удалось.
type RewrapResult struct {
	Persons, Parties, MfaFactors int
	Damaged                      []RewrapDamage
}

// RewrapDamage — значение, которое не расшифровывается своим ключом и AAD: повреждено или
// перенесено из чужой строки (pii.ErrAuth, pii.ErrMalformed). Строка остаётся как есть.
type RewrapDamage struct {
	Table, Column string
	UserID        uuid.UUID
}

// RewrapPII — подкоманда «identity rewrap-pii [--batch 500]»: все шифртексты ПДн, чей
// kid не текущий (PII_KEK_CURRENT), переводятся на текущий ключ — ключ данных
// переоборачивается, значение и AAD не меняются. Пачками в отдельных транзакциях, у
// каждой — свой дедлайн; строки пачки под блокировкой. Печатает число строк по таблицам.
//
// Повреждённое значение не останавливает перешифровку остальных: оно остаётся под прежним
// ключом, попадает в лог (таблица, столбец, user_id) и даёт код выхода 1 — а убрать
// прежний ключ из PII_KEKS не даст проверка при старте serve. Ключа шифртекста нет в
// PII_KEKS — команда останавливается и называет kid. Работает рабочей ролью
// (IDENTITY_APP_DSN); значений в лог не пишет.
func RewrapPII(ctx context.Context, src config.Source, log *slog.Logger, args []string) error {
	fs := flag.NewFlagSet("rewrap-pii", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	batch := fs.Int("batch", defaultRewrapBatch, "строк в одной транзакции")
	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("rewrap-pii: %w", err)
	}
	if fs.NArg() != 0 {
		return errors.New("rewrap-pii: лишние аргументы")
	}
	if *batch < 1 || *batch > maxRewrapBatch {
		return fmt.Errorf("rewrap-pii: --batch: от 1 до %d", maxRewrapBatch)
	}
	cfg, err := LoadRewrap(src)
	if err != nil {
		return err
	}
	connectCtx, cancel := context.WithTimeout(ctx, rewrapConnectTimeout)
	pool, err := dbx.Connect(connectCtx, cfg.AppDSN, ServiceID, 1)
	cancel()
	if err != nil {
		return err
	}
	defer pool.Close()
	res, err := rewrapAll(ctx, pool, cfg.PII, int32(*batch)) //nolint:gosec // batch проверен: 1…maxRewrapBatch
	// Число по таблицам — и при сбое: перешифрованные пачки уже закоммичены.
	log.Info("ПДн перешифрованы", "kid", cfg.PII.Current(),
		"persons", res.Persons, "parties", res.Parties, "mfa_factors", res.MfaFactors)
	for _, d := range res.Damaged {
		log.Warn("значение ПДн не перешифровано: повреждено или перенесено из чужой строки",
			"table", d.Table, "column", d.Column, "user_id", d.UserID.String())
	}
	if err != nil {
		return err
	}
	if len(res.Damaged) > 0 {
		return fmt.Errorf("rewrap-pii: не перешифровано значений: %d (список — в логе выше)", len(res.Damaged))
	}
	return nil
}

// rewrapPage — итог пачки: сколько строк выбрано, последний user_id (курсор следующей
// пачки), сколько строк обновлено и повреждённые значения.
type rewrapPage struct {
	rows    int
	last    uuid.UUID
	updated int
	damaged []RewrapDamage
}

// rewrapBatchFn перешифровывает одну пачку строк с user_id больше after.
type rewrapBatchFn func(ctx context.Context, q *store.Queries, keys *pii.Keyring, after uuid.UUID, batch int32) (rewrapPage, error)

// rewrapAll обходит таблицы с ПДн по возрастанию user_id; пустая пачка — таблица
// пройдена. Курсор не даёт повреждённой строке снова попасть в следующую пачку.
func rewrapAll(ctx context.Context, pool *pgxpool.Pool, keys *pii.Keyring, batch int32) (RewrapResult, error) {
	var res RewrapResult
	steps := []struct {
		count *int
		fn    rewrapBatchFn
	}{
		{&res.Persons, rewrapPersons},
		{&res.Parties, rewrapParties},
		{&res.MfaFactors, rewrapMfaFactors},
	}
	for _, step := range steps {
		after := uuid.Nil
		for {
			page, err := rewrapBatch(ctx, pool, keys, after, batch, step.fn)
			if err != nil {
				return res, err
			}
			*step.count += page.updated
			res.Damaged = append(res.Damaged, page.damaged...)
			// Конец таблицы — пустая пачка, а не короткая: SELECT … FOR UPDATE пропускает
			// строки, изменённые параллельно (их kid уже текущий), и пачка бывает короче.
			if page.rows == 0 {
				break
			}
			after = page.last
		}
	}
	return res, nil
}

// rewrapBatch — одна пачка в своей транзакции и со своим дедлайном.
func rewrapBatch(ctx context.Context, pool *pgxpool.Pool, keys *pii.Keyring, after uuid.UUID, batch int32, fn rewrapBatchFn) (rewrapPage, error) {
	ctx, cancel := context.WithTimeout(ctx, rewrapBatchTimeout)
	defer cancel()
	var page rewrapPage
	err := dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		var err error
		page, err = fn(ctx, store.New(tx), keys, after, batch)
		return err
	})
	if err != nil {
		return rewrapPage{}, err
	}
	return page, nil
}

// rewrapCol — столбец шифртекста строки: имя, значение (меняется на месте) и AAD.
type rewrapCol struct {
	name string
	v    *pgtype.Text
	aad  string
}

// rewrapRow перешифровывает значения строки на месте; NULL остаётся NULL. Повреждённое
// значение (ErrAuth, ErrMalformed) остаётся как есть и попадает в page.damaged; ключа нет
// в наборе (ErrUnknownKID) — ошибка с именем kid. changed=false — менять в строке нечего.
func rewrapRow(keys *pii.Keyring, table string, userID uuid.UUID, page *rewrapPage, cols []rewrapCol) (changed bool, err error) {
	for _, c := range cols {
		if !c.v.Valid {
			continue
		}
		out, _, err := keys.Rewrap(c.v.String, c.aad)
		if errors.Is(err, pii.ErrAuth) || errors.Is(err, pii.ErrMalformed) {
			page.damaged = append(page.damaged, RewrapDamage{Table: table, Column: c.name, UserID: userID})
			continue
		}
		if err != nil {
			return false, fmt.Errorf("%s.%s %s: %w", table, c.name, userID, err)
		}
		if out != c.v.String {
			c.v.String, changed = out, true
		}
	}
	return changed, nil
}

func rewrapPersons(ctx context.Context, q *store.Queries, keys *pii.Keyring, after uuid.UUID, batch int32) (rewrapPage, error) {
	rows, err := q.PersonsToRewrap(ctx, store.PersonsToRewrapParams{Kid: keys.Current(), After: after, Batch: batch})
	if err != nil {
		return rewrapPage{}, err
	}
	page := rewrapPage{rows: len(rows)}
	for _, r := range rows {
		page.last = r.UserID
		changed, err := rewrapRow(keys, "persons", r.UserID, &page, []rewrapCol{{"iin_enc", &r.IinEnc, personIINAAD(r.UserID)}})
		if err != nil {
			return rewrapPage{}, err
		}
		if !changed {
			continue
		}
		if err := q.SetPersonIINEnc(ctx, store.SetPersonIINEncParams{IinEnc: r.IinEnc, UserID: r.UserID}); err != nil {
			return rewrapPage{}, err
		}
		page.updated++
	}
	return page, nil
}

func rewrapParties(ctx context.Context, q *store.Queries, keys *pii.Keyring, after uuid.UUID, batch int32) (rewrapPage, error) {
	rows, err := q.PartiesToRewrap(ctx, store.PartiesToRewrapParams{Kid: keys.Current(), After: after, Batch: batch})
	if err != nil {
		return rewrapPage{}, err
	}
	page := rewrapPage{rows: len(rows)}
	for _, r := range rows {
		page.last = r.UserID
		bin := pgtype.Text{String: r.BinIinEnc, Valid: true}
		changed, err := rewrapRow(keys, "parties", r.UserID, &page, []rewrapCol{
			{"bin_iin_enc", &bin, partyBinIINAAD(r.UserID)},
			{"signer_iin_enc", &r.SignerIinEnc, partySignerIINAAD(r.UserID)},
			{"payout_iban_enc", &r.PayoutIbanEnc, partyPayoutIBANAAD(r.UserID)},
		})
		if err != nil {
			return rewrapPage{}, err
		}
		if !changed {
			continue
		}
		if err := q.SetPartyEnc(ctx, store.SetPartyEncParams{BinIinEnc: bin.String, SignerIinEnc: r.SignerIinEnc, PayoutIbanEnc: r.PayoutIbanEnc, UserID: r.UserID}); err != nil {
			return rewrapPage{}, err
		}
		page.updated++
	}
	return page, nil
}

// rewrapMfaFactors меняет и secret_enc фактора. Проверка кода, начатая до перешифровки,
// сравнивает secret_enc в условном UPDATE и получит отказ — оператор вводит код ещё раз.
func rewrapMfaFactors(ctx context.Context, q *store.Queries, keys *pii.Keyring, after uuid.UUID, batch int32) (rewrapPage, error) {
	rows, err := q.MfaFactorsToRewrap(ctx, store.MfaFactorsToRewrapParams{Kid: keys.Current(), After: after, Batch: batch})
	if err != nil {
		return rewrapPage{}, err
	}
	page := rewrapPage{rows: len(rows)}
	for _, r := range rows {
		page.last = r.UserID
		secret := pgtype.Text{String: r.SecretEnc, Valid: true}
		changed, err := rewrapRow(keys, "mfa_factors", r.UserID, &page, []rewrapCol{{"secret_enc", &secret, mfaSecretAAD(r.UserID)}})
		if err != nil {
			return rewrapPage{}, err
		}
		if !changed {
			continue
		}
		if err := q.SetMfaSecretEnc(ctx, store.SetMfaSecretEncParams{SecretEnc: secret.String, UserID: r.UserID}); err != nil {
			return rewrapPage{}, err
		}
		page.updated++
	}
	return page, nil
}
