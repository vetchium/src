package regions

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
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

// ErrRequestRejected reports that the directory understood the request and
// refused it, rather than being unreachable. The bundled catalog cannot do
// better with the same input, so a refusal is passed back to the caller
// instead of being masked as an outage.
var ErrRequestRejected = errors.New("region directory rejected the request")

// ErrForeignCursor reports a well-formed cursor that was issued against a
// different catalog. During an outage that is the signature of a cursor the
// live directory handed out, which the bundled catalog cannot continue. A
// cursor that is merely malformed stays the caller's error either way.
var ErrForeignCursor = errors.New("pagination key was issued for a different catalog")

type Region struct {
	TenantID         string               `json:"tenantId"`
	HostingCountry   common.CountryCode   `json:"hostingCountry"`
	HubURL           string               `json:"hubURL"`
	SignupEnabled    bool                 `json:"signupEnabled"`
	AllowedCountries []common.CountryCode `json:"allowedCountries"`
	OrgsURL          string               `json:"orgsURL"`
	// OrgSignupEnabled is advisory, like SignupEnabled for Hub: the tenant's
	// own orgsAPIServer.signup setting decides admission.
	OrgSignupEnabled bool `json:"orgSignupEnabled"`
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
		origins[r.HubURL] = true
		// Org and Hub portals share one origin namespace so a catalog typo
		// cannot send an Org to a Hub portal or the reverse.
		if !IsHubOrigin(r.OrgsURL) || origins[r.OrgsURL] {
			return fmt.Errorf(
				"region %q requires a unique HTTP(S) Org portal origin",
				r.TenantID,
			)
		}
		origins[r.OrgsURL] = true
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
// process: discovery would otherwise advertise a region that then refuses.
func (c *Catalog) SignupEnabled(tenant string) bool {
	for _, r := range c.Regions {
		if r.TenantID == tenant {
			return r.SignupEnabled
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

// cursor binds a page position to the country, the exact catalog contents,
// and the list that issued it, so a Hub cursor cannot page the Org list. The
// Hub list leaves List empty, which keeps its cursors byte-identical to those
// issued before the Org list existed.
type cursor struct {
	List    string             `json:"list,omitempty"`
	Country common.CountryCode `json:"country"`
	Version string             `json:"version"`
	Last    string             `json:"last"`
}

const (
	hubList  = ""
	orgsList = "orgs"
	pageSize = 50
)

// after returns the tenant ID a page starts after.
func (c *Catalog) after(
	key *common.PaginationKey, list string, country common.CountryCode,
) (string, error) {
	if key == nil {
		return "", nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(string(*key))
	var decoded cursor
	if err != nil || json.Unmarshal(raw, &decoded) != nil ||
		decoded.List != list || decoded.Country != country ||
		!IsTenantID(decoded.Last) {
		return "", fmt.Errorf("invalid pagination key")
	}
	if decoded.Version != c.fingerprint {
		return "", ErrForeignCursor
	}
	return decoded.Last, nil
}

func (c *Catalog) nextKey(
	list string, country common.CountryCode, last string,
) *common.PaginationKey {
	raw, _ := json.Marshal(cursor{
		List: list, Country: country, Version: c.fingerprint, Last: last,
	})
	key := common.PaginationKey(base64.RawURLEncoding.EncodeToString(raw))
	return &key
}

func (c *Catalog) List(
	request regionspec.ListSignupRegionsRequest,
) (regionspec.ListSignupRegionsResponse, error) {
	response := regionspec.ListSignupRegionsResponse{
		CatalogVersion: c.Version, Regions: []regionspec.SignupRegion{},
	}
	after, err := c.after(
		request.PaginationKey, hubList, request.ResidentCountry,
	)
	if err != nil {
		return response, err
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
		if len(response.Regions) == pageSize {
			response.NextPaginationKey = c.nextKey(
				hubList, request.ResidentCountry,
				response.Regions[pageSize-1].TenantID,
			)
			break
		}
		response.Regions = append(response.Regions, regionspec.SignupRegion{
			TenantID: r.TenantID, HostingCountry: r.HostingCountry,
			HubURL: r.HubURL, Recommended: r.TenantID == recommended,
		})
	}
	return response, nil
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

func (c *Catalog) HasOrgsOrigin(tenant, origin string) bool {
	for _, r := range c.Regions {
		if r.TenantID == tenant && r.OrgsURL == origin {
			return true
		}
	}
	return false
}

func (c *Catalog) OrgsURL(tenant string) (string, bool) {
	for _, r := range c.Regions {
		if r.TenantID == tenant {
			return r.OrgsURL, true
		}
	}
	return "", false
}

// ListOrgs lists the regions accepting Org signup. It ignores
// allowedCountries, which is Hub residency policy: an Org's chosen country
// only selects the recommendation.
func (c *Catalog) ListOrgs(
	request regionspec.ListOrgSignupRegionsRequest,
) (regionspec.ListOrgSignupRegionsResponse, error) {
	response := regionspec.ListOrgSignupRegionsResponse{
		CatalogVersion: c.Version, Regions: []regionspec.OrgSignupRegion{},
	}
	after, err := c.after(request.PaginationKey, orgsList, request.Country)
	if err != nil {
		return response, err
	}
	recommended := c.Recommendations[request.Country]
	if recommended == "" {
		recommended = c.DefaultTenant
	}
	if !c.OrgSignupEnabled(recommended) {
		recommended = ""
		for _, r := range c.Regions {
			if r.OrgSignupEnabled {
				recommended = r.TenantID
				break
			}
		}
	}
	for _, r := range c.Regions {
		if r.TenantID <= after || !r.OrgSignupEnabled {
			continue
		}
		if len(response.Regions) == pageSize {
			response.NextPaginationKey = c.nextKey(
				orgsList, request.Country,
				response.Regions[pageSize-1].TenantID,
			)
			break
		}
		response.Regions = append(response.Regions, regionspec.OrgSignupRegion{
			TenantID: r.TenantID, HostingCountry: r.HostingCountry,
			OrgsURL: r.OrgsURL, Recommended: r.TenantID == recommended,
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
