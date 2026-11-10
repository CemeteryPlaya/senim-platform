package internal

import (
	"time"
	// База часовых поясов внутри бинарника: образ distroless без /usr/share/zoneinfo.
	_ "time/tzdata"
)

// revocationWorkdays — срок ответа на отзыв согласия: 15 рабочих дней (ст. 8 п. 7 Закона
// РК № 94-V «О персональных данных и их защите»; Правила 395/НҚ, п. 6-3).
const revocationWorkdays = 15

// almaty — часовой пояс, по которому считаются рабочие дни (с 01.03.2024 — UTC+5).
var almaty = mustLoadLocation("Asia/Almaty")

func mustLoadLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic("identity: часовой пояс " + name + ": " + err.Error())
	}
	return loc
}

// addWorkdays прибавляет к t n рабочих дней (понедельник–пятница) по часам loc, сохраняя
// время суток: пятница + 1 — понедельник, суббота + 1 — тоже понедельник. День недели
// берётся по loc, а не по UTC: 19:30 UTC пятницы в Алматы — уже суббота. Праздничные дни
// РК не учитываются (TODO: производственный календарь, когда появится источник).
func addWorkdays(t time.Time, n int, loc *time.Location) time.Time {
	d := t.In(loc)
	for n > 0 {
		d = d.AddDate(0, 0, 1)
		if wd := d.Weekday(); wd != time.Saturday && wd != time.Sunday {
			n--
		}
	}
	return d
}

// revocationDue — срок исполнения заявки на отзыв, поданной в момент requested.
func revocationDue(requested time.Time) time.Time {
	return addWorkdays(requested, revocationWorkdays, almaty)
}
