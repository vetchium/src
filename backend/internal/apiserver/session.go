package apiserver

import "time"

// SessionDurations models the session lifetimes shared by portal servers.
// Portals without a remembered-session option leave Remembered unset.
type SessionDurations struct {
	Default    time.Duration
	Remembered time.Duration
}

func (d SessionDurations) Duration(remembered bool) time.Duration {
	if remembered && d.Remembered != 0 {
		return d.Remembered
	}
	return d.Default
}

func (d SessionDurations) Shortest() time.Duration {
	if d.Remembered != 0 && d.Remembered < d.Default {
		return d.Remembered
	}
	return d.Default
}
