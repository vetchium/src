package dbvalue

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestNewUUIDIsVersion4(t *testing.T) {
	t.Parallel()
	value, err := NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	if !value.Valid {
		t.Fatal("generated UUID is not valid")
	}
	if version := value.Bytes[6] >> 4; version != 4 {
		t.Fatalf("version = %d, want 4", version)
	}
	if variant := value.Bytes[8] >> 6; variant != 0b10 {
		t.Fatalf("variant = %b, want 10", variant)
	}
}

func TestNewUUIDv7IsTimeOrdered(t *testing.T) {
	t.Parallel()
	earlier := time.Date(2026, time.August, 24, 12, 0, 0, 0, time.UTC)
	first, err := NewUUIDv7(earlier)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewUUIDv7(earlier.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if version := first.Bytes[6] >> 4; version != 7 {
		t.Fatalf("version = %d, want 7", version)
	}
	if variant := first.Bytes[8] >> 6; variant != 0b10 {
		t.Fatalf("variant = %b, want 10", variant)
	}
	if string(first.Bytes[:6]) >= string(second.Bytes[:6]) {
		t.Fatal("a later timestamp did not sort after an earlier one")
	}
}

func TestNewUUIDv7RejectsOutOfRangeTimestamps(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name string
		now  time.Time
	}{
		{"before the epoch", time.Date(1969, time.July, 20, 0, 0, 0, 0, time.UTC)},
		{"beyond 48 bits", time.Date(300000, time.January, 1, 0, 0, 0, 0, time.UTC)},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if _, err := NewUUIDv7(test.now); err == nil {
				t.Fatal("NewUUIDv7() accepted an out-of-range timestamp")
			}
		})
	}
}

func TestUUIDFormattingRoundTrips(t *testing.T) {
	t.Parallel()
	value, err := NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseUUID(FormatUUID(value))
	if err != nil {
		t.Fatal(err)
	}
	if parsed != value {
		t.Fatalf("parsed = %v, want %v", parsed, value)
	}
	if got := FormatUUID(pgtype.UUID{}); got != "" {
		t.Fatalf("FormatUUID(invalid) = %q, want an empty string", got)
	}
	for _, malformed := range []string{"", "not-a-uuid"} {
		if _, err := ParseUUID(malformed); err == nil {
			t.Fatalf("ParseUUID(%q) succeeded", malformed)
		}
	}
}

func TestNullableConversions(t *testing.T) {
	t.Parallel()
	if got := Text("value"); !got.Valid || got.String != "value" {
		t.Fatalf("Text() = %+v", got)
	}
	if got := NullText(nil); got.Valid {
		t.Fatal("NullText(nil) is not NULL")
	}
	value := "value"
	if got := NullText(&value); !got.Valid || got.String != value {
		t.Fatalf("NullText() = %+v", got)
	}
	if got := NullBool(nil); got.Valid {
		t.Fatal("NullBool(nil) is not NULL")
	}
	enabled := true
	if got := NullBool(&enabled); !got.Valid || !got.Bool {
		t.Fatalf("NullBool() = %+v", got)
	}
}

func TestTimestampNormalizesToUTC(t *testing.T) {
	t.Parallel()
	zone := time.FixedZone("IST", 5*3600+1800)
	got := Timestamp(time.Date(2026, time.August, 29, 12, 0, 0, 0, zone))
	if got.Time.Location() != time.UTC {
		t.Fatalf("location = %v, want UTC", got.Time.Location())
	}
	if got.Time.Hour() != 6 || got.Time.Minute() != 30 {
		t.Fatalf("time = %v, want 06:30 UTC", got.Time)
	}
}
