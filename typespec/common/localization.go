package common

import (
	"strings"
)

type FrontendLocale string

const (
	EnglishUnitedStates FrontendLocale = "en-US"
	Tamil               FrontendLocale = "ta"
	German              FrontendLocale = "de_DE"
)

type DisplayName string

func IsFrontendLocale(value FrontendLocale) bool {
	return value == EnglishUnitedStates ||
		value == Tamil ||
		value == German
}

func NormalizeDisplayName(value DisplayName) DisplayName {
	return DisplayName(strings.TrimSpace(string(value)))
}

func IsDisplayName(value DisplayName) bool {
	length := len([]rune(NormalizeDisplayName(value)))
	return length >= 1 && length <= 200
}
