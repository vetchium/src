package regions

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"slices"
	"strings"

	"github.com/vetchium/src/typespec/common"
)

// Region is one tenant's entry in the signup catalog. The global portals
// carry the same facts in their compiled-in region tables, kept equal by a
// repository test; this copy is what a tenant's APIs use for admission.
type Region struct {
	TenantID         string               `json:"tenantId"`
	HostingCountry   common.CountryCode   `json:"hostingCountry"`
	SignupEnabled    bool                 `json:"signupEnabled"`
	AllowedCountries []common.CountryCode `json:"allowedCountries"`
	// OrgSignupEnabled is advisory, like SignupEnabled for Hub: the tenant's
	// own orgsAPIServer.signup setting decides admission.
	OrgSignupEnabled bool `json:"orgSignupEnabled"`
}
type Catalog struct {
	Version         string                        `json:"version"`
	DefaultTenant   string                        `json:"defaultTenant"`
	Recommendations map[common.CountryCode]string `json:"recommendations"`
	Regions         []Region                      `json:"regions"`
}

var tenantPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}$`)

func Load(path string) (*Catalog, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read region catalog: %w", err)
	}
	var c Catalog
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&c); err != nil {
		return nil, fmt.Errorf("decode region catalog: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("region catalog has trailing data")
	}
	if err := c.Validate(); err != nil {
		return nil, err
	}
	slices.SortFunc(c.Regions, func(a, b Region) int {
		return strings.Compare(a.TenantID, b.TenantID)
	})
	return &c, nil
}
func (c *Catalog) Validate() error {
	if c.Version == "" || len(c.Regions) == 0 {
		return fmt.Errorf("region catalog requires version and regions")
	}
	seen := map[string]bool{}
	for _, r := range c.Regions {
		if !IsTenantID(r.TenantID) || seen[r.TenantID] ||
			!common.IsCountryCode(r.HostingCountry) {
			return fmt.Errorf("invalid or duplicate region %q", r.TenantID)
		}
		seen[r.TenantID] = true
		countries := map[common.CountryCode]bool{}
		for _, country := range r.AllowedCountries {
			if !common.IsCountryCode(country) || countries[country] {
				return fmt.Errorf("invalid country restriction in %q", r.TenantID)
			}
			countries[country] = true
		}
	}
	if !seen[c.DefaultTenant] {
		return fmt.Errorf("unknown default tenant")
	}
	for country, tenant := range c.Recommendations {
		if !common.IsCountryCode(country) || !seen[tenant] {
			return fmt.Errorf("invalid region recommendation")
		}
	}
	return nil
}
func (c *Catalog) Allows(tenant string, country common.CountryCode) bool {
	for _, r := range c.Regions {
		if r.TenantID == tenant {
			return r.SignupEnabled && (len(r.AllowedCountries) == 0 ||
				slices.Contains(r.AllowedCountries, country))
		}
	}
	return false
}

// SignupEnabled reports the catalog's own open/closed state for a tenant,
// independent of any country restriction. hub-api compares it against its
// local signup setting at startup so the two can never disagree in a running
// process: the portals' region table would otherwise offer a region that then
// refuses.
func (c *Catalog) SignupEnabled(tenant string) bool {
	for _, r := range c.Regions {
		if r.TenantID == tenant {
			return r.SignupEnabled
		}
	}
	return false
}

// OrgSignupEnabled reports the catalog's advisory Org signup state for a
// tenant, independent of any country, so orgs-api can refuse to start when it
// disagrees with the tenant's own setting.
func (c *Catalog) OrgSignupEnabled(tenant string) bool {
	for _, r := range c.Regions {
		if r.TenantID == tenant {
			return r.OrgSignupEnabled
		}
	}
	return false
}

// Region returns a tenant's catalog entry. Naming a Hub account's region
// serves only callers that have proven control of its mailbox.
func (c *Catalog) Region(tenant string) (Region, bool) {
	for _, r := range c.Regions {
		if r.TenantID == tenant {
			return r, true
		}
	}
	return Region{}, false
}

func IsTenantID(value string) bool {
	return tenantPattern.MatchString(value)
}
