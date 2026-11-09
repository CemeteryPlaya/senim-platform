package authz

import (
	"testing"
	"time"
)

// settle ждёт, пока фоновое обращение источника ключей v закончится (cur ставится
// синхронно в start, поэтому cur == nil значит «ничего не идёт»).
func settle(t *testing.T, v *Verifier) {
	t.Helper()
	k, ok := v.src.(*identityKeys)
	if !ok {
		t.Fatal("источник ключей не identityKeys")
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		k.mu.Lock()
		idle := k.cur == nil
		k.mu.Unlock()
		if idle {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("фоновое обновление не завершилось")
		}
		time.Sleep(time.Millisecond)
	}
}
