package orgs

import (
	"regexp"
	"strings"

	"github.com/vetchium/src/typespec/common"
)

type FrontendLocale string

const (
	EnglishUnitedStates FrontendLocale = "en-US"
	Tamil               FrontendLocale = "ta"
	German              FrontendLocale = "de-DE"
)

func FrontendLocales() []FrontendLocale {
	return []FrontendLocale{EnglishUnitedStates, Tamil, German}
}

func IsFrontendLocale(value FrontendLocale) bool {
	for _, locale := range FrontendLocales() {
		if value == locale {
			return true
		}
	}
	return false
}

type OrgDID string

var orgDIDPattern = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`,
)

func IsOrgDID(value OrgDID) bool {
	return orgDIDPattern.MatchString(string(value))
}

type OrgDomain string

var letterPattern = regexp.MustCompile(`[a-z]`)

func NormalizeOrgDomain(value OrgDomain) OrgDomain {
	return OrgDomain(common.NormalizeProfessionalDomain(
		common.ProfessionalDomain(value),
	))
}

// IsOrgDomain accepts a value only in its normalized form, so storage and
// comparisons never see two spellings of one domain.
func IsOrgDomain(value OrgDomain) bool {
	if NormalizeOrgDomain(value) != value ||
		!common.IsProfessionalDomain(common.ProfessionalDomain(value)) {
		return false
	}
	text := string(value)
	return letterPattern.MatchString(text[strings.LastIndexByte(text, '.')+1:])
}
