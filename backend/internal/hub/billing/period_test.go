package billing

import (
	"testing"
	"time"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
)

func date(year int, month time.Month, day, hour int) time.Time {
	return time.Date(year, month, day, hour, 0, 0, 0, time.UTC)
}

func TestBoundaryClampsToMonthEnd(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 31, 12)
	cases := []struct {
		n    int
		want time.Time
	}{
		{0, date(2027, time.January, 31, 12)},
		{1, date(2027, time.February, 28, 12)},
		{2, date(2027, time.March, 31, 12)},
		{3, date(2027, time.April, 30, 12)},
	}
	for _, testCase := range cases {
		got := Boundary(anchor, subscriptionspec.Month, testCase.n)
		if !got.Equal(testCase.want) {
			t.Fatalf(
				"Boundary(n=%d) = %v, want %v", testCase.n, got, testCase.want,
			)
		}
	}
}

func TestBoundaryLeapYearMonthlyAnchor(t *testing.T) {
	t.Parallel()
	anchor := date(2028, time.January, 31, 12)
	got := Boundary(anchor, subscriptionspec.Month, 1)
	want := date(2028, time.February, 29, 12)
	if !got.Equal(want) {
		t.Fatalf("Boundary(n=1) = %v, want %v", got, want)
	}
}

func TestBoundaryLeapYearAnnualAnchor(t *testing.T) {
	t.Parallel()
	anchor := date(2028, time.February, 29, 0)
	cases := []struct {
		n    int
		want time.Time
	}{
		{1, date(2029, time.February, 28, 0)},
		{4, date(2032, time.February, 29, 0)},
	}
	for _, testCase := range cases {
		got := Boundary(anchor, subscriptionspec.Year, testCase.n)
		if !got.Equal(testCase.want) {
			t.Fatalf(
				"Boundary(n=%d) = %v, want %v", testCase.n, got, testCase.want,
			)
		}
	}
}

func TestBoundaryPreservesTimeOfDayAndUTC(t *testing.T) {
	t.Parallel()
	loc := time.FixedZone("test", -7*3600)
	anchor := time.Date(2027, time.March, 15, 9, 30, 15, 0, loc)
	got := Boundary(anchor, subscriptionspec.Month, 1)
	if got.Location() != time.UTC {
		t.Fatalf("location = %v, want UTC", got.Location())
	}
	want := time.Date(2027, time.April, 15, 16, 30, 15, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("Boundary() = %v, want %v", got, want)
	}
}

func TestPeriodContaining(t *testing.T) {
	t.Parallel()
	anchor := date(2027, time.January, 1, 0)
	clampedAnchor := date(2027, time.January, 31, 0)
	cases := []struct {
		name      string
		anchor    time.Time
		at        time.Time
		wantStart time.Time
		wantEnd   time.Time
	}{
		{
			"on boundary", anchor, anchor,
			anchor, date(2027, time.February, 1, 0),
		},
		{
			"just before anchor clamps to n=0", anchor,
			anchor.Add(-time.Microsecond),
			anchor, date(2027, time.February, 1, 0),
		},
		{
			"many periods later", anchor, date(2027, time.June, 15, 0),
			date(2027, time.June, 1, 0), date(2027, time.July, 1, 0),
		},
		{
			"on a clamped boundary", clampedAnchor, date(2027, time.February, 28, 0),
			date(2027, time.February, 28, 0), date(2027, time.March, 31, 0),
		},
		{
			"one microsecond before a later boundary", anchor,
			date(2027, time.July, 1, 0).Add(-time.Microsecond),
			date(2027, time.June, 1, 0), date(2027, time.July, 1, 0),
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			start, end := PeriodContaining(
				testCase.anchor, subscriptionspec.Month, testCase.at,
			)
			if !start.Equal(testCase.wantStart) || !end.Equal(testCase.wantEnd) {
				t.Fatalf(
					"PeriodContaining() = %v, %v, want %v, %v",
					start, end, testCase.wantStart, testCase.wantEnd,
				)
			}
		})
	}
}
