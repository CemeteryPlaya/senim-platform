package internal

import (
	"testing"
	"time"
)

func almatyLoc(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Almaty")
	if err != nil {
		t.Fatalf("Asia/Almaty: %v", err)
	}
	return loc
}

func TestAlmatyZoneLoads(t *testing.T) {
	// С 01.03.2024 весь Казахстан живёт по UTC+5: без свежей tzdata вышло бы +6.
	_, off := time.Date(2026, 11, 11, 12, 0, 0, 0, almaty).Zone()
	if off != 5*3600 {
		t.Fatalf("смещение Алматы %d с, want 5 ч", off)
	}
}

func TestAddWorkdays(t *testing.T) {
	loc := almatyLoc(t)
	at := func(y int, m time.Month, d, hh, mm int) time.Time { return time.Date(y, m, d, hh, mm, 0, 0, loc) }
	cases := []struct {
		name string
		from time.Time
		n    int
		want time.Time
	}{
		{"ноль дней — тот же момент", at(2026, 11, 11, 10, 0), 0, at(2026, 11, 11, 10, 0)},
		{"среда + 1 — четверг", at(2026, 11, 11, 10, 0), 1, at(2026, 11, 12, 10, 0)},
		{"пятница + 1 — понедельник", at(2026, 11, 13, 15, 30), 1, at(2026, 11, 16, 15, 30)},
		{"суббота + 1 — понедельник", at(2026, 11, 14, 9, 0), 1, at(2026, 11, 16, 9, 0)},
		{"воскресенье + 1 — понедельник", at(2026, 11, 15, 9, 0), 1, at(2026, 11, 16, 9, 0)},
		{"суббота + 15 — третья пятница", at(2026, 11, 14, 12, 0), 15, at(2026, 12, 4, 12, 0)},
		{"среда + 15 — среда через три недели", at(2026, 11, 11, 10, 0), 15, at(2026, 12, 2, 10, 0)},
		{"через смену года", at(2026, 12, 31, 18, 0), 1, at(2027, 1, 1, 18, 0)},
		{"пятница перед Новым годом", at(2027, 1, 1, 18, 0), 1, at(2027, 1, 4, 18, 0)},
	}
	for _, c := range cases {
		got := addWorkdays(c.from, c.n, loc)
		if !got.Equal(c.want) {
			t.Errorf("%s: %s, want %s", c.name, got.In(loc), c.want)
		}
		if wd := got.In(loc).Weekday(); wd == time.Saturday || wd == time.Sunday {
			t.Errorf("%s: срок в выходной %s", c.name, got.In(loc))
		}
	}
}

// TestAddWorkdaysAlmatyMidnight — день недели считается по Алматы, а не по UTC: пятница
// 19:30 UTC в Алматы уже суббота 00:30, и следующий рабочий день — понедельник 00:30 по
// Алматы (воскресенье 19:30 UTC), а не понедельник 19:30 UTC.
func TestAddWorkdaysAlmatyMidnight(t *testing.T) {
	loc := almatyLoc(t)
	fridayUTC := time.Date(2026, 11, 13, 19, 30, 0, 0, time.UTC)
	if wd := fridayUTC.In(loc).Weekday(); wd != time.Saturday {
		t.Fatalf("в Алматы %s, want суббота", wd)
	}
	got := addWorkdays(fridayUTC, 1, loc)
	want := time.Date(2026, 11, 16, 0, 30, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("суббота по Алматы + 1: %s, want %s", got.In(loc), want)
	}
	if got.UTC() != time.Date(2026, 11, 15, 19, 30, 0, 0, time.UTC) {
		t.Fatalf("в UTC %s", got.UTC())
	}

	// Четверг 19:30 UTC — в Алматы пятница 00:30: + 1 — понедельник 00:30 по Алматы.
	thursdayUTC := time.Date(2026, 11, 12, 19, 30, 0, 0, time.UTC)
	got = addWorkdays(thursdayUTC, 1, loc)
	if want := time.Date(2026, 11, 16, 0, 30, 0, 0, loc); !got.Equal(want) {
		t.Fatalf("пятница по Алматы + 1: %s, want %s", got.In(loc), want)
	}

	// Срок отзыва — от момента заявки по Алматы.
	if due := revocationDue(fridayUTC); !due.Equal(addWorkdays(fridayUTC, 15, loc)) {
		t.Fatalf("revocationDue: %s", due)
	}
}
