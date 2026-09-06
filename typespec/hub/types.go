package hub

import "regexp"

type HubUserDID string
type HubHandle string

var hubHandlePattern = regexp.MustCompile(
	`^[a-z0-9]{5}-[0-9a-hjkmnp-tv-z]{11}$`,
)

func IsHubUserDID(value HubUserDID) bool {
	text := string(value)
	return len(text) == 36 && text[14] == '7' && isUUID(text)
}

func IsHubHandle(value HubHandle) bool {
	return hubHandlePattern.MatchString(string(value))
}

func isUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		switch index {
		case 8, 13, 18, 23:
			if character != '-' {
				return false
			}
		default:
			switch {
			case character >= '0' && character <= '9':
			case character >= 'a' && character <= 'f':
			case character >= 'A' && character <= 'F':
			default:
				return false
			}
		}
	}
	return true
}
