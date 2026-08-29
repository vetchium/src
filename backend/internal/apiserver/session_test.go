package apiserver

import (
	"testing"
	"time"
)

func TestSessionDurations(t *testing.T) {
	durations := SessionDurations{
		Default: time.Hour, Remembered: 24 * time.Hour,
	}
	if got := durations.Duration(false); got != time.Hour {
		t.Fatalf("default duration = %v", got)
	}
	if got := durations.Duration(true); got != 24*time.Hour {
		t.Fatalf("remembered duration = %v", got)
	}
	if got := durations.Shortest(); got != time.Hour {
		t.Fatalf("shortest duration = %v", got)
	}

	single := SessionDurations{Default: 30 * time.Minute}
	if got := single.Duration(true); got != 30*time.Minute {
		t.Fatalf("single duration remembered fallback = %v", got)
	}
	if got := single.Shortest(); got != 30*time.Minute {
		t.Fatalf("single shortest duration = %v", got)
	}
}
