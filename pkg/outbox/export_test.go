package outbox

import (
	"context"
	"time"
)

// Тестовые хуки: в публичный API не входят.

// CrashAfterPublish заставляет релей «упасть» после публикации батча, до отметки
// published_at: транзакция откатывается, сообщения уже в потоке.
func CrashAfterPublish(r *Relay) { r.crashAfterPublish = true }

// RunBatch выполняет один батч релея.
func RunBatch(ctx context.Context, r *Relay) (int, error) { return r.publishBatch(ctx) }

// SetFailing ставит релей в состояние «предыдущий батч упал» — для проверки записи о
// восстановлении.
func SetFailing(r *Relay) { r.failing = true }

// SetTimeouts меняет сроки батча, публикации и запаса на учёт (масштаб времени теста).
func SetTimeouts(r *Relay, batch, publish, reserve time.Duration) {
	r.batchTimeout, r.publishTimeout, r.reserve = batch, publish, reserve
}
