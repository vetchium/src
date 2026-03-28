package common

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

type EmailAddress string
type Password string
type LanguageCode string
type DomainName string
type TFACode string
type FullName string
type DNSVerificationToken string
type CountryCode string

// Validation constraints matching common.tsp
const (
	EmailMinLength        = 3
	EmailMaxLength        = 256
	PasswordMinLength     = 12
	PasswordMaxLength     = 64
	LanguageCodeMinLength = 2
	LanguageCodeMaxLength = 10
	DomainMinLength       = 3
	DomainMaxLength       = 255
	TFACodeLength         = 6
	FullNameMinLength     = 1
	FullNameMaxLength     = 128
)

var emailPattern = regexp.MustCompile(`^[a-zA-Z0-9._%\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
var languageCodePattern = regexp.MustCompile(`^[a-z]{2}(-[A-Z]{2})?$`)
var domainNamePattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$`)
var fullNamePattern = regexp.MustCompile(`^[\pL\pM\s'-]+$`)

// Supported languages (BCP 47 tags)
var SupportedLanguages = []LanguageCode{"en-US", "de-DE", "ta-IN"}

const DefaultLanguage LanguageCode = "en-US"

// Validation errors for base types (no field context - that's the caller's job)
// ErrInvalidCountryCode is returned when a code is not a valid ISO 3166-1 alpha-2 code.
var ErrInvalidCountryCode = errors.New("must be a valid ISO 3166-1 alpha-2 country code")

// ValidCountryCodes is the complete set of ISO 3166-1 alpha-2 country codes.
var ValidCountryCodes = map[string]bool{
	"AD": true, "AE": true, "AF": true, "AG": true, "AI": true, "AL": true,
	"AM": true, "AO": true, "AQ": true, "AR": true, "AS": true, "AT": true,
	"AU": true, "AW": true, "AX": true, "AZ": true, "BA": true, "BB": true,
	"BD": true, "BE": true, "BF": true, "BG": true, "BH": true, "BI": true,
	"BJ": true, "BL": true, "BM": true, "BN": true, "BO": true, "BQ": true,
	"BR": true, "BS": true, "BT": true, "BV": true, "BW": true, "BY": true,
	"BZ": true, "CA": true, "CC": true, "CD": true, "CF": true, "CG": true,
	"CH": true, "CI": true, "CK": true, "CL": true, "CM": true, "CN": true,
	"CO": true, "CR": true, "CU": true, "CV": true, "CW": true, "CX": true,
	"CY": true, "CZ": true, "DE": true, "DJ": true, "DK": true, "DM": true,
	"DO": true, "DZ": true, "EC": true, "EE": true, "EG": true, "EH": true,
	"ER": true, "ES": true, "ET": true, "FI": true, "FJ": true, "FK": true,
	"FM": true, "FO": true, "FR": true, "GA": true, "GB": true, "GD": true,
	"GE": true, "GF": true, "GG": true, "GH": true, "GI": true, "GL": true,
	"GM": true, "GN": true, "GP": true, "GQ": true, "GR": true, "GS": true,
	"GT": true, "GU": true, "GW": true, "GY": true, "HK": true, "HM": true,
	"HN": true, "HR": true, "HT": true, "HU": true, "ID": true, "IE": true,
	"IL": true, "IM": true, "IN": true, "IO": true, "IQ": true, "IR": true,
	"IS": true, "IT": true, "JE": true, "JM": true, "JO": true, "JP": true,
	"KE": true, "KG": true, "KH": true, "KI": true, "KM": true, "KN": true,
	"KP": true, "KR": true, "KW": true, "KY": true, "KZ": true, "LA": true,
	"LB": true, "LC": true, "LI": true, "LK": true, "LR": true, "LS": true,
	"LT": true, "LU": true, "LV": true, "LY": true, "MA": true, "MC": true,
	"MD": true, "ME": true, "MF": true, "MG": true, "MH": true, "MK": true,
	"ML": true, "MM": true, "MN": true, "MO": true, "MP": true, "MQ": true,
	"MR": true, "MS": true, "MT": true, "MU": true, "MV": true, "MW": true,
	"MX": true, "MY": true, "MZ": true, "NA": true, "NC": true, "NE": true,
	"NF": true, "NG": true, "NI": true, "NL": true, "NO": true, "NP": true,
	"NR": true, "NU": true, "NZ": true, "OM": true, "PA": true, "PE": true,
	"PF": true, "PG": true, "PH": true, "PK": true, "PL": true, "PM": true,
	"PN": true, "PR": true, "PS": true, "PT": true, "PW": true, "PY": true,
	"QA": true, "RE": true, "RO": true, "RS": true, "RU": true, "RW": true,
	"SA": true, "SB": true, "SC": true, "SD": true, "SE": true, "SG": true,
	"SH": true, "SI": true, "SJ": true, "SK": true, "SL": true, "SM": true,
	"SN": true, "SO": true, "SR": true, "SS": true, "ST": true, "SV": true,
	"SX": true, "SY": true, "SZ": true, "TC": true, "TD": true, "TF": true,
	"TG": true, "TH": true, "TJ": true, "TK": true, "TL": true, "TM": true,
	"TN": true, "TO": true, "TR": true, "TT": true, "TV": true, "TW": true,
	"TZ": true, "UA": true, "UG": true, "UM": true, "US": true, "UY": true,
	"UZ": true, "VA": true, "VC": true, "VE": true, "VG": true, "VI": true,
	"VN": true, "VU": true, "WF": true, "WS": true, "YE": true, "YT": true,
	"ZA": true, "ZM": true, "ZW": true,
}

// ValidateCountryCode returns an error if code is not a valid ISO 3166-1 alpha-2 code.
func ValidateCountryCode(code string) error {
	if !ValidCountryCodes[code] {
		return ErrInvalidCountryCode
	}
	return nil
}

// ValidateCountryCodes validates a slice of country codes and returns ValidationErrors.
func ValidateCountryCodes(field string, codes []string) []ValidationError {
	var errs []ValidationError
	for _, code := range codes {
		if err := ValidateCountryCode(code); err != nil {
			errs = append(errs, NewValidationError(field, fmt.Errorf("invalid country code %q: %w", code, err)))
			break
		}
	}
	return errs
}

var (
	ErrEmailTooShort            = errors.New("must be at least 3 characters")
	ErrEmailTooLong             = errors.New("must be at most 256 characters")
	ErrEmailInvalidFormat       = errors.New("must be a valid email address")
	ErrPasswordTooShort         = errors.New("must be at least 12 characters")
	ErrPasswordTooLong          = errors.New("must be at most 64 characters")
	ErrRequired                 = errors.New("is required")
	ErrTFACodeInvalidLength     = errors.New("must be exactly 6 characters")
	ErrTFACodeInvalidFormat     = errors.New("must contain only digits")
	ErrLanguageCodeInvalid      = errors.New("must be a valid language code")
	ErrLanguageNotSupported     = errors.New("language not supported")
	ErrDomainTooShort           = errors.New("must be at least 3 characters")
	ErrDomainTooLong            = errors.New("must be at most 255 characters")
	ErrDomainInvalidFormat      = errors.New("must be a valid domain name in lowercase")
	ErrPersonalEmailDomain      = errors.New("personal email addresses are not allowed for employer signup")
	ErrFullNameTooShort         = errors.New("must be at least 1 character")
	ErrFullNameTooLong          = errors.New("must be at most 128 characters")
	ErrFullNameInvalidFormat    = errors.New("may only contain letters, spaces, hyphens, and apostrophes")
	ErrFullNameOnlyWhitespace   = errors.New("cannot be only whitespace")
	ErrNewPasswordSameAsCurrent = errors.New("new password must be different from current password")
)

// PersonalEmailDomains contains major free email providers that should not be used for professional accounts
var PersonalEmailDomains = []string{
	"gmail.com",
	"googlemail.com",
	"yahoo.com",
	"yahoo.co.in",
	"yahoo.co.uk",
	"yahoo.de",
	"yahoo.fr",
	"yahoo.ca",
	"yahoo.com.au",
	"yahoo.com.br",
	"yahoo.co.jp",
	"ymail.com",
	"hotmail.com",
	"hotmail.co.uk",
	"hotmail.de",
	"hotmail.fr",
	"outlook.com",
	"outlook.in",
	"live.com",
	"live.in",
	"msn.com",
	"aol.com",
	"protonmail.com",
	"proton.me",
	"icloud.com",
	"me.com",
	"mac.com",
	"mail.com",
	"zoho.com",
	"yandex.com",
	"yandex.ru",
	"gmx.com",
	"gmx.de",
	"gmx.net",
	"web.de",
	"rediffmail.com",
	"fastmail.com",
	"tutanota.com",
	"hey.com",
}

// GetEmailDomain extracts the domain from an email address (returns lowercase)
func GetEmailDomain(email EmailAddress) string {
	atIndex := strings.Index(string(email), "@")
	if atIndex == -1 {
		return ""
	}
	return strings.ToLower(string(email)[atIndex+1:])
}

// IsPersonalEmailDomain checks if the email domain is a personal email provider
func IsPersonalEmailDomain(email EmailAddress) bool {
	domain := GetEmailDomain(email)
	for _, blocked := range PersonalEmailDomains {
		if domain == blocked {
			return true
		}
	}
	return false
}

// ValidateEmployerEmail validates email for employer signup (blocks personal email domains)
func ValidateEmployerEmail(email EmailAddress) error {
	// First run standard email validation
	if err := email.Validate(); err != nil {
		return err
	}

	// Then check for personal email domains
	if IsPersonalEmailDomain(email) {
		return ErrPersonalEmailDomain
	}

	return nil
}

// ValidationError represents a validation failure with field context
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (v ValidationError) Error() string {
	return fmt.Sprintf("%s: %s", v.Field, v.Message)
}

// NewValidationError creates a ValidationError by combining field name with a base error
func NewValidationError(field string, err error) ValidationError {
	return ValidationError{Field: field, Message: err.Error()}
}

// Validate checks if the email address meets constraints (returns error without field context)
func (e EmailAddress) Validate() error {
	if len(e) < EmailMinLength {
		return ErrEmailTooShort
	}
	if len(e) > EmailMaxLength {
		return ErrEmailTooLong
	}
	if !emailPattern.MatchString(string(e)) {
		return ErrEmailInvalidFormat
	}
	return nil
}

// Validate checks if the password meets constraints (returns error without field context)
func (p Password) Validate() error {
	if len(p) < PasswordMinLength {
		return ErrPasswordTooShort
	}
	if len(p) > PasswordMaxLength {
		return ErrPasswordTooLong
	}

	// Check complexity
	s := string(p)
	hasUpper := false
	hasLower := false
	hasNumber := false
	hasSpecial := false

	for _, char := range s {
		switch {
		case char >= 'A' && char <= 'Z':
			hasUpper = true
		case char >= 'a' && char <= 'z':
			hasLower = true
		case char >= '0' && char <= '9':
			hasNumber = true
		case strings.ContainsRune("!@#$%^&*()_+-=[]{}|;:,.<>?", char):
			hasSpecial = true
		}
	}

	if !hasUpper || !hasLower || !hasNumber || !hasSpecial {
		return errors.New("must contain at least one uppercase letter, one lowercase letter, one number, and one special character")
	}

	return nil
}

// Validate checks if the language code meets constraints (returns error without field context)
func (l LanguageCode) Validate() error {
	if !languageCodePattern.MatchString(string(l)) {
		return ErrLanguageCodeInvalid
	}
	for _, supported := range SupportedLanguages {
		if l == supported {
			return nil
		}
	}
	return ErrLanguageNotSupported
}

// Validate checks if the domain name meets constraints (returns error without field context)
func (d DomainName) Validate() error {
	domainStr := string(d)
	if len(domainStr) < DomainMinLength {
		return ErrDomainTooShort
	}
	if len(domainStr) > DomainMaxLength {
		return ErrDomainTooLong
	}
	// Check if lowercase
	if domainStr != strings.ToLower(domainStr) {
		return ErrDomainInvalidFormat
	}
	if !domainNamePattern.MatchString(domainStr) {
		return ErrDomainInvalidFormat
	}
	return nil
}

// Validate checks if the TFA code meets constraints (returns error without field context)
func (c TFACode) Validate() error {
	if len(c) != TFACodeLength {
		return ErrTFACodeInvalidLength
	}
	for _, ch := range c {
		if ch < '0' || ch > '9' {
			return ErrTFACodeInvalidFormat
		}
	}
	return nil
}

// Validate checks if the full name meets constraints (returns error without field context)
func (f FullName) Validate() error {
	if len(f) < FullNameMinLength {
		return ErrFullNameTooShort
	}
	if len(f) > FullNameMaxLength {
		return ErrFullNameTooLong
	}
	// Check if only whitespace
	if len(strings.TrimSpace(string(f))) == 0 {
		return ErrFullNameOnlyWhitespace
	}
	if !fullNamePattern.MatchString(string(f)) {
		return ErrFullNameInvalidFormat
	}
	return nil
}
