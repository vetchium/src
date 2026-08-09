// Package common contains API types shared by multiple Vetchium surfaces.
package common

import (
	"regexp"
	"strings"
)

type EmailAddress string

type Password string

var emailLocalPartPattern = regexp.MustCompile(
	`^[a-z0-9!#$%&'*+/=?^_` + "`" + `{|}~.-]+$`,
)
var emailDomainLabelPattern = regexp.MustCompile(
	`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`,
)

func NormalizeEmailAddress(value EmailAddress) EmailAddress {
	return EmailAddress(strings.ToLower(strings.TrimSpace(string(value))))
}

func IsEmailAddress(value EmailAddress) bool {
	normalized := string(NormalizeEmailAddress(value))
	if len(normalized) > 254 || strings.Count(normalized, "@") != 1 {
		return false
	}
	local, domain, _ := strings.Cut(normalized, "@")
	if len(local) < 1 || len(local) > 64 || len(domain) < 1 ||
		len(domain) > 253 || !emailLocalPartPattern.MatchString(local) ||
		strings.HasPrefix(local, ".") || strings.HasSuffix(local, ".") ||
		strings.Contains(local, "..") {
		return false
	}
	for _, label := range strings.Split(domain, ".") {
		if !emailDomainLabelPattern.MatchString(label) {
			return false
		}
	}
	return true
}
