package common

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

type OpaqueToken string
type TOTPCode string
type TOTPRecoveryCode string
type TOTPEnrollmentToken OpaqueToken
type TOTPManualEntryKey string
type TOTPRecoveryCodeCount int32
type NewPassword string

type TOTPConfiguration struct {
	Algorithm             string `json:"algorithm"`
	Digits                int32  `json:"digits"`
	PeriodSeconds         int32  `json:"period_seconds"`
	AllowedClockSkewSteps int32  `json:"allowed_clock_skew_steps"`
}

var (
	totpCodePattern        = regexp.MustCompile(`^[0-9]{6}$`)
	recoveryCodePattern    = regexp.MustCompile(`^[A-Za-z0-9 -]+$`)
	totpManualEntryPattern = regexp.MustCompile(`^[A-Z2-7]+$`)
)

func IsOpaqueToken(value string) bool {
	length := utf8.RuneCountInString(value)
	return length >= 32 && length <= 4096
}

func IsTOTPCode(value TOTPCode) bool {
	return totpCodePattern.MatchString(string(value))
}

func IsTOTPRecoveryCode(value TOTPRecoveryCode) bool {
	length := len(value)
	return length >= 8 && length <= 128 &&
		recoveryCodePattern.MatchString(string(value))
}

func IsTOTPManualEntryKey(value TOTPManualEntryKey) bool {
	length := len(value)
	return length >= 16 && length <= 128 &&
		totpManualEntryPattern.MatchString(string(value))
}

func IsNewPassword(value NewPassword) bool {
	length := len([]rune(value))
	if length < 15 || length > 128 {
		return false
	}
	_, prohibited := prohibitedPasswords[strings.ToLower(string(value))]
	return !prohibited
}

var prohibitedPasswords = map[string]struct{}{
	"123456789012345":              {},
	"correct horse battery staple": {},
	"passwordpassword":             {},
	"qwertyuiopasdfg":              {},
}

func StandardTOTPConfiguration() TOTPConfiguration {
	return TOTPConfiguration{
		Algorithm:             "SHA1",
		Digits:                6,
		PeriodSeconds:         30,
		AllowedClockSkewSteps: 1,
	}
}
