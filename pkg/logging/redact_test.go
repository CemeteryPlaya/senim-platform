package logging

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/trace"
)

func newTest(buf *bytes.Buffer) *slog.Logger {
	return New(buf, "test", slog.LevelDebug)
}

func TestRedactsSensitiveKeys(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Info("x", "iin", "900101300123", "email", "a@b.kz", "lat", 43.2)
	out := buf.String()
	for _, leak := range []string{"900101300123", "a@b.kz", "43.2"} {
		if strings.Contains(out, leak) {
			t.Fatalf("leaked %q in %s", leak, out)
		}
	}
	if !strings.Contains(out, `"[redacted]"`) {
		t.Fatalf("no redaction marker in %s", out)
	}
}

func TestRedactsKeysCaseInsensitiveAndSubstring(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Info("x", "clientPhone", "777", "binIinEnc", "888", "Client_IP", "10.0.0.7", "Instagram", "@who", "lng", 76.9)
	out := buf.String()
	for _, leak := range []string{"777", "888", "10.0.0.7", "@who", "76.9"} {
		if strings.Contains(out, leak) {
			t.Fatalf("leaked %q in %s", leak, out)
		}
	}
}

func TestRedactsPatternsInMessage(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Info("iban KZ86125KZT5004100100 tel +77011234567 iin 900101300123 end")
	out := buf.String()
	for _, leak := range []string{"KZ86125KZT5004100100", "+77011234567", "900101300123"} {
		if strings.Contains(out, leak) {
			t.Fatalf("leaked %q in %s", leak, out)
		}
	}
	if !strings.Contains(out, "iban") || !strings.Contains(out, "end") {
		t.Fatalf("surrounding text lost: %s", out)
	}
}

func TestRedactsPatternsInValuesAndErrors(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Error("fail", "detail", "call 8 (700) 123-45-67 now", "err", errString("bad 900101300123"))
	out := buf.String()
	for _, leak := range []string{"123-45-67", "900101300123"} {
		if strings.Contains(out, leak) {
			t.Fatalf("leaked %q in %s", leak, out)
		}
	}
}

type errString string

func (e errString) Error() string { return string(e) }

func TestNestedGroupRedacted(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Info("x", slog.Group("user", "phone", "+77011234567", "name_x", "ok"))
	out := buf.String()
	if strings.Contains(out, "+77011234567") {
		t.Fatalf("leaked in %s", out)
	}
	if !strings.Contains(out, `"name_x":"ok"`) {
		t.Fatalf("ordinary field lost: %s", out)
	}
}

func TestWithAttrsRedacted(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).With("iban", "KZ86125KZT5004100100").WithGroup("g").Info("x", "email", "a@b.kz")
	out := buf.String()
	if strings.Contains(out, "KZ86") || strings.Contains(out, "a@b.kz") {
		t.Fatalf("leaked in %s", out)
	}
}

func TestKeepsOrdinaryFields(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Info("x", "deal_id", "d_123", "platform", "web", "duration_ms", 12)
	out := buf.String()
	for _, want := range []string{`"deal_id":"d_123"`, `"platform":"web"`, `"duration_ms":12`, `"service":"test"`, `"msg":"x"`} {
		if !strings.Contains(out, want) {
			t.Fatalf("want %s in %s", want, out)
		}
	}
}

func TestTraceIDsFromContext(t *testing.T) {
	var buf bytes.Buffer
	tid, _ := trace.TraceIDFromHex("0123456789abcdef0123456789abcdef")
	sid, _ := trace.SpanIDFromHex("0123456789abcdef")
	sc := trace.NewSpanContext(trace.SpanContextConfig{TraceID: tid, SpanID: sid, TraceFlags: trace.FlagsSampled})
	ctx := trace.ContextWithSpanContext(context.Background(), sc)
	newTest(&buf).InfoContext(ctx, "x")
	out := buf.String()
	if !strings.Contains(out, `"trace_id":"0123456789abcdef0123456789abcdef"`) || !strings.Contains(out, `"span_id":"0123456789abcdef"`) {
		t.Fatalf("no trace ids: %s", out)
	}
	buf.Reset()
	newTest(&buf).Info("y")
	if strings.Contains(buf.String(), "trace_id") {
		t.Fatalf("unexpected trace_id: %s", buf.String())
	}
}

func TestRedactFunc(t *testing.T) {
	if got := Redact("a 900101300123 b"); strings.Contains(got, "900101300123") {
		t.Fatalf("got %q", got)
	}
	if got := Redact("order 1234567890123 ok"); got != "order 1234567890123 ok" {
		t.Fatalf("13 digits must stay: %q", got)
	}
}
