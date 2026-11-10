package logging

import (
	"bytes"
	"context"
	"encoding/json"
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
	// По разобранному JSON: «43.2» может оказаться во времени записи (…:43.2…).
	var rec map[string]any
	if err := json.Unmarshal(buf.Bytes(), &rec); err != nil {
		t.Fatalf("log line is not JSON: %v\n%s", err, buf.String())
	}
	for _, key := range []string{"iin", "email", "lat"} {
		if got := rec[key]; got != "[redacted]" {
			t.Errorf("%s = %#v, want \"[redacted]\"", key, got)
		}
	}
}

// Проверка по разобранному JSON, а не поиском подстроки: время в записи может
// содержать те же цифры (например 888), и тест мигал.
func TestRedactsKeysCaseInsensitiveAndSubstring(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Info("x", "clientPhone", "777", "binIinEnc", "888", "Client_IP", "10.0.0.7", "Instagram", "@who", "lng", 76.9)
	var rec map[string]any
	if err := json.Unmarshal(buf.Bytes(), &rec); err != nil {
		t.Fatalf("log line is not JSON: %v\n%s", err, buf.String())
	}
	for _, key := range []string{"clientPhone", "binIinEnc", "Client_IP", "Instagram", "lng"} {
		if got, ok := rec[key]; !ok || got != "[redacted]" {
			t.Errorf("%s = %#v, want \"[redacted]\"", key, got)
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

type reqStruct struct {
	Phone string
	Note  string
	Deal  string `json:"deal_id"`
}

func TestAnyValuesWalked(t *testing.T) {
	var buf bytes.Buffer
	l := newTest(&buf)
	l.Info("x",
		"p", map[string]any{"phone": "+77011234567", "n": []string{"900101300123"}, "k": "fine"},
		"s", reqStruct{Phone: "+77011234567", Note: "call 900101300123", Deal: "d1"},
		"ptr", &reqStruct{Phone: "+77011234567"},
		"list", []any{map[string]any{"email": "a@b.kz"}},
	)
	out := buf.String()
	for _, leak := range []string{"+77011234567", "900101300123", "a@b.kz"} {
		if strings.Contains(out, leak) {
			t.Fatalf("leaked %q in %s", leak, out)
		}
	}
	if !strings.Contains(out, `"k":"fine"`) || !strings.Contains(out, `"deal_id":"d1"`) {
		t.Fatalf("ordinary data lost: %s", out)
	}
}

func TestAnyDeepStructureFailsClosed(t *testing.T) {
	var buf bytes.Buffer
	deep := map[string]any{"a": map[string]any{"b": map[string]any{"c": map[string]any{"d": map[string]any{"e": map[string]any{"f": "+77011234567"}}}}}}
	newTest(&buf).Info("x", "deep", deep)
	if strings.Contains(buf.String(), "+77011234567") {
		t.Fatalf("leaked: %s", buf.String())
	}
}

func TestTraceIDWithTwelveDigitRunSurvives(t *testing.T) {
	var buf bytes.Buffer
	tid, _ := trace.TraceIDFromHex("ab123456789012cdab123456789012cd")
	sid, _ := trace.SpanIDFromHex("ab123456789012cd")
	sc := trace.NewSpanContext(trace.SpanContextConfig{TraceID: tid, SpanID: sid, TraceFlags: trace.FlagsSampled})
	newTest(&buf).InfoContext(trace.ContextWithSpanContext(context.Background(), sc), "x")
	out := buf.String()
	if !strings.Contains(out, `"trace_id":"ab123456789012cdab123456789012cd"`) || !strings.Contains(out, `"span_id":"ab123456789012cd"`) {
		t.Fatalf("trace ids corrupted: %s", out)
	}
}

const uuidWithDigitRun = "0b9c7f2e-1d4a-4e5f-9a8b-123456789012"

func TestUUIDUnderIDNameSurvives(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Info("x", "deal_id", uuidWithDigitRun, "dealId", uuidWithDigitRun)
	if strings.Count(buf.String(), uuidWithDigitRun) != 2 {
		t.Fatalf("id corrupted: %s", buf.String())
	}
}

func TestUUIDInFreeTextMessageIsStillMasked(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Info("deal " + uuidWithDigitRun + " opened")
	if strings.Contains(buf.String(), "123456789012") {
		t.Fatalf("free text must be masked: %s", buf.String())
	}
}

func TestIDSuffixedSensitiveNameStillMasked(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Info("x", "iin_id", "abc")
	if strings.Contains(buf.String(), "abc") {
		t.Fatalf("leaked: %s", buf.String())
	}
}

func TestCallerStringNamedSourceIsPatternMasked(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Info("x", "source", "from +77011234567")
	if strings.Contains(buf.String(), "+77011234567") {
		t.Fatalf("leaked: %s", buf.String())
	}
	if !strings.Contains(buf.String(), `"level":"INFO"`) {
		t.Fatalf("builtin level lost: %s", buf.String())
	}
}

func TestNameVariantsForIPAndGPS(t *testing.T) {
	var buf bytes.Buffer
	newTest(&buf).Info("x", "clientip", "10.1.1.1", "remote_addr", "10.2.2.2", "IPAddr", "10.3.3.3", "latlng", "43.1,76.9", "zip", "050000")
	out := buf.String()
	for _, leak := range []string{"10.1.1.1", "10.2.2.2", "10.3.3.3", "43.1,76.9"} {
		if strings.Contains(out, leak) {
			t.Fatalf("leaked %q: %s", leak, out)
		}
	}
	if !strings.Contains(out, `"zip":"050000"`) {
		t.Fatalf("zip must stay: %s", out)
	}
}

func TestMessageBoundaries(t *testing.T) {
	cases := []struct{ in, want string }{
		{"iin900101300123x", "iin[redacted]x"},
		{"n 9001013001234 n", "n 9001013001234 n"},
		{"tel 8 701 123 45 67 end", "tel [redacted] end"},
		{"tel +7 (701) 123-45-67 end", "tel [redacted] end"},
	}
	for _, c := range cases {
		if got := Redact(c.in); got != c.want {
			t.Errorf("Redact(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// Ключи ПДн плана 2б (поля ИИН/БИН, IBAN, секрет TOTP, ФИО, контакты): значения
// не попадают в лог ни на верхнем уровне, ни в группе, ни в поле структуры.
func TestLoggerMasksPIIKeys(t *testing.T) {
	keys := []string{"iin", "bin_iin", "signer_iin", "iban", "secret", "full_name", "email", "instagram"}
	const value = "pii-value-must-not-leak"
	for _, key := range keys {
		var buf bytes.Buffer
		newTest(&buf).Info("x", key, value, slog.Group("g", key, value), "obj", map[string]any{key: value})
		var rec map[string]any
		if err := json.Unmarshal(buf.Bytes(), &rec); err != nil {
			t.Fatalf("log line is not JSON: %v\n%s", err, buf.String())
		}
		if got := rec[key]; got != "[redacted]" {
			t.Errorf("%s = %#v, want \"[redacted]\"", key, got)
		}
		if strings.Contains(buf.String(), value) {
			t.Errorf("%s leaked: %s", key, buf.String())
		}
	}
}
