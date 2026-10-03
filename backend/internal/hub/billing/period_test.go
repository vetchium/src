package billing

import (
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

func date(year int, month time.Month, day, hour int) time.Time {
	return time.Date(year, month, day, hour, 0, 0, 0, time.UTC)
}

func TestIntervalsMapToCalendarMonths(t *testing.T) {
	t.Parallel()
	anchor := time.Date(2027, time.January, 31, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		interval subscriptionspec.BillingInterval
		want     time.Time
	}{
		{subscriptionspec.Month, time.Date(2027, time.February, 28, 12, 0, 0, 0, time.UTC)},
		{subscriptionspec.Year, time.Date(2028, time.January, 31, 12, 0, 0, 0, time.UTC)},
	}
	for _, testCase := range cases {
		if got := Boundary(anchor, testCase.interval, 1); !got.Equal(testCase.want) {
			t.Fatalf("Boundary(%s) = %v, want %v", testCase.interval, got, testCase.want)
		}
		start, end := PeriodContaining(anchor, testCase.interval, anchor)
		if !start.Equal(anchor) || !end.Equal(testCase.want) {
			t.Fatalf("PeriodContaining(%s) = %v, %v", testCase.interval, start, end)
		}
	}
}
