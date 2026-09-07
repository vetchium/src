package common

import (
	"strings"

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
	length := len([]rune(NormalizeDisplayName(value)))
	return length >= 1 && length <= 200
}
