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

// specialUseDomains are names reserved for testing, documentation, and local
// networks (RFC 2606, RFC 6761, RFC 6762, RFC 7686, RFC 8375, RFC 9476, and
// ICANN's internal). Nobody can publish a public DNS record under them.
var specialUseDomains = []string{
	"alt", "example", "example.com", "example.net", "example.org",
	"home.arpa", "internal", "invalid", "local", "localhost", "onion", "test",
}

// IsSpecialUseDomain reports whether a normalized Org domain is, or is under,
// a special-use name. Whether such a domain may sign up is tenant policy, so
// this is not part of IsOrgDomain.
func IsSpecialUseDomain(value OrgDomain) bool {
	for _, reserved := range specialUseDomains {
		if string(value) == reserved ||
			strings.HasSuffix(string(value), "."+reserved) {
			return true
		}
	}
	return false
}
