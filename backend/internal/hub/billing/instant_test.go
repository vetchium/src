package billing

import (
	"testing"
	"time"
)

func TestInstantTruncatesAndConvertsToUTC(t *testing.T) {
	t.Parallel()
	loc := time.FixedZone("test", 5*3600)
	in := time.Date(2026, time.September, 13, 10, 0, 0, 123456789, loc)
	got := Instant(in)
	if got.Location() != time.UTC {
		t.Fatalf("location = %v, want UTC", got.Location())
	}
	want := time.Date(2026, time.September, 13, 5, 0, 0, 123456000, time.UTC)
	if !got.Equal(want) || got.Nanosecond() != want.Nanosecond() {
		t.Fatalf("Instant() = %v, want %v", got, want)
	}
}
