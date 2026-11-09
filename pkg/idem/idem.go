// Package idem — идемпотентность изменяющих методов gRPC.
//
// Каждый изменяющий метод принимает idempotency_key. Do запоминает ключ и ответ в
// таблице idempotency в той же транзакции, что и изменение данных: повтор после успеха
// получает сохранённый ответ и не выполняет fn второй раз; повтор с тем же ключом, но
// другим запросом — ErrKeyReused. Если fn вернула ошибку, вызывающий откатывает
// транзакцию, и запись ключа исчезает вместе с ней.
//
// Строки удаляются по сроку хранения (задача очистки): таблица помечена
// senim:app-delete, и app-роль может делать DELETE.
package idem

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"
)

// Schema — таблица идемпотентности. Идемпотентна; сервис передаёт её в dbx.Migrate.
const Schema = `-- senim:app-delete idempotency
CREATE TABLE IF NOT EXISTS idempotency (
  method       text        NOT NULL,
  key          text        NOT NULL,
  request_hash bytea       NOT NULL,
  response     bytea       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (method, key)
);
CREATE INDEX IF NOT EXISTS idempotency_created_at_idx ON idempotency (created_at);
`

// ErrKeyReused — ключ уже использован с другим запросом. Обработчик превращает её в
// InvalidArgument с кодом idempotency_key_reused.
var ErrKeyReused = errors.New("idem: ключ идемпотентности уже использован с другим запросом")

const insertPlaceholder = `INSERT INTO idempotency (method, key, request_hash, response) VALUES ($1, $2, $3, ''::bytea)
		 ON CONFLICT (method, key) DO NOTHING`

func hashOf(req proto.Message) ([]byte, error) {
	b, err := proto.MarshalOptions{Deterministic: true}.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("idem: сериализация запроса: %w", err)
	}
	h := sha256.Sum256(b)
	return h[:], nil
}

// Do выполняет fn один раз на пару (method, key) в транзакции вызывающего.
//
// replayed = true — готовый ответ с тем же хэшем запроса записан в resp, fn не
// вызывалась. Параллельный вызов с тем же ключом ждёт на первичном ключе, пока первая
// транзакция не завершится: после коммита получает её ответ, после отката выполняет fn
// сам. fn должна заполнить resp; после успешной fn ответ сохраняется.
//
// Требует уровня изоляции READ COMMITTED (по умолчанию): на REPEATABLE READ и
// SERIALIZABLE конфликт ключа даёт ошибку 40001 вместо повтора ответа.
//
// Если fn вернула ошибку, строка-заявка удаляется сразу, так что даже коммит транзакции
// вызывающим не оставит пустой ответ, который потом считался бы успехом.
func Do(ctx context.Context, tx pgx.Tx, method, key string, req, resp proto.Message, fn func() error) (replayed bool, err error) {
	hash, err := hashOf(req)
	if err != nil {
		return false, err
	}
	tag, err := tx.Exec(ctx, insertPlaceholder, method, key, hash)
	if err != nil {
		return false, fmt.Errorf("idem: запись ключа: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Строка закоммичена другой транзакцией (вставка выше ждала её исхода).
		found, err := read(ctx, tx, method, key, hash, resp)
		if err != nil {
			return false, err
		}
		if !found {
			return false, errors.New("idem: запись ключа исчезла во время обработки")
		}
		return true, nil
	}
	if err := fn(); err != nil {
		// Если fn оборвала транзакцию SQL-ошибкой, DELETE не выполнится, но и коммит
		// невозможен: Postgres превратит его в откат.
		_, _ = tx.Exec(ctx, `DELETE FROM idempotency WHERE method = $1 AND key = $2`, method, key)
		return false, err
	}
	saved, err := proto.MarshalOptions{Deterministic: true}.Marshal(resp)
	if err != nil {
		return false, fmt.Errorf("idem: сериализация ответа: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE idempotency SET response = $3 WHERE method = $1 AND key = $2`, method, key, saved); err != nil {
		return false, fmt.Errorf("idem: сохранение ответа: %w", err)
	}
	return false, nil
}

// Lookup возвращает готовый ответ до проверки лимитов и счётчиков попыток, чтобы повтор
// после успеха не упирался в лимит. Если тот же ключ сейчас выполняет Do в другой
// транзакции, Lookup ждёт её исхода: после коммита вернёт её ответ, после отката
// found = false. Иначе повтор после дедлайна клиента обогнал бы незавершённую
// транзакцию и столкнулся бы с её изменениями.
//
// Lookup работает в собственной короткой транзакции и ничего не сохраняет: пробная
// строка-заявка откатывается. found = false — ключа нет; ErrKeyReused — ключ есть, но
// запрос другой. Требует READ COMMITTED (см. Do).
func Lookup(ctx context.Context, pool *pgxpool.Pool, method, key string, req, resp proto.Message) (found bool, err error) {
	hash, err := hashOf(req)
	if err != nil {
		return false, err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("idem: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	tag, err := tx.Exec(ctx, insertPlaceholder, method, key, hash)
	if err != nil {
		return false, fmt.Errorf("idem: проверка ключа: %w", err)
	}
	if tag.RowsAffected() == 1 {
		return false, nil
	}
	return read(ctx, tx, method, key, hash, resp)
}

func read(ctx context.Context, tx pgx.Tx, method, key string, hash []byte, resp proto.Message) (bool, error) {
	var storedHash, saved []byte
	err := tx.QueryRow(ctx,
		`SELECT request_hash, response FROM idempotency WHERE method = $1 AND key = $2`, method, key).
		Scan(&storedHash, &saved)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("idem: чтение ключа: %w", err)
	}
	if !bytes.Equal(storedHash, hash) {
		return false, ErrKeyReused
	}
	if err := proto.Unmarshal(saved, resp); err != nil {
		return false, fmt.Errorf("idem: разбор сохранённого ответа: %w", err)
	}
	return true, nil
}
