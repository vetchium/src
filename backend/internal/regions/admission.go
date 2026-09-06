package regions

import "fmt"

type EmailDomainMode string

const (
	AnyDomain EmailDomainMode = "any_domain"
	Allowlist EmailDomainMode = "allowlist"
)

type Admission struct {
	Enabled         bool            `json:"enabled"`
	EmailDomainMode EmailDomainMode `json:"emailDomainMode"`
}

func (a Admission) Validate() error {
	if a.EmailDomainMode != AnyDomain && a.EmailDomainMode != Allowlist {
		return fmt.Errorf("hub signup emailDomainMode must be any_domain or allowlist")
	}
	return nil
}
