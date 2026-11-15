package common

import (
	"strings"
	"unicode/utf8"

	"github.com/moov-io/iso3166"
)

type CountryCode string

type DisplayName string

func IsCountryCode(value CountryCode) bool {
	code := string(value)
	return code == strings.ToUpper(code) && iso3166.ValidAlpha2(code)
}

func NormalizeDisplayName(value DisplayName) DisplayName {
	return DisplayName(strings.TrimSpace(string(value)))
}

func IsDisplayName(value DisplayName) bool {
	normalized := string(NormalizeDisplayName(value))
	length := utf8.RuneCountInString(normalized)
	return length >= 1 && length <= 200 && !strings.ContainsRune(normalized, 0)
}
