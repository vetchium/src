package adminapi

import "time"

const maxRateLimitEntries = 4096

type rateLimitEntry struct {
	windowStarted time.Time
	count         int
}

func (s *Server) AllowRequest(
	key string, limit int, window time.Duration,
) (bool, time.Duration) {
	now := s.CurrentTime()
	s.rateLimitMu.Lock()
	defer s.rateLimitMu.Unlock()
	if s.rateLimits == nil {
		s.rateLimits = make(map[string]rateLimitEntry)
	}
	for existingKey, existingEntry := range s.rateLimits {
		if !now.Before(existingEntry.windowStarted.Add(window)) {
			delete(s.rateLimits, existingKey)
		}
	}
	if _, exists := s.rateLimits[key]; !exists &&
		len(s.rateLimits) >= maxRateLimitEntries {
		return false, window
	}
	entry := s.rateLimits[key]
	if entry.windowStarted.IsZero() ||
		!now.Before(entry.windowStarted.Add(window)) {
		entry = rateLimitEntry{windowStarted: now}
	}
	if entry.count >= limit {
		return false, entry.windowStarted.Add(window).Sub(now)
	}
	entry.count++
	s.rateLimits[key] = entry
	return true, 0
}
