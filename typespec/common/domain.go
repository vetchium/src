package common

import (
	"net"
	"regexp"
	"strings"
)

type ProfessionalDomain string

var professionalDomainLabelPattern = regexp.MustCompile(
	`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`,
)

func NormalizeProfessionalDomain(value ProfessionalDomain) ProfessionalDomain {
	normalized := strings.ToLower(strings.TrimSpace(string(value)))
	return ProfessionalDomain(strings.TrimSuffix(normalized, "."))
}

func IsProfessionalDomain(value ProfessionalDomain) bool {
	normalized := string(NormalizeProfessionalDomain(value))
	if len(normalized) < 3 || len(normalized) > 253 ||
		!strings.Contains(normalized, ".") || net.ParseIP(normalized) != nil {
		return false
	}
	for _, label := range strings.Split(normalized, ".") {
		if !professionalDomainLabelPattern.MatchString(label) {
			return false
		}
	}
	return true
}
