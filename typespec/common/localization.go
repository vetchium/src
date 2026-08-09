package common

import (
	_ "embed"
	"regexp"
	"strings"
	"time"
)

type RegionalLanguageCode string
type TimeZoneID string
type DisplayName string

type LocalizedDisplayName struct {
	LanguageCode RegionalLanguageCode `json:"language_code"`
	DisplayName  DisplayName          `json:"display_name"`
}

var regionalLanguageCodePattern = regexp.MustCompile(`^[a-z]{2}-[A-Z]{2}$`)

func IsRegionalLanguageCode(value RegionalLanguageCode) bool {
	text := string(value)
	if !regionalLanguageCodePattern.MatchString(text) {
		return false
	}
	return canonicalLanguageSubtags[text[:2]] && canonicalRegionSubtags[text[3:]]
}

func IsTimeZoneID(value TimeZoneID) bool {
	text := string(value)
	if text == "" || len(text) > 255 || !strings.Contains(text, "/") {
		return false
	}
	if text == "Etc/UTC" {
		return true
	}
	if !canonicalTimeZoneIDs[text] {
		return false
	}
	_, err := time.LoadLocation(text)
	return err == nil
}

func NormalizeDisplayName(value DisplayName) DisplayName {
	return DisplayName(strings.TrimSpace(string(value)))
}

func IsDisplayName(value DisplayName) bool {
	length := len([]rune(NormalizeDisplayName(value)))
	return length >= 1 && length <= 200
}

//go:embed canonical-time-zones.txt
var canonicalTimeZoneData string

var canonicalTimeZoneIDs = func() map[string]bool {
	result := make(map[string]bool)
	for _, value := range strings.Fields(canonicalTimeZoneData) {
		result[value] = true
	}
	return result
}()

// These sorted sources contain the non-private two-letter language and region
// records from the IANA Language Subtag Registry.
//
//go:embed canonical-language-subtags.txt
var canonicalLanguageSubtagData string

//go:embed canonical-region-subtags.txt
var canonicalRegionSubtagData string

var canonicalLanguageSubtags = canonicalSubtagSet(canonicalLanguageSubtagData)
var canonicalRegionSubtags = canonicalSubtagSet(canonicalRegionSubtagData)

func canonicalSubtagSet(data string) map[string]bool {
	result := make(map[string]bool)
	for _, value := range strings.Fields(data) {
		result[value] = true
	}
	return result
}
