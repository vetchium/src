package regions

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"

	"github.com/vetchium/src/typespec/common"
	regionspec "github.com/vetchium/src/typespec/regions"
)

type Directory interface {
	ListSignupRegions(
		context.Context, regionspec.ListSignupRegionsRequest,
	) (regionspec.ListSignupRegionsResponse, error)
}
type Region struct {
	TenantID         string               `json:"tenantId"`
	HostingCountry   common.CountryCode   `json:"hostingCountry"`
	HubURL           string               `json:"hubURL"`
	SignupEnabled    bool                 `json:"signupEnabled"`
	AllowedCountries []common.CountryCode `json:"allowedCountries"`
}
type Catalog struct {
	Version         string                        `json:"version"`
	DefaultTenant   string                        `json:"defaultTenant"`
	Recommendations map[common.CountryCode]string `json:"recommendations"`
	Regions         []Region                      `json:"regions"`
	fingerprint     string
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
	c.fingerprint = fmt.Sprintf("%x", sha256.Sum256(data))
	return &c, nil
}
func (c *Catalog) Validate() error {
	if c.Version == "" || len(c.Regions) == 0 {
		return fmt.Errorf("region catalog requires version and regions")
	}
	seen := map[string]bool{}
	origins := map[string]bool{}
	for _, r := range c.Regions {
		if !IsTenantID(r.TenantID) || seen[r.TenantID] ||
			!common.IsCountryCode(r.HostingCountry) {
			return fmt.Errorf("invalid or duplicate region %q", r.TenantID)
		}
		if !IsHubOrigin(r.HubURL) || origins[r.HubURL] {
			return fmt.Errorf("region %q requires a unique HTTP(S) origin", r.TenantID)
		}
		seen[r.TenantID] = true
		origins[r.HubURL] = true
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
func (c *Catalog) HasOrigin(tenant, origin string) bool {
	for _, r := range c.Regions {
		if r.TenantID == tenant && r.HubURL == origin {
			return true
		}
	}
	return false
}

type cursor struct {
	Country common.CountryCode `json:"country"`
	Version string             `json:"version"`
	Last    string             `json:"last"`
}

func (c *Catalog) List(
	request regionspec.ListSignupRegionsRequest,
) (regionspec.ListSignupRegionsResponse, error) {
	response := regionspec.ListSignupRegionsResponse{
		CatalogVersion: c.Version, Regions: []regionspec.SignupRegion{},
	}
	after := ""
	if request.PaginationKey != nil {
		raw, err := base64.RawURLEncoding.DecodeString(string(*request.PaginationKey))
		var key cursor
		if err != nil || json.Unmarshal(raw, &key) != nil ||
			key.Country != request.ResidentCountry ||
			key.Version != c.fingerprint || !IsTenantID(key.Last) {
			return response, fmt.Errorf("invalid pagination key")
		}
		after = key.Last
	}
	recommended := c.Recommendations[request.ResidentCountry]
	if recommended == "" {
		recommended = c.DefaultTenant
	}
	if !c.Allows(recommended, request.ResidentCountry) {
		recommended = ""
		for _, r := range c.Regions {
			if c.Allows(r.TenantID, request.ResidentCountry) {
				recommended = r.TenantID
				break
			}
		}
	}
	for _, r := range c.Regions {
		if r.TenantID <= after || !c.Allows(r.TenantID, request.ResidentCountry) {
			continue
		}
		if len(response.Regions) == 50 {
			raw, _ := json.Marshal(cursor{
				Country: request.ResidentCountry, Version: c.fingerprint,
				Last: response.Regions[49].TenantID,
			})
			key := common.PaginationKey(base64.RawURLEncoding.EncodeToString(raw))
			response.NextPaginationKey = &key
			break
		}
		response.Regions = append(response.Regions, regionspec.SignupRegion{
			TenantID: r.TenantID, HostingCountry: r.HostingCountry,
			HubURL: r.HubURL, Recommended: r.TenantID == recommended,
		})
	}
	return response, nil
}

func IsTenantID(value string) bool {
	return tenantPattern.MatchString(value)
}

func IsHubOrigin(value string) bool {
	u, err := url.Parse(value)
	return err == nil && u.Host != "" &&
		(u.Scheme == "https" || u.Scheme == "http") &&
		u.User == nil && value == u.Scheme+"://"+u.Host
}
