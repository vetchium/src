package globalcoordinator

import "regexp"

type ShortID string

type GenerateShortIDResponse struct {
	ShortID ShortID `json:"short_id"`
}

var shortIDPattern = regexp.MustCompile(`^[0-9a-hjkmnp-tv-z]{11}$`)

func IsShortID(value ShortID) bool {
	return shortIDPattern.MatchString(string(value))
}
