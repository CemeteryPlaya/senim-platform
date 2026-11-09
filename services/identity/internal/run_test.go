package internal

import (
	"io"
	"log/slog"
	"testing"
)

func TestNewSender(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if s, err := newSender("mock", log); err != nil || s == nil {
		t.Fatalf("mock: %v %v", s, err)
	}
	if _, err := newSender("sms-gateway", log); err == nil {
		t.Fatal("неизвестный провайдер принят")
	}
}
