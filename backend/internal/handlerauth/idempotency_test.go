package handlerauth

import (
	"testing"
	"time"

	"backend/internal/apiserver"
)

func TestLoginReplayExpiresAtNeverOutlivesAnySession(t *testing.T) {
	now := time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name      string
		durations apiserver.SessionDurations
		want      time.Time
	}{
		{
			name: "ordinary replay window",
			durations: apiserver.SessionDurations{
				Default: time.Hour, Remembered: 24 * time.Hour,
			},
			want: now.Add(LoginReplayWindow),
		},
		{
			name: "short browser session",
			durations: apiserver.SessionDurations{
				Default: 30 * time.Second, Remembered: 24 * time.Hour,
			},
			want: now.Add(30 * time.Second),
		},
		{
			name: "short remembered session",
			durations: apiserver.SessionDurations{
				Default: time.Hour, Remembered: 45 * time.Second,
			},
			want: now.Add(45 * time.Second),
		},
		{
			// The admin portal issues no remembered session, so the single
			// lifetime is the one that bounds the window.
			name:      "portal without a remembered session",
			durations: apiserver.SessionDurations{Default: 30 * time.Second},
			want:      now.Add(30 * time.Second),
		},
		{
			name:      "portal without a remembered session, long lifetime",
			durations: apiserver.SessionDurations{Default: 24 * time.Hour},
			want:      now.Add(LoginReplayWindow),
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := LoginReplayExpiresAt(test.durations, now)
			if got != test.want {
				t.Fatalf("replay expiry = %v, want %v", got, test.want)
			}
		})
	}
}
