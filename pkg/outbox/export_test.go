package outbox

import "context"

// Тестовые хуки: в публичный API не входят.

// CrashAfterPublish заставляет релей «упасть» после публикации батча, до отметки
// published_at: транзакция откатывается, сообщения уже в потоке.
func CrashAfterPublish(r *Relay) { r.crashAfterPublish = true }

// RunBatch выполняет один батч релея.
func RunBatch(ctx context.Context, r *Relay) (int, error) { return r.publishBatch(ctx) }

// SetFailing ставит релей в состояние «предыдущий батч упал» — для проверки записи о
// восстановлении.
func SetFailing(r *Relay) { r.failing = true }
